// CarPlay on the main thread: starts the worker (or the simulator), owns the
// video canvas, audio, mic and touch, and publishes status and now playing
// to the UI and the brain. One instance for the page's life, so music keeps
// playing while another view is on screen.
import './polyfills.ts';
import { requestDevice } from './vendor/node-carplay/web/CarplayWeb.js';
import { CommandMapping, TouchAction } from './vendor/node-carplay/modules/index.js';
import type { DongleConfig } from './vendor/node-carplay/modules/DongleDriver.js';
import { linkStore, sendQuiet, stateStore, store } from '../lib/brain.ts';
import { AudioOut } from './audio.ts';
import { dongleDpi, dongleSize, mapTouch, mapTouchClamped, type Size } from './geometry.ts';
import { brainMedia, emptyNowPlaying, mergeMedia, type NowPlaying } from './media.ts';
import { MicIn } from './mic.ts';
import type { FromWorker, Status, ToWorker } from './protocol.ts';
import { carplaySimWanted, SimSource, SimVideo } from './sim.ts';
import { noDecoderReason, VideoSink, webCodecsSupported, type VideoStats } from './video.ts';

export type { Status } from './protocol.ts';

export type CarPlayState = {
  status: Status | 'idle';
  reason: string | null;
  retryAt: number | null;      // Date.now() of the next automatic retry, when failed
  sim: boolean;
  video: VideoStats | null;
  webCodecs: boolean;
  /** Why the simulator plays its MP4 instead of decoding H.264 (no WebCodecs, or it failed); null = WebCodecs. */
  simVideo: string | null;
  requested: { width: number; height: number; fps: number; dpi: number } | null;
  accepted: { width: number; height: number; fps: number } | null;  // the dongle's Opened reply
  soundBlocked: boolean;
  mic: boolean;
  micError: string | null;
  error: string | null;           // last video/audio error, for the overlay
};

export const carplayStore = store<CarPlayState>({
  status: 'idle', reason: null, retryAt: null, sim: false, video: null, webCodecs: true, simVideo: null,
  requested: null, accepted: null, soundBlocked: false, mic: false, micError: null, error: null,
});
/** Null when nothing is playing or CarPlay isn't connected. */
export const nowPlayingStore = store<NowPlaying | null>(null);

const LS_SIZE = 'slate.carplay.size';
const LS_FPS = 'slate.carplay.fps';
const FPS_WANT = 30;
const FPS_FALLBACK = 20;
/** No picture this long after the phone connects at 30 fps: fall back to 20. */
const NO_VIDEO_MS = 15_000;

const lsGet = <T>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

function patch(p: Partial<CarPlayState>) { carplayStore.set({ ...carplayStore.get(), ...p }); }

class CarPlayController {
  private worker: Worker | null = null;
  private sim: SimSource | null = null;
  private video: VideoSink | null = null;
  private simVideo: SimVideo | null = null;
  private audio = new AudioOut();
  private mic: MicIn | null = null;
  private host: HTMLElement | null = null;
  private dots: HTMLElement | null = null;
  private started = false;
  private size: Size | null = null;          // what the dongle was started with
  private night = false;
  private pointerDown: number | null = null;
  private noVideoTimer: ReturnType<typeof setTimeout> | null = null;
  private sentMediaKey = '';
  private nowPlaying: NowPlaying = emptyNowPlaying();

