// WOPR by voice from the dash. Tap the WOPR rail button and talk (it stops
// when you do), or hold it while talking. mic -> brain /api/wopr/stt (WOPR's
// Groq Whisper) -> /api/wopr/chat (WOPR's /api/WOPR with a truck primer,
// NDJSON back) -> each sentence to /api/wopr/tts (Cartesia) as it arrives,
// played in order. The reply is shown as a subtitle. Online only.
// The voice loop follows WOPR's own phone page (app/components/WoprChat.tsx).
import { api, stateStore, store } from '../lib/brain.ts';
import { extractSentences, notDoneLine, speakable, splitActions, stripMarkers } from '../../../brain/src/wopr/stream.ts';
import { player } from '../media/player.ts';

export type Phase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';
export type VoiceState = {
  phase: Phase;
  you: string | null;        // what WOPR heard
  reply: string;             // the subtitle, growing as it streams
  note: string | null;       // "Not done from the truck: …"
  searching: boolean;
  error: string | null;
  shownAt: number;           // when the subtitle last changed (it hides itself later)
};

export const voiceStore = store<VoiceState>({ phase: 'idle', you: null, reply: '', note: null, searching: false, error: null, shownAt: 0 });
const set = (p: Partial<VoiceState>) => voiceStore.set({ ...voiceStore.get(), ...p, shownAt: Date.now() });

// VAD: WOPR's dashboard values (smoke-test by ear if changed).
const SPEECH_THRESHOLD = 0.014;
const SILENCE_THRESHOLD = 0.009;
const SILENCE_MS = 1500;
const NO_SPEECH_MS = 8000;
const MAX_RECORD_MS = 30000;
/** A press longer than this is push-to-talk: letting go sends. */
export const HOLD_MS = 450;
/** The conversation is forgotten after this long without a turn. */
const FORGET_MS = 10 * 60_000;
const KEEP = 12;

type Msg = { role: 'user' | 'assistant'; content: string };

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* ignore */ } }
  return undefined;
}

/** What the brain says about the chosen assistant (GET /api/assistant/status). */
export type AssistantInfo = { name: string; configured: boolean; online: boolean; tabletVoice: boolean; message: string | null };

/** The assistant's name, for the voice button ("WOPR", "Claude", "ChatGPT"...). */
export const assistantStore = store<AssistantInfo | null>(null);

/** Why voice can't start right now, or null. Pure (exported for tests). */
export function blockedReason(s: { network?: { link: string } | null } | null, configured: boolean | null, info: AssistantInfo | null = null): string | null {
  if (!s) return 'Not connected to the brain.';
  if (info?.message) return info.message;
  const name = info?.name ?? 'WOPR';
  if (s.network?.link === 'offline' && (!info || !info.online)) return `${name} needs the internet: the truck is offline. Join home Wi-Fi or turn on a phone hotspot.`;
  if (configured === false) return `${name} isn't set up: pick and set up the assistant on the settings page (Media and WOPR).`;
  return null;
}

class Voice {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private spoke = false;
  private silenceAt: number | null = null;
  private recStart = 0;
  private pressAt = 0;
  private cancelRec = false;
  private history: Msg[] = [];
  private lastTurn = 0;
  private abort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  /** One sentence: an audio clip from the brain, or (tablet voice) text the browser speaks. */
  private queue: { url: string | null; say: string | null; dead: boolean; ctl: AbortController }[] = [];
  private cursor = 0;
  private playingTts = false;
  private streamDone = false;
  configured: boolean | null = null;

  async checkConfigured() {
    try {
      const st = await api<AssistantInfo>('/api/assistant/status');
      this.configured = st.configured;
      assistantStore.set(st);
    } catch { /* keep */ }
  }

  // ---- the button ------------------------------------------------------------------

  /** Pointer down on the WOPR button. */
  press() {
    this.pressAt = performance.now();
    const ph = voiceStore.get().phase;
    if (ph === 'idle' || ph === 'error') void this.startListening();
  }

