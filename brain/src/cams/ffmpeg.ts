// ffmpeg pieces: argument builders (pure, tested), an MJPEG frame splitter, and a
// supervised process. Used for the desk fallback (no go2rtc: the brain serves
// MJPEG itself) and, with go2rtc, for the dashcam recorder and motion detection.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { CameraConfig } from '../remote/types.ts';
import { testPattern } from './go2rtc.ts';

/** Input args for reading a camera directly (no go2rtc). */
export function inputArgs(c: CameraConfig, index: number): string[] {
  if (c.source === 'test') return ['-re', '-f', 'lavfi', '-i', testPattern(c, index)];
  if (c.source === 'rtsp') return ['-rtsp_transport', 'tcp', '-i', c.url!];
  return ['-f', 'v4l2', ...(c.inputFormat !== 'auto' ? ['-input_format', c.inputFormat] : []), '-video_size', `${c.width}x${c.height}`, '-framerate', String(c.fps), '-i', c.device!];
}

/** Input args for reading a camera back out of go2rtc's RTSP server (video only). */
export const go2rtcInput = (rtsp: string, id: string) => ['-rtsp_transport', 'tcp', '-i', `rtsp://${rtsp}/${id}?video`];

/** MJPEG to stdout, at most 15 fps: the live view when there is no go2rtc. */
export const mjpegOutput = (fps: number) => ['-map', '0:v', '-an', '-c:v', 'mjpeg', '-q:v', '6', '-r', String(Math.min(fps, 15)), '-f', 'mjpeg', 'pipe:1'];

/**
 * Loop-recording output: one file per segment, named by its local start time
 * (YYYYMMDD-HHMMSS.mp4). Fragmented MP4, so a segment cut short by a power loss
 * still plays. `copy` = the input is already H.264 (go2rtc); otherwise x264.
 */
export function segmentOutput(dir: string, segmentSec: number, copy: boolean, fps: number): string[] {
  const codec = copy ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', String(fps * 2)];
  return ['-map', '0:v', '-an', ...codec, '-f', 'segment', '-segment_time', String(segmentSec), '-segment_format', 'mp4',
    '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof', '-reset_timestamps', '1', '-strftime', '1',
    path.join(dir, '%Y%m%d-%H%M%S.mp4')];
}

/** Scene-change motion detection: prints lavfi.scene_score for frames above `threshold`. */
export const motionOutput = (threshold: number) => ['-map', '0:v', '-an', '-vf', `fps=2,scale=320:-2,select='gt(scene\\,${threshold})',metadata=print:file=-`, '-f', 'null', '-'];

/** Pull scene scores out of metadata=print lines. */
export function sceneScores(text: string): number[] {
  return [...text.matchAll(/lavfi\.scene_score=([0-9.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
}

const base = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
export const ffArgs = (...parts: string[][]) => [...base, ...parts.flat()];

/** Splits an MJPEG byte stream into JPEG frames (SOI 0xFFD8 ... EOI 0xFFD9). */
export class MjpegSplitter {
  private buf: Buffer = Buffer.alloc(0);
  private onFrame: (jpeg: Buffer) => void;
  constructor(onFrame: (jpeg: Buffer) => void) { this.onFrame = onFrame; }
  push(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const start = this.buf.indexOf(SOI);
      if (start < 0) { this.buf = Buffer.alloc(0); return; }
      const end = this.buf.indexOf(EOI, start + 2);
      if (end < 0) { if (start > 0) this.buf = this.buf.subarray(start); if (this.buf.length > 8 * 1024 * 1024) this.buf = Buffer.alloc(0); return; }
      this.onFrame(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
  }
}
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** An ffmpeg that should keep running: restarted with backoff when it exits, until stop(). */
export class FfmpegJob {
  private child: ChildProcess | null = null;
  private stopped = true;
  private backoff = 1000;
  private timer: NodeJS.Timeout | null = null;
  lastError: string | null = null;
  startedAt = 0;
  private bin: string;
  private args: () => string[];
  private name: string;
  onStdout: ((d: Buffer) => void) | null = null;
  constructor(bin: string, name: string, args: () => string[]) { this.bin = bin; this.name = name; this.args = args; }

  get running() { return !!this.child; }

  start() { if (!this.stopped) return; this.stopped = false; this.spawn(); }

  /** New arguments take effect: kill and let the supervisor respawn at once. */
  restart() { this.backoff = 1000; if (this.child) this.child.kill('SIGINT'); else if (!this.stopped) this.spawn(); }

  private spawn() {
    if (this.stopped || this.child) return;
    let c: ChildProcess;
    try { c = spawn(this.bin, this.args(), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { this.lastError = (e as Error).message; return; }
    this.child = c;
    this.startedAt = Date.now();
    c.stdout?.on('data', (d: Buffer) => this.onStdout?.(d));
    c.stderr?.on('data', (d: Buffer) => { const l = d.toString().trim(); if (l) this.lastError = l.split(/\r?\n/).pop()!.slice(0, 240); });
    c.on('error', (e) => { this.lastError = (e as NodeJS.ErrnoException).code === 'ENOENT' ? `${this.bin} not found` : e.message; });
    c.on('exit', (code) => {
      this.child = null;
      if (this.stopped) return;
      if (Date.now() - this.startedAt > 30_000) this.backoff = 1000;
      if (code) console.warn(`[cams] ${this.name}: ffmpeg exited ${code}${this.lastError ? ` (${this.lastError})` : ''}; retry in ${this.backoff / 1000} s`);
      this.timer = setTimeout(() => this.spawn(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // SIGINT lets ffmpeg close the current segment cleanly.
    const c = this.child;
    this.child = null;
    if (c) { c.kill('SIGINT'); setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref(); }
  }
}
