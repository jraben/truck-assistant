// Cameras on the brain. Two backends:
//  - go2rtc (the Pi): go2rtc reads every camera once and serves WebRTC/MSE to
//    viewers; the brain records from go2rtc's RTSP and watches for motion there.
//  - fallback (a desk without go2rtc, or a Pi where it isn't installed): one
//    ffmpeg per camera, MJPEG served by the brain (/api/cams/:id/mjpeg) and,
//    for recorded cameras, the dashcam segments from the same process.
import path from 'node:path';
import type { RemoteSettings, CamStatus, CameraConfig } from '../remote/types.ts';
import type { Dashcam } from './dashcam.ts';
import { ffArgs, FfmpegJob, go2rtcInput, inputArgs, MjpegSplitter, mjpegOutput, motionOutput, sceneScores, segmentOutput } from './ffmpeg.ts';
import { Go2rtcProcess, go2rtcConfig, probeBinary, type Go2rtcPorts } from './go2rtc.ts';

export type Frame = { jpeg: Buffer; at: number };
type Live = { job: FfmpegJob; subs: Set<(f: Frame) => void>; latest: Frame | null; idleTimer: NodeJS.Timeout | null; record: boolean; key: string };

const IDLE_STOP_MS = 10_000;

export type CamOptions = { go2rtcBin: string; ffmpegBin: string; ports: Go2rtcPorts; configFile: string; external: boolean; disabled: boolean };

export class CamManager {
  backend: CamStatus['backend'] = 'off';
  why: string | null = 'starting';
  ffmpeg = false;
  private go2rtc: Go2rtcProcess | null = null;
  private live = new Map<string, Live>();
  private recorders = new Map<string, { job: FfmpegJob; key: string }>();
  private motion = new Map<string, { job: FfmpegJob; key: string }>();
  private parked = false;
  private s: RemoteSettings;
  private opt: CamOptions;
  private dashcam: Dashcam;
  onMotion: ((camera: string, score: number) => void) | null = null;

  constructor(settings: RemoteSettings, dashcam: Dashcam, opt: CamOptions) {
    this.s = settings; this.dashcam = dashcam; this.opt = opt;
    dashcam.isRecording = (id) => this.isRecording(id);
  }

  async start() {
    if (this.opt.disabled) { this.backend = 'off'; this.why = 'CAMS_DISABLED=1'; return; }
    this.ffmpeg = (await probeBinary(this.opt.ffmpegBin)) !== null;
    const g = this.opt.external ? 'external' : await probeBinary(this.opt.go2rtcBin);
    if (g) {
      this.backend = 'go2rtc';
      this.why = null;
      this.go2rtc = new Go2rtcProcess(this.opt.go2rtcBin, this.opt.configFile);
      this.go2rtc.write(go2rtcConfig(this.s.cams.cameras, this.opt.ports));
      if (!this.opt.external) this.go2rtc.start();
      console.log(`[cams] go2rtc (${g}), API ${this.opt.ports.api}, WebRTC ${this.opt.ports.webrtc}`);
    } else if (this.ffmpeg) {
      this.backend = 'fallback';
      this.why = 'go2rtc is not installed here: live view is MJPEG from ffmpeg, served by the brain (desk fallback)';
      console.log('[cams] no go2rtc: desk fallback (ffmpeg MJPEG)');
    } else {
      this.backend = 'off';
      this.why = 'neither go2rtc nor ffmpeg is installed (deploy/pi/install.sh installs both)';
      console.warn(`[cams] ${this.why}`);
    }
    this.reconcile();
  }

  stop() {
    for (const l of this.live.values()) { l.job.stop(); if (l.idleTimer) clearTimeout(l.idleTimer); }
    for (const r of this.recorders.values()) r.job.stop();
    for (const m of this.motion.values()) m.job.stop();
    this.live.clear(); this.recorders.clear(); this.motion.clear();
    this.go2rtc?.stop();
  }