  /** Pointer up: a long hold sends; a short tap leaves it listening (or stops/cancels when already going). */
  release() {
    const held = performance.now() - this.pressAt;
    const ph = voiceStore.get().phase;
    if (ph === 'listening') {
      if (held >= HOLD_MS) this.finishRecording();
      else if (performance.now() - this.recStart > HOLD_MS) this.finishRecording(); // second tap: done talking
    } else if (ph === 'thinking' || ph === 'speaking' || ph === 'transcribing') {
      if (held < HOLD_MS) this.cancel();
    }
  }

  cancel() {
    this.abort?.abort();
    this.abort = null;
    this.stopSpeaking();
    this.cancelRec = true;
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.releaseMic();
    player.duck(false);
    set({ phase: 'idle', searching: false });
  }

  dismiss() { if (voiceStore.get().phase === 'idle' || voiceStore.get().phase === 'error') set({ you: null, reply: '', note: null, error: null }); }

  // ---- listening ----------------------------------------------------------------------

  private async startListening() {
    await this.checkConfigured();
    const why = blockedReason(stateStore.get(), this.configured, assistantStore.get());
    if (why) { set({ phase: 'error', error: why, you: null, reply: '', note: null }); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { set({ phase: 'error', error: 'This browser has no microphone access (the Pi kiosk allows it for localhost:8080).' }); return; }
    if (Date.now() - this.lastTurn > FORGET_MS) this.history = [];
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      set({ phase: 'error', error: (e as Error).name === 'NotAllowedError' ? 'The microphone is blocked for this page.' : `No microphone (${(e as Error).message}). Plug in the USB mic.` });
      return;
    }
    player.duck(true);
    this.unlockAudio();
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch { this.analyser = null; }
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec = rec;
    this.chunks = []; this.spoke = false; this.silenceAt = null; this.cancelRec = false;
    this.recStart = performance.now();
    rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    rec.onstop = () => { if (this.rec === rec) void this.onRecorded(rec.mimeType || mime || 'audio/webm'); };
    rec.start();
    set({ phase: 'listening', you: null, reply: '', note: null, error: null, searching: false });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.vad());
  }

  private level(): number {
    const a = this.analyser;
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  private vad() {
    if (voiceStore.get().phase !== 'listening') return;
    this.raf = requestAnimationFrame(() => this.vad());
    const lv = this.level(), now = performance.now();
    if (lv > SPEECH_THRESHOLD) { this.spoke = true; this.silenceAt = null; }
    else if (lv < SILENCE_THRESHOLD && this.spoke) {
      if (this.silenceAt === null) this.silenceAt = now;
      else if (now - this.silenceAt > SILENCE_MS) this.finishRecording();
    }
    if (!this.spoke && this.analyser && now - this.recStart > NO_SPEECH_MS) { this.cancelRec = true; this.finishRecording(); set({ phase: 'idle' }); player.duck(false); }
    else if (now - this.recStart > MAX_RECORD_MS) this.finishRecording();
  }

  private finishRecording() {
    cancelAnimationFrame(this.raf);
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
  }

  private releaseMic() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.analyser = null;
  }

  private async onRecorded(mime: string) {
    const blob = new Blob(this.chunks, { type: mime });
    this.chunks = [];
    this.releaseMic();
    this.rec = null;
    if (this.cancelRec) { this.cancelRec = false; return; }
    if (blob.size < 1000) { set({ phase: 'idle' }); player.duck(false); return; }
    set({ phase: 'transcribing' });
    this.abort = new AbortController();
    try {
      const r = await fetch('/api/assistant/stt', { method: 'POST', headers: { 'content-type': mime.split(';')[0] }, body: blob, signal: this.abort.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `speech-to-text failed (${r.status})`);
      const text = String(j.text ?? '').trim();
      if (!text) { set({ phase: 'idle', error: null, you: '(didn\'t catch that)' }); player.duck(false); return; }
      await this.ask(text);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      set({ phase: 'error', error: (e as Error).message });
      player.duck(false);
    }
  }

  // ---- the turn ------------------------------------------------------------------------

  /** One question to WOPR (also used for typed questions, if a page offers that). */
  async ask(text: string) {
    set({ phase: 'thinking', you: text, reply: '', note: null, error: null, searching: false });
    this.lastTurn = Date.now();
    const ctl = this.abort ?? new AbortController();
    this.abort = ctl;
    this.queue = []; this.cursor = 0; this.streamDone = false;
    let acc = '', spokenIdx = 0;
    try {
      const r = await fetch('/api/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, history: this.history }), signal: ctl.signal });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `${assistantStore.get()?.name ?? 'The assistant'} answered ${r.status}`); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev: { t: string; v?: string; message?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === 'searching') set({ searching: true });
          else if (ev.t === 'error') throw new Error(ev.message ?? 'The assistant failed');
          else if (ev.t === 'text' && ev.v) {
            acc += ev.v;
            const shown = splitActions(stripMarkers(acc)).clean;
            set({ reply: shown, searching: false });
            const { sentences, newIdx } = extractSentences(shown, spokenIdx);
            sentences.forEach((s) => this.speak(s));
            spokenIdx = newIdx;
          }
        }
      }
      const { clean, actions } = splitActions(stripMarkers(acc));
      const tail = clean.slice(Math.min(spokenIdx, clean.length)).trim();
      if (tail) this.speak(tail);
      set({ reply: clean || '…', note: notDoneLine(actions), searching: false });
      this.history = [...this.history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: clean || '…' }].slice(-KEEP);
      this.streamDone = true;
      if (!this.queue.length) this.done(); else this.pump();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.stopSpeaking();
      set({ phase: 'error', error: (e as Error).message, searching: false });
      player.duck(false);
    }
  }

  // ---- speech out, in order ---------------------------------------------------------------

  private unlockAudio() {
    if (!this.audio) this.audio = new Audio();
    // a silent play inside the tap lets later sentences autoplay (WOPR's mobile-Safari trick; the kiosk allows autoplay anyway)
    try { this.audio.muted = true; void this.audio.play().catch(() => {}); } catch { /* ignore */ }
  }

  private speak(sentence: string) {
    const text = speakable(sentence);
    if (!text) return;
    const item = { url: null as string | null, say: null as string | null, dead: false, ctl: new AbortController() };
    this.queue.push(item);
    // The tablet's own voice: nothing to fetch.
    if (assistantStore.get()?.tabletVoice && typeof speechSynthesis !== 'undefined') { item.say = text; this.pump(); return; }
    fetch('/api/assistant/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: item.ctl.signal })
      .then(async (r) => {
        if (item.dead) return;
        if (r.status === 501 && typeof speechSynthesis !== 'undefined') { item.say = text; this.pump(); return; }
        if (!r.ok) { item.dead = true; this.pump(); return; }
        const b = await r.blob();
        if (item.dead) return;
        item.url = URL.createObjectURL(b);
        this.pump();
      })
      .catch(() => { if (!item.dead) { item.dead = true; this.pump(); } });
  }

  private pump() {
    if (this.playingTts) return;
    const it = this.queue[this.cursor];
    if (!it) { if (this.streamDone) this.done(); return; }
    if (it.dead) { this.cursor++; this.pump(); return; }
    if (!it.url && it.say === null) return;
    this.playingTts = true;
    if (voiceStore.get().phase !== 'speaking') set({ phase: 'speaking' });
    if (it.say !== null) {
      let finished = false;
      const next = () => { if (finished) return; finished = true; it.say = null; this.playingTts = false; this.cursor++; this.pump(); };
      const u = new SpeechSynthesisUtterance(it.say);
      u.onend = next; u.onerror = next;
      try { speechSynthesis.speak(u); } catch { next(); }
      return;
    }
    const a = this.audio ?? (this.audio = new Audio());
    a.muted = false;
    a.src = it.url!;
    let advanced = false;
    const advance = () => {
      if (advanced) return;
      advanced = true;
      a.onended = null; a.onerror = null;
      if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
      this.playingTts = false; this.cursor++; this.pump();
    };
    a.onended = advance; a.onerror = advance;
    a.play().catch(advance);
  }

  private stopSpeaking() {
    for (const it of this.queue) { it.dead = true; try { it.ctl.abort(); } catch { /* ignore */ } if (it.url) URL.revokeObjectURL(it.url); }
    this.queue = []; this.cursor = 0; this.playingTts = false; this.streamDone = false;
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); }
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* ignore */ }
  }

  private done() {
    this.queue = []; this.cursor = 0; this.playingTts = false;
    this.abort = null;
    player.duck(false);
    set({ phase: 'idle' });
  }
}

export const voice = new Voice();
