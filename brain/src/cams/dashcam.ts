// Dashcam: loop segments on the SSD (written by ffmpeg, see ffmpeg.ts), a size
// cap that deletes the oldest unlocked segments, and "save clip": the last
// preSec + the next postSec, cut out of the loop into clips/ where nothing is
// ever deleted automatically. Segments a pending clip needs are locked until
// the clip is built. The pure parts (names, retention, clip windows) are tested.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Clip } from '../remote/types.ts';

export type Segment = { camera: string; path: string; start: number; bytes: number };

/** "20271104-221503.mp4" -> local time in ms; null for anything else. */
export function parseSegmentName(name: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.mp4$/.exec(name);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const stamp = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };

/**
 * Which segments to delete so the loop fits in capBytes: oldest first, never a
 * locked one, never one still being written. Pure.
 */
export function planRetention(segs: Segment[], capBytes: number, locked: Set<string>, active: Set<string>): string[] {
  let total = segs.reduce((a, s) => a + s.bytes, 0);
  const out: string[] = [];
  for (const s of [...segs].sort((a, b) => a.start - b.start)) {
    if (total <= capBytes) break;
    if (locked.has(s.path) || active.has(s.path)) continue;
    out.push(s.path);
    total -= s.bytes;
  }
  return out;
}

/** The newest segment of each camera: still being written while its recorder runs. */
export function newestPerCamera(segs: Segment[]): Set<string> {
  const best = new Map<string, Segment>();
  for (const s of segs) { const b = best.get(s.camera); if (!b || s.start > b.start) best.set(s.camera, s); }
  return new Set([...best.values()].map((s) => s.path));
}

/**
 * Segments of one camera covering [from, to], and where the clip starts in the
 * first one. A segment runs from its start to the next one's start (or
 * segmentSec). Pure.
 */
export function clipWindow(segs: Segment[], from: number, to: number, segmentSec: number): { segments: Segment[]; offsetS: number; durationS: number } | null {
  const s = [...segs].sort((a, b) => a.start - b.start);
  const picked: Segment[] = [];
  s.forEach((seg, i) => {
    const end = i + 1 < s.length ? s[i + 1].start : seg.start + segmentSec * 1000;
    if (end > from && seg.start < to) picked.push(seg);
  });
  if (!picked.length) return null;
  const start = Math.max(from, picked[0].start);
  return { segments: picked, offsetS: Math.max(0, (start - picked[0].start) / 1000), durationS: Math.max(1, (to - start) / 1000) };
}

/** Is the clip ready to cut: a segment after `to` has started for that camera (so the one covering it is closed)? */
export const windowClosed = (segs: Segment[], to: number) => segs.some((s) => s.start >= to);

export function listSegments(loopDir: string): Segment[] {
  const out: Segment[] = [];
  if (!existsSync(loopDir)) return out;
  for (const cam of readdirSync(loopDir)) {
    const dir = path.join(loopDir, cam);
    let names: string[];
    try { if (!statSync(dir).isDirectory()) continue; names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const start = parseSegmentName(n);
      if (start === null) continue;
      const p = path.join(dir, n);
      try { out.push({ camera: cam, path: p, start, bytes: statSync(p).size }); } catch { /* deleted under us */ }
    }
  }
  return out;
}

type ClipRecord = Clip & { from: number; to: number };

export class Dashcam {
  readonly loopDir: string;
  readonly clipDir: string;
  private locks = new Map<string, Set<string>>();   // segment path -> clip ids holding it
  private pending = new Map<string, ClipRecord>();
  private timer: NodeJS.Timeout | null = null;
  private ffmpeg: string;
  lastError: string | null = null;
  segmentSec = 60;
  capBytes = 64 * 1024 ** 3;
  isRecording: (camera: string) => boolean = () => false;
  onClip: ((c: Clip) => void) | null = null;

  constructor(root: string, ffmpeg: string) {
    this.loopDir = path.join(root, 'loop');
    this.clipDir = path.join(root, 'clips');
    this.ffmpeg = ffmpeg;
    mkdirSync(this.loopDir, { recursive: true });
    mkdirSync(this.clipDir, { recursive: true });
    // Clips that were waiting when the brain stopped: pick them up again.
    for (const c of this.readClips()) if (c.state === 'recording') this.hold(c);
  }

  cameraDir(camera: string) { const d = path.join(this.loopDir, camera); mkdirSync(d, { recursive: true }); return d; }

  start() { this.timer = setInterval(() => void this.tick(), 3000); }
  stop() { if (this.timer) clearInterval(this.timer); }

  segments() { return listSegments(this.loopDir); }

  stats() {
    const segs = this.segments();
    return { bytes: segs.reduce((a, s) => a + s.bytes, 0), segments: segs.length, locked: [...this.locks.keys()].length };
  }

  /** Save clip: [now - preSec, now + postSec] for each camera, cut once the window has been recorded. */
  saveClip(cameras: string[], preSec: number, postSec: number, reason: Clip['reason'], now = Date.now()): Clip[] {
    const out: Clip[] = [];
    for (const camera of cameras) {
      const id = `${stamp(now)}-${camera}`;
      if (this.pending.has(id)) { out.push(this.public(this.pending.get(id)!)); continue; }
      const c: ClipRecord = { id, camera, startedAt: new Date(now - preSec * 1000).toISOString(), durationS: preSec + postSec, reason, bytes: 0, state: 'recording', error: null, from: now - preSec * 1000, to: now + postSec * 1000 };
      this.writeMeta(c);
      this.hold(c);
      out.push(this.public(c));
    }
    return out;
  }

