// The Media view's own player: one <audio> for the page's life (music keeps
// playing on other views), for internet radio, AM/FM, Plex and local files.
// Spotify plays on the Pi's librespot and CarPlay on the phone; they are
// controlled, not played, here. Whatever this player plays is reported to
// the brain as now playing ({"type":"media", source}) so the Drive card and
// Home Assistant follow it. Art stays in the UI.
import { api, linkStore, sendQuiet, stateStore, store } from '../lib/brain.ts';
import type { NowPlayingSource, State } from '../../../brain/src/types.ts';

export type PlayerSource = Extract<NowPlayingSource, 'radio' | 'fm' | 'plex' | 'local'>;
export type Track = {
  source: PlayerSource;
  id: string;                    // station id, mhz, Plex ratingKey or file path
  url: string;                   // brain URL to play
  title: string | null; artist: string | null; album: string | null;
  art: string | null;
  live: boolean;                 // a stream (radio/FM): no seeking, no "next"
  dataHeavy: boolean;            // uses the internet: ask first on a phone hotspot
  kbps: number | null;
};
export type PlayerState = {
  current: Track | null;
  queue: Track[]; index: number;
  playing: boolean; loading: boolean;
  error: string | null;
  positionS: number | null; durationS: number | null;
  /** A play waiting for "yes, use the data" on a hotspot. */
  confirm: { track: Track; queue: Track[]; index: number } | null;
  ducked: boolean;
};

export const playerStore = store<PlayerState>({ current: null, queue: [], index: 0, playing: false, loading: false, error: null, positionS: null, durationS: null, confirm: null, ducked: false });
const patch = (p: Partial<PlayerState>) => playerStore.set({ ...playerStore.get(), ...p });

/** Rough MB per hour, for the hotspot warning (Radio Browser bitrates; 128 kbps when unknown; Plex FLAC can be ~3x). */
export const mbPerHour = (kbps: number | null) => Math.round(((kbps ?? 128) * 1000 / 8) * 3600 / 1e6);

/** True when a phone link with "save data" is up (contract: State.network.saveData). Pure. */
export const savingData = (s: State | null) => !!s?.network?.saveData;

/** The {"type":"media"} message for what's playing (title null = this source stopped). Pure. */
export function mediaMessage(source: PlayerSource, t: Pick<Track, 'title' | 'artist' | 'album'> | null) {
  if (!t || (!t.title && !t.artist)) return { type: 'media', source, title: null, artist: null, album: null };
  return { type: 'media', source, title: t.title, artist: t.artist, album: t.album };
}

class Player {
  private audio: HTMLAudioElement | null = null;
  private sent = '';
  private lastSource: PlayerSource | null = null;
  private radioTimer: number | undefined;
  /** Hotspot data use agreed for this trip (cleared when the link changes). */
  private agreed = false;
  private agreedLink = '';
  onStartOther: (() => void) | null = null;

  init() {
    linkStore.sub(() => { if (linkStore.get().connected) { this.sent = ''; this.publish(); } });
    stateStore.sub(() => {
      const l = stateStore.get()?.network?.link ?? '';
      if (l !== this.agreedLink) { this.agreedLink = l; this.agreed = false; }
    });
  }

  private el(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'none';
    a.addEventListener('playing', () => patch({ playing: true, loading: false, error: null }));
    a.addEventListener('pause', () => patch({ playing: false }));
    a.addEventListener('waiting', () => patch({ loading: true }));
    a.addEventListener('timeupdate', () => patch({ positionS: Number.isFinite(a.currentTime) ? a.currentTime : null, durationS: Number.isFinite(a.duration) ? a.duration : null }));
    a.addEventListener('ended', () => { if (!this.next()) this.stop(); });
    a.addEventListener('error', () => { void this.explainError(); });
    this.audio = a;
    return a;
  }

  /** The brain says why a stream failed (JSON error) where the <audio> element can't. */
  private async explainError() {
    const cur = playerStore.get().current;
    if (!cur) return;
    let msg = 'It would not play.';
    try {
      const r = await fetch(cur.url, { headers: { range: 'bytes=0-1' } });
      if (!r.ok) { const b = await r.json().catch(() => null); msg = b?.error ?? `${r.status}`; }
      else msg = 'The format is not supported by this browser.';
      r.body?.cancel().catch(() => {});
    } catch { msg = 'The brain did not answer.'; }
    patch({ playing: false, loading: false, error: msg });
  }