  apply(next: RemoteSettings) {
    const camsChanged = JSON.stringify(next.cams.cameras) !== JSON.stringify(this.s.cams.cameras);
    this.s = next;
    if (this.backend === 'go2rtc' && camsChanged && this.go2rtc) {
      this.go2rtc.write(go2rtcConfig(next.cams.cameras, this.opt.ports));
      if (!this.opt.external) this.go2rtc.restart();
    }
    this.reconcile();
  }

  setParked(parked: boolean) { if (parked !== this.parked) { this.parked = parked; this.reconcile(); } }

  camera(id: string): CameraConfig | undefined { return this.s.cams.cameras.find((c) => c.id === id && c.enabled); }

  recordedCameras(): string[] {
    if (this.backend === 'off' || !this.s.dashcam.enabled) return [];
    return this.s.cams.cameras.filter((c) => c.enabled && c.record).map((c) => c.id);
  }

  isRecording(id: string) {
    return !!(this.recorders.get(id)?.job.running || (this.live.get(id)?.record && this.live.get(id)?.job.running));
  }

  /** Start/stop processes so they match the settings. Idempotent. */
  private reconcile() {
    const d = this.s.dashcam;
    this.dashcam.segmentSec = d.segmentSec;
    this.dashcam.capBytes = d.capGb * 1024 ** 3;
    const rec = new Set(this.recordedCameras());
    if (this.backend === 'go2rtc') {
      for (const [id, r] of this.recorders) if (!rec.has(id)) { r.job.stop(); this.recorders.delete(id); }
      for (const id of rec) {
        const c = this.camera(id)!;
        const key = JSON.stringify([c, d.segmentSec]);
        const cur = this.recorders.get(id);
        if (cur?.key === key) continue;
        cur?.job.stop();
        const dir = this.dashcam.cameraDir(id);
        // H.264 from go2rtc: copy, no re-encode.
        const job = new FfmpegJob(this.opt.ffmpegBin, `record ${id}`, () => ffArgs(go2rtcInput(this.opt.ports.rtsp, id), segmentOutput(dir, d.segmentSec, true, c.fps)));
        this.recorders.set(id, { job, key });
        job.start();
      }
      // Parked motion: scene detection on the recorded real cameras (test patterns always "move").
      const want = this.parked && d.parkedMotion ? [...rec].filter((id) => this.camera(id)?.source !== 'test') : [];
      for (const [id, m] of this.motion) if (!want.includes(id)) { m.job.stop(); this.motion.delete(id); }
      for (const id of want) {
        const key = String(d.sceneThreshold);
        if (this.motion.get(id)?.key === key) continue;
        this.motion.get(id)?.job.stop();
        const job = new FfmpegJob(this.opt.ffmpegBin, `motion ${id}`, () => ffArgs(go2rtcInput(this.opt.ports.rtsp, id), motionOutput(this.s.dashcam.sceneThreshold)));
        job.onStdout = (b) => { const sc = sceneScores(b.toString()); if (sc.length) this.onMotion?.(id, Math.max(...sc)); };
        this.motion.set(id, { job, key });
        job.start();
      }
    } else if (this.backend === 'fallback') {
      for (const [id, l] of this.live) {
        const c = this.camera(id);
        if (!c) { l.job.stop(); this.live.delete(id); continue; }
        const key = JSON.stringify([c, rec.has(id), d.segmentSec]);
        if (l.key !== key) { l.record = rec.has(id); l.key = key; l.job.restart(); }
        if (!l.record && !l.subs.size) this.idleSoon(id, l);
      }
      for (const id of rec) if (!this.live.has(id)) this.ensureLive(id);
    }
  }

