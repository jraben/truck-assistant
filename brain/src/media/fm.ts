// AM/FM over the air with an optional RTL-SDR USB dongle (e.g. RTL-SDR Blog
// V4, about $30 with an antenna kit). The brain runs `rtl_fm` and pipes its
// PCM through `ffmpeg` to MP3, served to the cockpit's <audio> at
// /api/media/fm/stream. One tuner, one stream: a new tune stops the old one.
// No dongle (or SIM=1) is reported clearly; the UI still shows its controls.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { MediaSettings } from './settings.ts';
import { HD_FFMPEG_ARGS, newHdLog, nrsc5Args, readHdLine, type HdLog, type HdNow } from './hd.ts';

import type { Tuner } from './types.ts';
export type { Tuner } from './types.ts';

const PATHS = (process.env.PATH ?? '').split(path.delimiter);
export function which(bin: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const d of ['/usr/bin', '/usr/local/bin', ...PATHS]) for (const e of exts) { const p = path.join(d, bin + e); if (d && existsSync(p)) return p; }
  return null;
}

/** US FM channels: odd tenths, 87.9-107.9 MHz. */
export const FM_STEP = 0.2;
export const isAm = (mhz: number) => mhz < 2;

/** rtl_fm arguments for a frequency (FM wideband, or AM with the V4's upconverter driver). */
export function rtlFmArgs(mhz: number, o: { ppm: number; gain: number | null }): string[] {
  const a = isAm(mhz)
    ? ['-f', `${Math.round(mhz * 1000)}k`, '-M', 'am', '-s', '12k', '-r', '48000']
    : ['-f', `${mhz.toFixed(1)}M`, '-M', 'wbfm', '-s', '200000', '-r', '48000', '-E', 'deemp'];
  if (o.ppm) a.push('-p', String(o.ppm));
  if (o.gain !== null) a.push('-g', String(o.gain));
  a.push('-');
  return a;
}

export const FFMPEG_ARGS = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0', '-f', 'mp3', '-b:a', '128k', '-flush_packets', '1', 'pipe:1'];

/**
 * rtl_power CSV ("date, time, Hz low, Hz high, Hz step, samples, dB, dB, …")
 * -> power per bin. Several lines per sweep; bins are joined in frequency order.
 */
export function parseRtlPower(csv: string): { mhz: number; db: number }[] {
  const out: { mhz: number; db: number }[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const c = line.split(',').map((x) => x.trim());
    if (c.length < 7) continue;
    const lo = Number(c[2]), step = Number(c[4]);
    if (!Number.isFinite(lo) || !Number.isFinite(step) || step <= 0) continue;
    c.slice(6).forEach((v, i) => { const db = Number(v); if (Number.isFinite(db)) out.push({ mhz: (lo + step * i + step / 2) / 1e6, db }); });
  }
  return out.sort((a, b) => a.mhz - b.mhz);
}

/** Channels standing at least `margin` dB above the band's median, snapped to US FM channels. */
export function strongChannels(bins: { mhz: number; db: number }[], margin = 8): number[] {
  if (!bins.length) return [];
  const sorted = [...bins].map((b) => b.db).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const best = new Map<number, number>();
  for (const b of bins) {
    const ch = Math.round((Math.round((b.mhz - 87.9) / FM_STEP) * FM_STEP + 87.9) * 10) / 10;
    if (ch < 87.9 || ch > 107.9) continue;
    best.set(ch, Math.max(best.get(ch) ?? -Infinity, b.db));
  }
  return [...best].filter(([, db]) => db >= median + margin).map(([ch]) => ch).sort((a, b) => a - b);
}

/** Next strong channel up or down from `cur` (wrapping round the band); null when none. */
export function pickSeek(channels: number[], cur: number, dir: 1 | -1): number | null {
  if (!channels.length) return null;
  const eps = 0.05;
  if (dir > 0) return channels.find((c) => c > cur + eps) ?? channels[0];
  return [...channels].reverse().find((c) => c < cur - eps) ?? channels[channels.length - 1];
}

export class FmService {
  private sim: boolean;
  private media: () => MediaSettings;
  private tuner: Tuner | null = null;
  private procs: ChildProcess[] = [];
  private tuned: number | null = null;
  private hd: { log: HdLog; since: string } | null = null;
  private lastChannels: { at: number; list: number[] } | null = null;

  constructor(sim: boolean, media: () => MediaSettings) { this.sim = sim; this.media = media; }

  current() { return this.tuned; }
  /** The HD channel being decoded (1-4), or null for analog / nothing. */
  currentHd() { return this.hd?.log.hd ?? null; }
  hasNrsc5() { return !this.sim && !!which('nrsc5'); }

  /** What the HD decoder has heard so far (station, song, sub-channels), or null when not on HD. */
  hdNow(): HdNow | null {
    if (!this.hd) return null;
    const { log, since } = this.hd;
    return { via: 'tuner', ...log, programs: [...log.programs], art: null, since };
  }