  /** Play a track (optionally as part of a queue). On a hotspot with save-data on, asks first. */
  play(track: Track, queue: Track[] = [track], index = Math.max(0, queue.findIndex((t) => t.id === track.id)), force = false) {
    if (track.dataHeavy && savingData(stateStore.get()) && !this.agreed && !force) { patch({ confirm: { track, queue, index } }); return; }
    if (force) this.agreed = true;
    const prev = playerStore.get().current;
    if (prev && prev.source !== track.source) sendQuiet(mediaMessage(prev.source, null));
    this.onStartOther?.();
    const a = this.el();
    a.src = track.url;
    a.volume = playerStore.get().ducked ? 0.2 : 1;
    patch({ current: track, queue, index, loading: true, playing: false, error: null, confirm: null, positionS: null, durationS: null });
    a.play().catch((e: Error) => { if (e.name !== 'AbortError') patch({ loading: false, error: e.name === 'NotAllowedError' ? 'Tap play: the browser blocked sound until the screen is touched.' : e.message }); });
    clearInterval(this.radioTimer);
    if (track.source === 'radio') { this.radioTimer = window.setInterval(() => void this.radioTitle(), 10_000); setTimeout(() => void this.radioTitle(), 2500); }
    this.publish();
  }

  confirmData(yes: boolean) {
    const c = playerStore.get().confirm;
    patch({ confirm: null });
    if (yes && c) this.play(c.track, c.queue, c.index, true);
  }

  private async radioTitle() {
    const cur = playerStore.get().current;
    if (cur?.source !== 'radio') { clearInterval(this.radioTimer); return; }
    try {
      const n = await api<{ stationId: string; title: string | null; artist: string | null } | null>('/api/media/radio/now');
      if (n && n.stationId === cur.id && (n.title !== cur.title || n.artist !== cur.artist)) {
        const t = { ...cur, title: n.title ?? cur.album, artist: n.artist };
        patch({ current: t });
        this.publish();
      }
    } catch { /* the title is a nicety */ }
  }

  toggle() {
    const a = this.audio, cur = playerStore.get().current;
    if (!a || !cur) return;
    if (a.paused) {
      if (cur.live) this.play(cur, playerStore.get().queue, playerStore.get().index, true); // a live stream restarts at "now"
      else void a.play().catch(() => {});
    } else { a.pause(); if (cur.live) a.removeAttribute('src'); }
    this.publish();
  }

  next(): boolean {
    const st = playerStore.get();
    if (!st.current || st.current.live || st.index + 1 >= st.queue.length) return false;
    this.play(st.queue[st.index + 1], st.queue, st.index + 1, true);
    return true;
  }

  prev() {
    const st = playerStore.get(), a = this.audio;
    if (!st.current || st.current.live) return;
    if (a && a.currentTime > 4) { a.currentTime = 0; return; }
    if (st.index > 0) this.play(st.queue[st.index - 1], st.queue, st.index - 1, true);
  }

  seek(s: number) { const a = this.audio; if (a && Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, s)); }

  stop() {
    const cur = playerStore.get().current;
    clearInterval(this.radioTimer);
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    if (cur?.source === 'fm') void api('/api/media/fm/stop', { method: 'POST' }).catch(() => {});
    patch({ current: null, queue: [], index: 0, playing: false, loading: false, error: null, positionS: null, durationS: null });
    if (cur) sendQuiet(mediaMessage(cur.source, null));
    this.sent = '';
    this.lastSource = null;
  }

  /** Quieter while WOPR listens and talks. */
  duck(on: boolean) {
    patch({ ducked: on });
    if (this.audio) this.audio.volume = on ? 0.2 : 1;
  }

  private publish() {
    const st = playerStore.get();
    const cur = st.current;
    if (!cur) return;
    const msg = mediaMessage(cur.source, st.playing || st.loading || !this.audio?.paused ? cur : null);
    const key = JSON.stringify(msg);
    if (key === this.sent && this.lastSource === cur.source) return;
    if (sendQuiet(msg)) { this.sent = key; this.lastSource = cur.source; }
  }

  /** Called by the store when playing flips, so a pause reports "nothing". */
  sync() { this.publish(); }
}

export const player = new Player();
let lastPlaying = false;
playerStore.sub(() => { const p = playerStore.get().playing; if (p !== lastPlaying) { lastPlaying = p; player.sync(); } });