  /** Fallback: the per-camera ffmpeg (MJPEG out, plus segments when recorded). */
  private ensureLive(id: string): Live | null {
    if (this.backend !== 'fallback') return null;
    const have = this.live.get(id);
    if (have) return have;
    const c = this.camera(id);
    if (!c) return null;
    const rec = this.recordedCameras().includes(id);
    const l: Live = { job: null as unknown as FfmpegJob, subs: new Set(), latest: null, idleTimer: null, record: rec, key: JSON.stringify([c, rec, this.s.dashcam.segmentSec]) };
    l.job = new FfmpegJob(this.opt.ffmpegBin, `live ${id}`, () => {
      const cam = this.camera(id) ?? c;
      const outs = [mjpegOutput(cam.fps)];
      if (l.record) outs.push(segmentOutput(this.dashcam.cameraDir(id), this.s.dashcam.segmentSec, false, cam.fps));
      return ffArgs(inputArgs(cam, this.s.cams.cameras.indexOf(cam)), ...outs);
    });
    const split = new MjpegSplitter((jpeg) => {
      const f = { jpeg, at: Date.now() };
      l.latest = f;
      for (const cb of l.subs) { try { cb(f); } catch { /* subscriber gone */ } }
    });
    l.job.onStdout = (b) => split.push(b);
    this.live.set(id, l);
    l.job.start();
    return l;
  }

  private idleSoon(id: string, l: Live) {
    if (l.idleTimer) return;
    l.idleTimer = setTimeout(() => {
      l.idleTimer = null;
      if (l.subs.size || l.record) return;
      l.job.stop();
      this.live.delete(id);
    }, IDLE_STOP_MS);
  }

  /** Fallback live frames. Returns an unsubscribe, or null when that camera can't stream here. */
  subscribe(id: string, cb: (f: Frame) => void): (() => void) | null {
    const l = this.ensureLive(id);
    if (!l) return null;
    if (l.idleTimer) { clearTimeout(l.idleTimer); l.idleTimer = null; }
    l.subs.add(cb);
    if (l.latest && Date.now() - l.latest.at < 2000) cb(l.latest);
    return () => { l.subs.delete(cb); if (!l.subs.size && !l.record) this.idleSoon(id, l); };
  }

  /** A JPEG of what the camera sees now (Truck page thumbnails, HA). */
  async snapshot(id: string): Promise<Buffer | null> {
    if (!this.camera(id)) return null;
    if (this.backend === 'go2rtc') {
      try {
        const r = await fetch(`http://${this.opt.ports.api}/api/frame.jpeg?src=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch { return null; }
    }
    return new Promise((resolve) => {
      let done = false;
      let unsub: (() => void) | null = null;
      const finish = (b: Buffer | null) => { if (done) return; done = true; clearTimeout(t); setImmediate(() => unsub?.()); resolve(b); };
      const t = setTimeout(() => finish(null), 6000);
      unsub = this.subscribe(id, (f) => finish(f.jpeg));
      if (!unsub) finish(null);
    });
  }

  /** go2rtc's API base (for the WebSocket and player-script proxies). */
  get go2rtcApi() { return this.backend === 'go2rtc' ? `http://${this.opt.ports.api}` : null; }

  status(stats: { bytes: number; segments: number; locked: number }, recError: string | null): CamStatus {
    const rec = this.recordedCameras();
    return {
      backend: this.backend, why: this.why, ffmpeg: this.ffmpeg,
      cameras: this.s.cams.cameras.map((c) => {
        const l = this.live.get(c.id);
        const r = this.recorders.get(c.id);
        const err = this.backend === 'fallback' ? l?.job.lastError ?? null : this.backend === 'go2rtc' ? r?.job.lastError ?? this.go2rtc?.lastError ?? null : this.why;
        return { ...c, live: this.backend === 'go2rtc' ? c.enabled && (this.opt.external || !!this.go2rtc?.running) : !!l?.job.running, error: c.enabled ? err : null };
      }),
      recording: { enabled: this.s.dashcam.enabled && this.backend !== 'off', cameras: rec.filter((id) => this.isRecording(id)), bytes: stats.bytes, capBytes: this.s.dashcam.capGb * 1024 ** 3, segments: stats.segments, locked: stats.locked, error: recError },
      guides: this.s.cams.guides, autoRear: this.s.cams.autoRear, defaultLayout: this.s.cams.defaultLayout,
    };
  }
}

export const go2rtcConfigPath = (dataDir: string) => path.join(dataDir, 'go2rtc.yaml');
