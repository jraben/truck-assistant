// WOPR from the truck: voice turns, the next appointment, gate codes on arrival.
import type { State } from '../types.ts';
import type { MediaSettingsStore } from '../media/settings.ts';
import { pickNextAppointment, type CalEvent, type NextStatus } from './calendar.ts';
export type { NextStatus } from './calendar.ts';
import { WoprError, woprFetch, woprJson, NOT_CONFIGURED_MSG, type WoprConfig } from './client.ts';
import { parseWhere, type GateStatus } from './gate.ts';
export type { GateStatus } from './gate.ts';
import { buildMessages, buildPrimer, type ChatMsg } from './primer.ts';
import { MarkerStripper } from './stream.ts';

/** What the service needs from the brain (a subset, so tests can fake it). */
export type BrainView = {
  getState(): State;
  on(ev: 'change', f: () => void): unknown;
  off(ev: 'change', f: () => void): unknown;
};

export const CAL_POLL_MS = 5 * 60_000;
const CONTEXT_FRESH_MS = 3 * 60_000;
/** A gate answer stays up this long at most (or until the truck leaves, or it's dismissed). */
export const GATE_TTL_MS = 30 * 60_000;

export type ChatEvent = { t: 'text'; v: string } | { t: 'searching' } | { t: 'done' } | { t: 'error'; message: string; kind?: string };

export class WoprService {
  private brain: BrainView;
  private media: MediaSettingsStore;
  private calTimer: NodeJS.Timeout | null = null;
  private nextStatus: NextStatus = { configured: false, online: false, next: null, fetchedAt: null, message: null };
  private ctx: { text: string; at: number } | null = null;
  private gate: GateStatus = null;
  private dismissedStop: number | null = null;
  private lastStopId: number | null = null;
  private gateBusy = false;
  private onChange = () => this.watchPlace();

  constructor(brain: BrainView, media: MediaSettingsStore) {
    this.brain = brain;
    this.media = media;
  }

  config(): WoprConfig { return this.media.get().wopr; }
  configured(): boolean { const c = this.config(); return !!(c.url && c.username && c.password); }
  online(): boolean { return this.brain.getState().network?.link !== 'offline'; }

  start() {
    this.lastStopId = this.brain.getState().place?.stopId ?? null;
    this.brain.on('change', this.onChange);
    void this.refreshNext();
    this.calTimer = setInterval(() => void this.refreshNext(), CAL_POLL_MS);
    this.media.onChange((n, p) => { if (n.wopr.url !== p.wopr.url || n.wopr.password !== p.wopr.password || n.wopr.username !== p.wopr.username) { this.ctx = null; void this.refreshNext(); } });
  }

  stop() {
    if (this.calTimer) clearInterval(this.calTimer);
    this.brain.off('change', this.onChange);
  }

  /** Why a WOPR feature can't run right now, or null when it can. */
  blocked(): { status: number; message: string; kind: string } | null {
    if (!this.configured()) return { status: 503, message: NOT_CONFIGURED_MSG, kind: 'not-configured' };
    if (!this.online()) return { status: 503, message: 'The truck is offline: WOPR needs home Wi-Fi or a phone hotspot.', kind: 'offline' };
    return null;
  }

  status() {
    const b = this.blocked();
    return { configured: this.configured(), online: this.online(), url: this.config().url, message: b?.message ?? null };
  }

  /** Settings page "Test": WOPR's ungated /api/status, then one gated read to prove the login. */
  async test(): Promise<{ ok: boolean; version: string | null; message: string }> {
    const c = this.config();
    if (!c.url) return { ok: false, version: null, message: NOT_CONFIGURED_MSG };
    try {
      const st = await woprJson<{ version?: string }>(c, '/api/status', { timeoutMs: 8000 });
      const now = new Date();
      await woprJson(c, `/api/calendar?timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(new Date(now.getTime() + 60_000).toISOString())}`, { timeoutMs: 10_000 });
      return { ok: true, version: st.version ?? null, message: `WOPR ${st.version ?? ''} answered and accepted the login.`.replace('  ', ' ') };
    } catch (e) {
      return { ok: false, version: null, message: e instanceof WoprError ? e.message : (e as Error).message };
    }
  }

  // ---- next appointment ------------------------------------------------------

  getNext(): NextStatus { return { ...this.nextStatus, configured: this.configured(), online: this.online() }; }

  async refreshNext(): Promise<NextStatus> {
    const b = this.blocked();
    if (b) { this.nextStatus = { ...this.nextStatus, message: b.message }; return this.getNext(); }
    const now = Date.now();
    try {
      const r = await woprJson<{ connected?: boolean; events?: CalEvent[] }>(this.config(),
        `/api/calendar?timeMin=${encodeURIComponent(new Date(now - 15 * 60_000).toISOString())}&timeMax=${encodeURIComponent(new Date(now + 36 * 3600_000).toISOString())}`, { timeoutMs: 15_000 });
      if (r.connected === false) this.nextStatus = { ...this.nextStatus, next: null, fetchedAt: new Date().toISOString(), message: "WOPR's Outlook calendar isn't connected." };
      else this.nextStatus = { ...this.nextStatus, next: pickNextAppointment(r.events ?? [], now), fetchedAt: new Date().toISOString(), message: null };
    } catch (e) {
      // keep the last good answer; say why it's old
      this.nextStatus = { ...this.nextStatus, message: (e as Error).message };
      if (this.nextStatus.next && Date.parse(this.nextStatus.next.end) < Date.now()) this.nextStatus.next = null;
    }
    return this.getNext();
  }

