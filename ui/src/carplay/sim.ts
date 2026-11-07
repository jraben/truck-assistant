// Dev simulator (?carplaySim=1): plays a local H.264 Annex-B clip through the
// same decode / render / touch / now-playing path as the dongle, with fake
// MediaData, so the CarPlay view is testable on a desk with no dongle.
import { splitAccessUnits } from './h264.ts';

export const SIM_CLIP_URL = '/carplay-sim/test.h264';
/** The same clip remuxed to MP4, for a browser without WebCodecs (see SimVideo). */
export const SIM_MP4_URL = '/carplay-sim/test.mp4';

/** The test panel's switch: remembered in this browser, so no ?carplaySim=1 is needed. */
const LS_SIM = 'slate.carplaySim';
export function carplaySimWanted(): boolean {
  if (new URLSearchParams(location.search).get('carplaySim') === '1') return true;
  try { return localStorage.getItem(LS_SIM) === '1'; } catch { return false; }
}
/** Flip the simulator and reload (the controller picks its source once, at page load). */
export function setCarplaySim(on: boolean) {
  try { if (on) localStorage.setItem(LS_SIM, '1'); else localStorage.removeItem(LS_SIM); } catch { /* private window */ }
  const u = new URL(location.href);
  u.searchParams.delete('carplaySim');
  location.replace(u.toString());
}
const SIM_FPS = 30; // the clip is generated at 30 fps (scripts/make-carplay-sim-clip.mjs)

const TRACKS = [
  { MediaSongName: 'Desert Highway', MediaArtistName: 'The Simulators', MediaAlbumName: 'Bench Test', MediaSongDuration: 214_000 },
  { MediaSongName: 'Regenerative Braking', MediaArtistName: 'Volt Riders', MediaAlbumName: 'Kilowatt Hours', MediaSongDuration: 187_000 },
  { MediaSongName: 'Supercharger Blues', MediaArtistName: 'Range Anxiety', MediaAlbumName: 'Fifteen Percent', MediaSongDuration: 241_000 },
];

export type SimSink = {
  status: (s: 'connecting' | 'waiting-phone' | 'connected' | 'failed', reason?: string) => void;
  plugged: () => void;
  video: (au: Uint8Array) => void;
  /** Frames were skipped: the decoder must wait for the next keyframe. */
  skipped: () => void;
  media: (payload: unknown) => void;
};

export class SimSource {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private raf = 0;
  private units: Uint8Array[] = [];
  private track = 0;
  private trackStart = 0;
  private running = false;

  constructor(private sink: SimSink) {}

  async start() {
    if (this.running) return;
    this.running = true;
    this.sink.status('connecting');
    try {
      const res = await fetch(SIM_CLIP_URL);
      if (!res.ok) throw new Error(`${SIM_CLIP_URL}: HTTP ${res.status}`);
      this.units = splitAccessUnits(new Uint8Array(await res.arrayBuffer()));
      if (!this.units.length) throw new Error('the clip has no frames');
    } catch (e) {
      this.running = false;
      this.sink.status('failed', `simulator clip: ${(e as Error).message}`);
      return;
    }
    if (!this.running) return;
    this.sink.status('waiting-phone');
    this.timers.push(setTimeout(() => {
      this.sink.plugged();
      this.sink.status('connected');
      this.play();
      this.nextTrack();
      this.timers.push(setInterval(() => this.tickMedia(), 1000) as unknown as ReturnType<typeof setTimeout>);
    }, 1200));
  }

  /** Push access units at real time from a wall clock; skipped ticks are skipped frames. */
  private play() {
    const t0 = performance.now();
    let sent = 0;
    const tick = () => {
      if (!this.running) return;
      const due = Math.floor(((performance.now() - t0) / 1000) * SIM_FPS);
      if (due > sent) {
        // Behind (a throttled tab)? Skip to now, like a real dongle stream would
        // after a stall; the sink drops deltas until the next keyframe.
        if (due - sent > 3) { sent = due - 1; this.sink.skipped(); }
        this.sink.video(this.units[sent % this.units.length]);
        sent++;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private nextTrack() {
    this.track = (this.track + 1) % TRACKS.length;
    this.trackStart = Date.now();
    const t = TRACKS[this.track];
    this.sink.media({ type: 1, media: { ...t, MediaAPPName: 'Simulator', MediaSongPlayTime: 0 } });
    const art = coverArt(t.MediaAlbumName, this.track);
    if (art) this.sink.media({ type: 3, base64Image: art });
  }

  private tickMedia() {
    const t = TRACKS[this.track];
    // Songs are "shortened" to 25 s each so the cycle shows on a desk.
    const played = Date.now() - this.trackStart;
    if (played > 25_000) { this.nextTrack(); return; }
    // The dongle reports the position every few seconds, not every tick.
    if (Math.floor(played / 1000) % 5 === 0) this.sink.media({ type: 1, media: { MediaSongPlayTime: Math.round((played / 25_000) * t.MediaSongDuration) } });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }
}

/**
 * The simulator's picture when WebCodecs can't decode it: the same clip as an
 * MP4 in a muted, looping <video>. Typical case: the test tablet opens the
 * cockpit at http://<LAN IP>, which isn't a secure context, so VideoDecoder
 * doesn't exist. The dongle path has no such fallback (its stream is live H.264).
 */
export class SimVideo {
  readonly el: HTMLVideoElement;
  onStats: (s: { width: number; height: number; fps: number }) => void = () => {};
  onError: (msg: string) => void = () => {};
  private frames = 0;
  private playing = false;

  constructor() {
    const v = document.createElement('video');
    v.className = 'cpcanvas cpvideo-el';
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
    v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.controls = false; v.disablePictureInPicture = true; v.preload = 'auto';
    v.addEventListener('loadedmetadata', () => this.report(0));
    v.addEventListener('error', () => this.onError(`simulator MP4 (${SIM_MP4_URL}): ${v.error?.message || `media error ${v.error?.code ?? '?'}`}`));
    v.src = SIM_MP4_URL;
    this.el = v;
    const countFrame = () => { this.frames++; v.requestVideoFrameCallback(countFrame); };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(countFrame);
    setInterval(() => { this.report(this.frames || (this.playing && !v.paused ? 30 : 0)); this.frames = 0; }, 1000);
  }

  private report(fps: number) {
    const v = this.el;
    if (v.videoWidth) this.onStats({ width: v.videoWidth, height: v.videoHeight, fps });
  }

  play() {
    this.playing = true;
    this.el.play().catch((e: Error) => { if (e.name !== 'AbortError') this.onError(`simulator MP4: ${e.message}`); });
  }

  pause() { this.playing = false; this.el.pause(); }
}

/** A generated album cover (base64 PNG, no data: prefix), like the dongle's AlbumCover packets. */
function coverArt(label: string, n: number): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d')!;
    const hues = [190, 25, 290];
    const grad = g.createLinearGradient(0, 0, 160, 160);
    grad.addColorStop(0, `hsl(${hues[n % 3]} 70% 45%)`);
    grad.addColorStop(1, `hsl(${(hues[n % 3] + 60) % 360} 70% 20%)`);
    g.fillStyle = grad; g.fillRect(0, 0, 160, 160);
    g.fillStyle = '#fff'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), 80, 84);
    return c.toDataURL('image/png').split(',')[1] ?? null;
  } catch { return null; }
}