  private hold(c: ClipRecord) {
    this.pending.set(c.id, c);
    this.relock();
  }

  /** Lock every segment a pending clip overlaps (including ones written after the tap). */
  private relock() {
    const segs = this.segments();
    this.locks.clear();
    for (const c of this.pending.values()) {
      const w = clipWindow(segs.filter((s) => s.camera === c.camera), c.from, c.to, this.segmentSec);
      for (const s of w?.segments ?? []) {
        if (!this.locks.has(s.path)) this.locks.set(s.path, new Set());
        this.locks.get(s.path)!.add(c.id);
      }
    }
  }

  private ticking = false;
  async tick(now = Date.now()) {
    if (this.ticking) return;
    this.ticking = true;
    try { await this.tickInner(now); } finally { this.ticking = false; }
  }

  private async tickInner(now: number) {
    this.relock();
    for (const c of [...this.pending.values()]) {
      const segs = this.segments().filter((s) => s.camera === c.camera);
      const late = now > c.to + Math.max(30, this.segmentSec * 2.5) * 1000;
      const ready = now >= c.to + 1000 && (windowClosed(segs, c.to) || !this.isRecording(c.camera) || late);
      if (ready) await this.build(c, segs);
    }
    this.retention();
  }

  retention() {
    const segs = this.segments();
    const active = new Set([...newestPerCamera(segs)].filter((p) => this.isRecording(path.basename(path.dirname(p)))));
    for (const p of planRetention(segs, this.capBytes, new Set(this.locks.keys()), active)) {
      try { rmSync(p, { force: true }); } catch (e) { this.lastError = `could not delete ${p}: ${(e as Error).message}`; }
    }
  }

  private async build(c: ClipRecord, segs: Segment[]) {
    this.pending.delete(c.id);
    const w = clipWindow(segs, c.from, c.to, this.segmentSec);
    if (!w) {
      this.finish({ ...c, state: 'error', error: 'nothing was recorded in that window (is the dashcam on for this camera?)' });
      return;
    }
    const list = path.join(this.clipDir, `${c.id}.txt`);
    const out = path.join(this.clipDir, `${c.id}.mp4`);
    writeFileSync(list, w.segments.map((s) => `file '${s.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-ss', w.offsetS.toFixed(2), '-i', list, '-t', w.durationS.toFixed(2), '-c', 'copy', '-movflags', '+faststart', out + '.part.mp4'];
    const err = await new Promise<string | null>((resolve) => execFile(this.ffmpeg, args, { timeout: 120_000, windowsHide: true }, (e, _o, stderr) => resolve(e ? (stderr?.toString().trim().split(/\r?\n/).pop() || e.message) : null)));
    rmSync(list, { force: true });
    if (err) { rmSync(out + '.part.mp4', { force: true }); this.finish({ ...c, state: 'error', error: err.slice(0, 240) }); return; }
    renameSync(out + '.part.mp4', out);
    this.finish({ ...c, state: 'ready', durationS: Math.round(w.durationS), startedAt: new Date(Math.max(c.from, w.segments[0].start)).toISOString(), bytes: statSync(out).size });
  }

  private finish(c: ClipRecord) {
    this.writeMeta(c);
    this.relock();
    if (c.state === 'error') this.lastError = c.error;
    this.onClip?.(this.public(c));
  }

  private public(c: ClipRecord): Clip {
    const { from: _f, to: _t, ...rest } = c;
    return rest;
  }

  private writeMeta(c: ClipRecord) {
    const f = path.join(this.clipDir, `${c.id}.json`);
    writeFileSync(f + '.tmp', JSON.stringify(c, null, 2));
    renameSync(f + '.tmp', f);
  }

  private readClips(): ClipRecord[] {
    const out: ClipRecord[] = [];
    for (const n of readdirSync(this.clipDir)) {
      if (!n.endsWith('.json')) continue;
      try { out.push(JSON.parse(readFileSync(path.join(this.clipDir, n), 'utf8')) as ClipRecord); } catch { /* half-written */ }
    }
    return out;
  }

  clips(limit = 100): Clip[] {
    return this.readClips().map((c) => this.public(this.pending.get(c.id) ?? c)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }

  clipFile(id: string): string | null {
    if (!/^[0-9]{8}-[0-9]{6}-[a-z0-9_-]+$/.test(id)) return null;
    const f = path.join(this.clipDir, `${id}.mp4`);
    return existsSync(f) ? f : null;
  }

  deleteClip(id: string): boolean {
    if (!/^[0-9]{8}-[0-9]{6}-[a-z0-9_-]+$/.test(id)) return false;
    const j = path.join(this.clipDir, `${id}.json`);
    if (!existsSync(j)) return false;
    this.pending.delete(id);
    rmSync(j, { force: true });
    rmSync(path.join(this.clipDir, `${id}.mp4`), { force: true });
    this.relock();
    return true;
  }

  lockedPaths() { return new Set(this.locks.keys()); }
}
