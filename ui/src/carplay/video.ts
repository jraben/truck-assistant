// H.264 Annex-B access units -> WebCodecs VideoDecoder -> a canvas that fills
// the CarPlay panel, letterboxed when the picture's aspect differs. When the
// decoder falls behind, frames are dropped up to the next keyframe rather than
// queued: on a dash, late is worse than missing.
import { codecFromSps, findNal, isKeyFrame, NAL } from './h264.ts';
import { fitRect } from './geometry.ts';

/** Decoder queue deeper than this = behind; drop until the next keyframe. */
const MAX_QUEUE = 3;
/** Don't ask the phone for keyframes more often than this. */
const KEY_REQUEST_MS = 1000;

export const webCodecsSupported = () => typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';

/**
 * Why there is no VideoDecoder, in words for the CarPlay overlay. WebCodecs is
 * [SecureContext]: on a plain http:// LAN address (a tablet in a kiosk browser
 * opening http://192.168.x.x) it simply isn't there, however new the browser.
 */
export function noDecoderReason(env: { secure: boolean; origin: string }): string {
  if (!env.secure) {
    return `WebCodecs (VideoDecoder) only exists on a secure origin, and ${env.origin} is plain http. ` +
      'Open the cockpit over https or on localhost to decode CarPlay video.';
  }
  return "This browser has no WebCodecs (VideoDecoder), so CarPlay's picture can't be shown. Chromium 94 or newer has it; the Pi kiosk does.";
}

export type VideoStats = { width: number; height: number; fps: number; dropped: number; codec: string | null };

export class VideoSink {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private decoder: VideoDecoder | null = null;
  private codec: string | null = null;
  private needKey = true;
  private ts = 0;
  private last: VideoFrame | null = null;
  private drawQueued = false;
  private lastKeyAsk = 0;
  private frames = 0;
  private fpsAt = performance.now();
  private resize: ResizeObserver;
  stats: VideoStats = { width: 0, height: 0, fps: 0, dropped: 0, codec: null };
  /** Ask the phone for a keyframe (worker 'frame' command). */
  onNeedKey: () => void = () => {};
  onStats: (s: VideoStats) => void = () => {};
  onError: (msg: string) => void = () => {};

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cpcanvas';
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    this.resize = new ResizeObserver(() => this.fitCanvas());
    this.resize.observe(this.canvas);
    setInterval(() => this.tickStats(), 1000);
  }

  private tickStats() {
    const now = performance.now();
    this.stats = { ...this.stats, fps: Math.round((this.frames * 1000) / (now - this.fpsAt)) };
    this.frames = 0; this.fpsAt = now;
    this.onStats(this.stats);
  }

  private fitCanvas() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.queueDraw(); }
  }

  private requestKey() {
    const now = performance.now();
    if (now - this.lastKeyAsk < KEY_REQUEST_MS) return;
    this.lastKeyAsk = now;
    this.onNeedKey();
  }

  private makeDecoder(codec: string): boolean {
    this.decoder?.close();
    this.decoder = null;
    try {
      const d = new VideoDecoder({
        output: (f) => this.onFrame(f),
        error: (e) => { this.onError(`video decoder: ${e.message}`); this.decoder = null; this.codec = null; this.needKey = true; this.requestKey(); },
      });
      // No `description`: chunks stay Annex-B, with SPS/PPS in band.
      d.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' });
      this.decoder = d; this.codec = codec; this.stats = { ...this.stats, codec };
      return true;
    } catch (e) {
      this.onError(`video decoder: ${(e as Error).message} (${codec})`);
      return false;
    }
  }

  /** One access unit (a frame's NAL units, Annex-B). */
  push(au: Uint8Array) {
    if (!webCodecsSupported()) return;
    const key = isKeyFrame(au);
    if (key) {
      const sps = findNal(au, NAL.SPS);
      const codec = sps ? codecFromSps(sps) : null;
      if (codec && (codec !== this.codec || !this.decoder || this.decoder.state === 'closed')) {
        if (!this.makeDecoder(codec)) return;
      }
    }
    const d = this.decoder;
    if (!d || d.state !== 'configured') { this.requestKey(); return; }
    if (this.needKey && !key) { this.stats.dropped++; this.requestKey(); return; }
    if (d.decodeQueueSize > MAX_QUEUE) { this.stats.dropped++; this.needKey = true; this.requestKey(); return; }
    this.needKey = false;
    try {
      d.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (this.ts++) * 33_333, data: au }));
    } catch (e) {
      this.onError(`video decode: ${(e as Error).message}`);
      this.needKey = true;
    }
  }

  private onFrame(f: VideoFrame) {
    this.frames++;
    if (f.displayWidth !== this.stats.width || f.displayHeight !== this.stats.height) {
      this.stats = { ...this.stats, width: f.displayWidth, height: f.displayHeight };
      this.onStats(this.stats);
    }
    this.last?.close();   // replaced before it was drawn = dropped, never queued
    this.last = f;
    this.queueDraw();
  }

  private queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  private draw() {
    const { canvas, ctx } = this;
    if (!canvas.isConnected) return;   // the CarPlay view isn't showing; keep the frame for when it is
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const f = this.last;
    if (!f) return;
    const r = fitRect({ w: canvas.width, h: canvas.height }, { w: f.displayWidth, h: f.displayHeight });
    ctx.drawImage(f, r.x, r.y, r.w, r.h);
  }

  /** Frames upstream were lost: wait for the next keyframe before decoding again. */
  discontinuity() { this.needKey = true; this.requestKey(); }

  /** Re-attached to the page: size to the new host and paint the last frame. */
  shown() { this.fitCanvas(); this.queueDraw(); this.requestKey(); }

  /** Phone gone: blank the panel and expect a fresh keyframe. */
  reset() {
    this.last?.close(); this.last = null;
    try { this.decoder?.close(); } catch { /* closed */ }
    this.decoder = null; this.codec = null; this.needKey = true;
    this.stats = { width: 0, height: 0, fps: 0, dropped: 0, codec: null };
    this.queueDraw();
  }
}