  // ---- gate code on arrival ----------------------------------------------------

  getGate(): GateStatus {
    const g = this.gate;
    if (!g) return null;
    if (Date.now() - Date.parse(g.at) > GATE_TTL_MS) { this.gate = null; return null; }
    return g;
  }

  dismissGate() { this.dismissedStop = this.gate?.stopId ?? this.dismissedStop; this.gate = null; }

  private watchPlace() {
    const id = this.brain.getState().place?.stopId ?? null;
    if (id === this.lastStopId) return;
    this.lastStopId = id;
    if (id === null) { this.gate = null; return; } // drove off: the code goes with it
    if (id === this.dismissedStop) return;
    void this.checkGate(id).catch(() => { /* a failed lookup shows nothing; the card has a manual button */ });
  }

  /**
   * POST /api/where with the GPS fix. Only a real code is kept (in memory).
   * `manual` = the driver asked, so "no codes" and "unknown spot" come back too.
   */
  async checkGate(stopId: number | null, manual = false): Promise<GateStatus> {
    const b = this.blocked();
    if (b) throw new WoprError(b.kind as WoprError['kind'], b.message, b.status);
    const g = this.brain.getState().gps;
    if (!g?.fix) throw new WoprError('http', 'No GPS fix to look the place up with.', 409);
    if (this.gateBusy) return this.gate;
    this.gateBusy = true;
    try {
      const r = await woprFetch(this.config(), '/api/where', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat: Math.round(g.lat * 1e6) / 1e6, lon: Math.round(g.lon * 1e6) / 1e6 }), timeoutMs: 12_000,
      });
      const ans = parseWhere(await r.text());
      const st: GateStatus = { ...ans, stopId, at: new Date().toISOString() };
      if (ans.kind === 'codes') { this.gate = st; this.dismissedStop = null; }
      return manual || ans.kind === 'codes' ? st : null;
    } finally { this.gateBusy = false; }
  }

  // ---- voice turn -------------------------------------------------------------

  /** WOPR's own live context (calendar, tasks, dinner) for the primer; '' if it is slow or away. */
  private async woprContext(): Promise<string> {
    if (this.ctx && Date.now() - this.ctx.at < CONTEXT_FRESH_MS) return this.ctx.text;
    try {
      const r = await woprJson<{ context?: string }>(this.config(), '/api/mobile/context', { timeoutMs: 4000 });
      const text = typeof r.context === 'string' ? r.context : '';
      this.ctx = { text, at: Date.now() };
      return text;
    } catch { return this.ctx?.text ?? ''; }
  }

  async primer(driver: string | null): Promise<string> {
    const s = this.brain.getState();
    return buildPrimer({
      now: new Date(), driver, place: s.place?.name ?? null,
      gps: s.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null,
      speedMph: s.speedMph, soc: s.soc, socSource: s.socSource, rangeMi: s.rangeMi,
      next: this.nextStatus.next, nowPlaying: s.nowPlaying, network: s.network?.label ?? null,
      woprContext: await this.woprContext(),
    });
  }

  /** One spoken turn. Yields text with WOPR's markers removed; the caller writes NDJSON. */
  async *chat(question: string, history: ChatMsg[], signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const b = this.blocked();
    if (b) { yield { t: 'error', message: b.message, kind: b.kind }; return; }
    const driver = this.brain.getState().driver?.name ?? null;
    const messages = buildMessages(await this.primer(driver), history, question);
    let res: Response;
    try {
      res = await woprFetch(this.config(), '/api/WOPR', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, model: 'claude', voice: true, save: true, skipMemory: false, think: false, deep: false }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
      });
    } catch (e) {
      yield { t: 'error', message: (e as Error).message, kind: e instanceof WoprError ? e.kind : 'http' }; return;
    }
    if (!res.body) { yield { t: 'error', message: 'WOPR sent no reply.' }; return; }
    const strip = new MarkerStripper();
    const dec = new TextDecoder();
    let searching = false;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        const out = strip.push(dec.decode(chunk, { stream: true }));
        if (strip.searching && !searching) { searching = true; yield { t: 'searching' }; }
        if (out) yield { t: 'text', v: out };
      }
      const tail = strip.end() + dec.decode();
      if (tail) yield { t: 'text', v: tail };
      yield { t: 'done' };
    } catch (e) {
      if (signal?.aborted) return;
      yield { t: 'error', message: `The reply was cut off (${(e as Error).message}).` };
    }
  }

  /** Groq Whisper through WOPR's /api/stt: multipart "file". */
  async stt(audio: Buffer, mime: string): Promise<{ text: string }> {
    const b = this.blocked();
    if (b) throw new WoprError(b.kind as WoprError['kind'], b.message, b.status);
    const form = new FormData();
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), `audio.${ext}`);
    const r = await woprJson<{ text?: string }>(this.config(), '/api/stt', { method: 'POST', body: form, timeoutMs: 30_000 });
    return { text: String(r.text ?? '').trim() };
  }

  /** Cartesia through WOPR's /api/tts: one sentence in, audio/mpeg out. */
  async tts(text: string): Promise<Response> {
    const b = this.blocked();
    if (b) throw new WoprError(b.kind as WoprError['kind'], b.message, b.status);
    return woprFetch(this.config(), '/api/tts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1000), provider: 'cartesia' }), timeoutMs: 20_000,
    });
  }
}