  /** Start at page load. `?carplaySim=1`, or the test panel's switch, runs the simulator instead of the dongle. */
  init() {
    if (this.started) return;
    this.started = true;
    const sim = carplaySimWanted();
    patch({ sim, webCodecs: webCodecsSupported() });
    this.audio.onBlocked = (b) => patch({ soundBlocked: b });
    this.audio.onMic = (open) => { if (open) void this.mic?.start(); else this.mic?.stop(); };
    if (webCodecsSupported()) {
      this.video = new VideoSink();
      this.video.onNeedKey = () => this.post({ type: 'frame' });
      this.video.onStats = (v) => { patch({ video: { ...v } }); if (v.width) this.clearNoVideo(); };
      this.video.onError = (e) => {
        console.warn(`[carplay] ${e}`);
        // The simulator has a plan B for a decoder that won't take its clip; the dongle doesn't.
        if (carplayStore.get().sim) this.useSimVideo(`WebCodecs couldn't decode the clip (${e}); playing the MP4 instead.`);
        else patch({ error: e });
      };
    } else if (sim) {
      this.useSimVideo(noDecoderReason({ secure: isSecureContext, origin: location.origin }) + ' The simulator plays its MP4 instead.');
    }
    this.size = lsGet<Size>(LS_SIZE);

    // The brain hears what is playing; resend after the WebSocket reconnects.
    nowPlayingStore.sub(() => this.publishMedia());
    linkStore.sub(() => { if (linkStore.get().connected) { this.sentMediaKey = ''; this.publishMedia(); } });
    // Reversing: the camera owns the screen; let go of any touch in progress.
    stateStore.sub(() => { if (stateStore.get()?.reverse === true && this.pointerDown !== null) this.endTouch(); });

    addEventListener('pagehide', () => this.stop());
    addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) this.start(); });

    if (sim) this.startSim();
    else this.start();
  }

  // ---- dongle -----------------------------------------------------------------

  private config(): Partial<DongleConfig> {
    const size = this.size ?? this.estimateSize();
    const fps = lsGet<number>(LS_FPS) === FPS_FALLBACK ? FPS_FALLBACK : FPS_WANT;
    const dpi = dongleDpi();
    patch({ requested: { width: size.w, height: size.h, fps, dpi } });
    return { width: size.w, height: size.h, fps, dpi, nightMode: this.night, micType: 'os', boxName: 'Slate', mediaDelay: 300, wifiType: '5ghz' };
  }

  /** Before the CarPlay panel has ever been measured: the default layout's 10 of 12 columns. */
  private estimateSize(): Size {
    const dpr = devicePixelRatio || 1;
    return dongleSize((innerWidth - 112 - 32) * (10 / 12), innerHeight - 56 - 32, dpr);
  }

  start() {
    if (carplayStore.get().sim) { this.startSim(); return; }
    if (!('usb' in navigator) || !navigator.usb) { patch({ status: 'no-webusb', reason: null }); return; }
    if (!this.worker) {
      this.worker = new Worker(new URL('./carplay.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);
      this.worker.onerror = (e) => patch({ status: 'failed', reason: `CarPlay worker crashed: ${e.message}` });
      this.mic = new MicIn((port) => this.post({ type: 'micPort', port }, [port]));
      this.mic.onState = (open, err) => patch({ mic: open, micError: err ?? null });
    }
    this.post({ type: 'start', config: this.config() });
    this.post({ type: 'night', on: this.night });
  }

  stop() {
    this.sim?.stop();
    this.post({ type: 'stop' });
    this.mic?.stop();
    this.onPhoneGone();
  }

  /** "Connect dongle" (a user gesture): the browser's USB chooser, then start. */
  async connectDongle() {
    const dev = await requestDevice();
    if (dev) this.start();
  }

  retry() { this.start(); }

  private post(m: ToWorker, transfer?: Transferable[]) { this.worker?.postMessage(m, transfer ?? []); }

  private onWorker(m: FromWorker) {
    switch (m.type) {
      case 'status':
        patch({ status: m.status, reason: m.reason ?? null, retryAt: m.retryInMs ? Date.now() + m.retryInMs : null });
        if (m.status !== 'connected') this.clearNoVideo();
        break;
      case 'opened':
        patch({ accepted: { width: m.width, height: m.height, fps: m.fps } });
        // The dongle answers Open with what it will do; below 30 means 30 was refused.
        if (m.fps && m.fps < FPS_WANT && lsGet<number>(LS_FPS) !== FPS_FALLBACK) {
          console.warn(`[carplay] dongle runs at ${m.fps} fps, not ${FPS_WANT}; using ${FPS_FALLBACK} from now on`);
          lsSet(LS_FPS, FPS_FALLBACK);
        }
        break;
      case 'plugged':
        this.armNoVideo();
        break;
      case 'unplugged':
        this.onPhoneGone();
        break;
      case 'video':
        this.video?.push(new Uint8Array(m.buf, m.offset, m.length));
        break;
      case 'audio': {
        const pcm = m.offset % 2 === 0 ? new Int16Array(m.buf, m.offset, m.length >> 1) : new Int16Array(m.buf.slice(m.offset, m.offset + m.length));
        this.audio.push(m.decodeType, m.audioType, pcm);
        break;
      }
      case 'audioCtl':
        this.audio.control(m.decodeType, m.audioType, m.command, m.volume, m.volumeDuration);
        break;
      case 'media':
        this.onMedia(m.payload);
        break;
      case 'command':
        // Some firmwares say "record" with a command rather than a Siri/call audio command.
        if (m.value === CommandMapping.startRecordAudio) void this.mic?.start();
        else if (m.value === CommandMapping.stopRecordAudio) this.mic?.stop();
        break;
      case 'log':
        console[m.level](`[carplay] ${m.message}`);
        break;
    }
  }

  /** Connected at 30 fps but no picture: some dongles accept 30 and then send nothing. */
  private armNoVideo() {
    this.clearNoVideo();
    if (carplayStore.get().requested?.fps !== FPS_WANT) return;
    this.noVideoTimer = setTimeout(() => {
      if (carplayStore.get().video?.width) return;
      console.warn(`[carplay] no video ${NO_VIDEO_MS / 1000}s after connecting at ${FPS_WANT} fps; retrying at ${FPS_FALLBACK}`);
      lsSet(LS_FPS, FPS_FALLBACK);
      this.start();
    }, NO_VIDEO_MS);
  }
  private clearNoVideo() { if (this.noVideoTimer) { clearTimeout(this.noVideoTimer); this.noVideoTimer = null; } }

  private onPhoneGone() {
    this.clearNoVideo();
    this.video?.reset();
    this.simVideo?.pause();
    this.audio.reset();
    this.nowPlaying = emptyNowPlaying();
    nowPlayingStore.set(null);
    patch({ video: null, mic: false });
  }

  // ---- simulator --------------------------------------------------------------

  private startSim() {
    patch({ sim: true, requested: { width: 1280, height: 480, fps: 30, dpi: dongleDpi() } });
    this.sim?.stop();
    this.sim = new SimSource({
      status: (s, reason) => patch({ status: s, reason: reason ?? null, retryAt: null }),
      plugged: () => this.simVideo?.play(),
      video: (au) => this.video?.push(au),
      skipped: () => this.video?.discontinuity(),
      media: (p) => this.onMedia(p),
    });
    void this.sim.start();
  }

  /** Switch the simulator's picture to the MP4 <video> (once); the SimSource keeps driving status and now playing. */
  private useSimVideo(reason: string) {
    patch({ simVideo: reason, error: null });
    if (this.simVideo) return;
    console.warn(`[carplay sim] ${reason}`);
    const host = this.host;
    if (host) this.detach(host);
    if (this.video) { this.video.onStats = () => {}; this.video.onError = () => {}; this.video.reset(); this.video = null; }
    const sv = new SimVideo();
    sv.onStats = (v) => patch({ video: { ...v, dropped: 0, codec: 'mp4' } });
    sv.onError = (e) => { console.warn(`[carplay sim] ${e}`); patch({ error: e }); };
    this.simVideo = sv;
    if (host) this.attach(host);
    if (carplayStore.get().status === 'connected') sv.play();
  }

  /** What shows the picture: the decoder's canvas, or the simulator's MP4. */
  private surface(): HTMLElement | null { return this.simVideo?.el ?? this.video?.canvas ?? null; }

  // ---- now playing ------------------------------------------------------------

  private onMedia(payload: unknown) {
    this.nowPlaying = mergeMedia(this.nowPlaying, payload);
    const np = this.nowPlaying;
    nowPlayingStore.set(np.title || np.artist ? { ...np } : null);
  }

  private publishMedia() {
    const msg = brainMedia(nowPlayingStore.get());
    const key = JSON.stringify(msg);
    if (key === this.sentMediaKey) return;     // position ticks don't go to the brain
    if (sendQuiet(msg)) this.sentMediaKey = key;
  }

  // ---- night mode ---------------------------------------------------------------

  setNight(on: boolean) {
    if (on === this.night) return;
    this.night = on;
    this.post({ type: 'night', on });
  }

  // ---- canvas, size, touch ------------------------------------------------------------

  /** The CarPlay widget mounted: put the canvas in it and size the dongle to it. */
  attach(host: HTMLElement) {
    this.host = host;
    const c = this.surface();
    if (c) {
      host.appendChild(c);
      c.onpointerdown = (e) => this.onPointer(e, TouchAction.Down);
      c.onpointermove = (e) => this.onPointer(e, TouchAction.Move);
      c.onpointerup = (e) => this.onPointer(e, TouchAction.Up);
      c.onpointercancel = (e) => this.onPointer(e, TouchAction.Up);
      this.video?.shown();
    }
    if (carplayStore.get().sim) {
      this.dots = document.createElement('div');
      this.dots.className = 'cpdots';
      host.appendChild(this.dots);
    }
    requestAnimationFrame(() => this.measure());
  }

  detach(host: HTMLElement) {
    if (this.host !== host) return;
    if (this.pointerDown !== null) this.endTouch();
    this.surface()?.remove();
    this.dots?.remove(); this.dots = null;
    this.host = null;
  }

  private measure() {
    if (!this.host || carplayStore.get().sim) return;
    const r = this.host.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    const want = dongleSize(r.width, r.height, devicePixelRatio || 1);
    const had = this.size;
    if (had && Math.abs(had.w - want.w) <= 16 && Math.abs(had.h - want.h) <= 16) return;
    lsSet(LS_SIZE, want);
    this.size = want;
    // First measurement ever, or the phone isn't connected yet: restart at the real size now.
    // Connected with a stored (different) size: letterbox until the next start rather than drop the session.
    if (!had || carplayStore.get().status !== 'connected') this.start();
  }

  private videoSize(): Size {
    const v = carplayStore.get().video;
    if (v?.width) return { w: v.width, h: v.height };
    const r = carplayStore.get().requested;
    return r ? { w: r.width, h: r.height } : { w: 16, h: 9 };
  }

  private onPointer(e: PointerEvent, action: number) {
    if (!e.isPrimary) return;                                 // single-touch
    if (stateStore.get()?.reverse === true) return;           // camera takeover
    const c = e.currentTarget as HTMLElement;
    const rect = c.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const el = { w: rect.width, h: rect.height };
    if (action === TouchAction.Down) {
      const p = mapTouch(px, py, el, this.videoSize());
      if (!p) return;                                        // on the letterbox bars
      c.setPointerCapture?.(e.pointerId);
      this.pointerDown = e.pointerId;
      this.touch(p.x, p.y, action, px, py);
    } else if (this.pointerDown === e.pointerId) {
      const p = mapTouchClamped(px, py, el, this.videoSize());
      this.touch(p.x, p.y, action, px, py);
      if (action === TouchAction.Up) this.pointerDown = null;
    }
  }

  private lastTouch = { x: 0, y: 0 };
  private touch(x: number, y: number, action: number, px: number, py: number) {
    this.lastTouch = { x, y };
    this.post({ type: 'touch', x, y, action });
    if (this.dots) {
      if (action === TouchAction.Down || action === TouchAction.Up) console.debug(`[carplay sim] touch ${action === TouchAction.Down ? 'down' : 'up'} x=${x} y=${y}`);
      const d = document.createElement('i');
      d.className = `cpdot ${action === TouchAction.Down ? 'down' : action === TouchAction.Up ? 'up' : ''}`;
      d.style.left = `${px}px`; d.style.top = `${py}px`;
      d.title = `${x.toFixed(4)}, ${y.toFixed(4)}`;
      this.dots.appendChild(d);
      setTimeout(() => d.remove(), 1500);
      while (this.dots.childElementCount > 200) this.dots.firstElementChild?.remove();
    }
  }

  private endTouch() {
    this.post({ type: 'touch', x: this.lastTouch.x, y: this.lastTouch.y, action: TouchAction.Up });
    this.pointerDown = null;
  }

  /** CarPlay hardware-style keys (home, siri, play, next...). */
  key(command: keyof typeof CommandMapping) { this.post({ type: 'key', command }); }

  unlockSound() { this.audio.unlock(); }
}

export const carplay = new CarPlayController();