  /** Is there a dongle? `rtl_test -t` lists devices; checked at most once a minute. */
  async detect(force = false): Promise<Tuner> {
    if (this.tuner && !force && Date.now() - Date.parse(this.tuner.checkedAt) < 60_000) return this.tuner;
    const at = new Date().toISOString();
    if (this.procs.length) return (this.tuner = { state: 'busy', message: `Tuned to ${this.tuned}`, checkedAt: at });
    if (this.sim) return (this.tuner = { state: 'sim', message: 'Simulated truck: no tuner, so nothing plays. The controls work.', checkedAt: at });
    const rtlTest = which('rtl_test'), rtlFm = which('rtl_fm'), ff = which('ffmpeg');
    if (!rtlTest || !rtlFm || !ff) return (this.tuner = { state: 'no-software', message: `Missing ${[!rtlFm && 'rtl_fm', !rtlTest && 'rtl_test', !ff && 'ffmpeg'].filter(Boolean).join(', ')}: run deploy/pi/install.sh (installs rtl-sdr and ffmpeg).`, checkedAt: at });
    const out = await new Promise<string>((resolve) => {
      let buf = '';
      const p = spawn(rtlTest, ['-t'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const kill = setTimeout(() => p.kill('SIGKILL'), 4000);
      p.stdout.on('data', (d) => { buf += d; }); p.stderr.on('data', (d) => { buf += d; });
      p.on('close', () => { clearTimeout(kill); resolve(buf); });
      p.on('error', () => { clearTimeout(kill); resolve(buf); });
    });
    const n = /Found (\d+) device/.exec(out);
    if (n && Number(n[1]) > 0) return (this.tuner = { state: 'present', hd: !!which('nrsc5'), message: out.split('\n').find((l) => /^\s*0:/.test(l))?.trim() ?? 'RTL-SDR found', checkedAt: at });
    const busy = /usb_claim_interface error|resource busy/i.test(out);
    return (this.tuner = { state: busy ? 'busy' : 'none', message: busy ? 'The tuner is in use by another program (or the DVB driver: see deploy/pi/README.md).' : 'No RTL-SDR tuner plugged in. AM/FM needs a USB RTL-SDR dongle (about $30) and an antenna.', checkedAt: at });
  }

  stopStream() {
    for (const p of this.procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
    this.procs = [];
    this.tuned = null;
    this.hd = null;
  }

  /**
   * Tune and return the MP3 stream: analog with rtl_fm, or HD channel `hd`
   * (1-4) with nrsc5. Throws with a reason when there is no tuner (or no nrsc5).
   */
  async stream(mhz: number, hd: number | null = null): Promise<Readable> {
    this.stopStream();
    const t = await this.detect(true);
    if (t.state !== 'present') throw Object.assign(new Error(t.message), { status: 503 });
    const f = this.media().fm;
    if (hd !== null && isAm(mhz)) throw Object.assign(new Error('HD Radio here is FM only'), { status: 400 });
    const nrsc5 = hd !== null ? which('nrsc5') : null;
    if (hd !== null && !nrsc5) throw Object.assign(new Error('HD Radio needs nrsc5: run deploy/pi/install.sh again (it builds nrsc5).'), { status: 503 });
    const rtl = nrsc5
      ? spawn(nrsc5, nrsc5Args(mhz, hd!, f), { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(which('rtl_fm')!, rtlFmArgs(mhz, f), { stdio: ['ignore', 'pipe', 'ignore'] });
    const ff = spawn(which('ffmpeg')!, nrsc5 ? HD_FFMPEG_ARGS : FFMPEG_ARGS, { stdio: ['pipe', 'pipe', 'ignore'] });
    if (nrsc5) {
      const state = { log: newHdLog(mhz, hd!), since: new Date().toISOString() };
      this.hd = state;
      let buf = '';
      rtl.stderr!.setEncoding('utf8');
      rtl.stderr!.on('data', (d: string) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop()!.slice(-4000);
        if (this.hd === state) for (const l of lines) readHdLine(state.log, l);
      });
    }
    rtl.stdout!.pipe(ff.stdin!);
    ff.stdin!.on('error', () => {});
    const procs = [rtl, ff];
    this.procs = procs;
    this.tuned = mhz;
    const done = () => { if (this.procs === procs) this.stopStream(); else for (const p of procs) p.kill('SIGTERM'); };
    rtl.on('exit', done); ff.on('exit', done);
    ff.stdout!.on('close', done);
    return ff.stdout!;
  }

  /** One sweep of the FM band with rtl_power (stops any stream first: one tuner). */
  async scan(): Promise<number[]> {
    if (this.lastChannels && Date.now() - this.lastChannels.at < 10 * 60_000) return this.lastChannels.list;
    this.stopStream();
    const t = await this.detect(true);
    if (t.state !== 'present') throw Object.assign(new Error(t.message), { status: 503 });
    const bin = which('rtl_power');
    if (!bin) throw Object.assign(new Error('rtl_power is missing: run deploy/pi/install.sh'), { status: 503 });
    const f = this.media().fm;
    const csv = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const p = spawn(bin, ['-f', '87.8M:108M:100k', '-i', '2', '-1', ...(f.gain !== null ? ['-g', String(f.gain)] : []), ...(f.ppm ? ['-p', String(f.ppm)] : []), '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const kill = setTimeout(() => p.kill('SIGKILL'), 20_000);
      p.stdout.on('data', (d) => { buf += d; });
      p.on('close', () => { clearTimeout(kill); resolve(buf); });
      p.on('error', (e) => { clearTimeout(kill); reject(e); });
    });
    const list = strongChannels(parseRtlPower(csv));
    this.lastChannels = { at: Date.now(), list };
    return list;
  }

  async seek(from: number, dir: 1 | -1): Promise<number | null> {
    return pickSeek(await this.scan(), from, dir);
  }
}
