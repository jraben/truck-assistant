// AM/FM over the air with an optional RTL-SDR USB dongle (e.g. RTL-SDR Blog
// V4, about $30 with an antenna kit). The brain runs `rtl_fm` and pipes its
// PCM through `ffmpeg` to MP3, served to the cockpit's <audio> at
// /api/media/fm/stream. One tuner, one stream: a new tune stops the old one.
// No dongle (or SIM=1) is reported clearly; the UI still shows its controls.
// HD Radio (nrsc5) shares the same dongle: HD1 falls back to the analog
// signal when the digital one is lost, and an HD scan listens to each station
// for a few seconds to see which carry HD (rules in hd.ts).
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import type { MediaSettings } from './settings.ts';
import { HD_ANALOG_FFMPEG_ARGS, HD_FFMPEG_ARGS, hdRetryAt, hdScanResult, hdScanVerdict, hdWatchStep, newHdLog, nrsc5Args, readHdLine, type HdLog, type HdNow, type HdScanResult } from './hd.ts';

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

/** How the service starts programs and finds them (swapped in tests: no dongle needed). */
export type FmDeps = {
  spawn: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
  which: (bin: string) => string | null;
  now: () => number;
};
const realDeps: FmDeps = { spawn: (c, a, o) => nodeSpawn(c, a, o), which, now: () => Date.now() };

/** Feed a child's stderr to `onLine`, line by line. */
function lines(p: ChildProcess, onLine: (l: string) => void) {
  let buf = '';
  p.stderr?.setEncoding('utf8');
  p.stderr?.on('data', (d: string) => {
    buf += d;
    const ls = buf.split(/\r?\n/);
    buf = ls.pop()!.slice(-4000);
    for (const l of ls) onLine(l);
  });
}
/** Resolves when the child has exited (or after `ms`, whichever is first): the USB tuner is free again. */
function exited(p: ChildProcess, ms = 3000): Promise<void> {
  if (p.exitCode !== null || p.signalCode !== null) return Promise.resolve();
  return new Promise((res) => { const t = setTimeout(res, ms); p.once('exit', () => { clearTimeout(t); res(); }); p.once('error', () => { clearTimeout(t); res(); }); });
}
const kill = (p: ChildProcess) => { try { p.kill('SIGTERM'); } catch { /* gone */ } };

type Leg = { kind: 'hd' | 'analog'; procs: ChildProcess[]; start: number };
type Session = {
  mhz: number;
  hd: number | null;
  out: PassThrough;
  leg: Leg | null;
  timer?: ReturnType<typeof setInterval>;
  /** HD only: what nrsc5 has said, and the fallback bookkeeping. */
  log: HdLog | null;
  since: string;
  lastSynced: number | null;
  retryAt: number | null;
  tries: number;
  analogSince: string | null;
  switching: boolean;
};
export type HdScanJob = { running: boolean; done: number; total: number; current: number | null; error: string | null; startedAt: string; finishedAt: string | null };
type Job = HdScanJob & { cancel: boolean; proc: ChildProcess | null; loop: Promise<void> | null };

export class FmService {
  private sim: boolean;
  private media: () => MediaSettings;
  private d: FmDeps;
  private tuner: Tuner | null = null;
  private session: Session | null = null;
  private lastChannels: { at: number; list: number[] } | null = null;
  private job: Job | null = null;
  private found = new Map<number, HdScanResult>();

  constructor(sim: boolean, media: () => MediaSettings, deps: Partial<FmDeps> = {}) { this.sim = sim; this.media = media; this.d = { ...realDeps, ...deps }; }

  current() { return this.session?.mhz ?? null; }
  /** The HD channel being decoded (1-4), or null for analog / nothing. */
  currentHd() { return this.session?.hd ?? null; }
  hasNrsc5() { return !this.sim && !!this.d.which('nrsc5'); }

  /** What the HD decoder has heard so far (station, song, sub-channels), or null when not on HD. */
  hdNow(): HdNow | null {
    const s = this.session;
    if (!s?.log) return null;
    const onAnalog = s.leg?.kind === 'analog';
    return {
      via: 'tuner', ...s.log, synced: !onAnalog && s.log.synced, programs: [...s.log.programs], art: null, since: s.since,
      fallback: s.analogSince ? { since: s.analogSince, retryAt: onAnalog && s.retryAt !== null ? new Date(s.retryAt).toISOString() : null, analog: onAnalog } : null,
    };
  }

  /** Is there a dongle? `rtl_test -t` lists devices; checked at most once a minute. */
  async detect(force = false): Promise<Tuner> {
    if (this.tuner && !force && this.d.now() - Date.parse(this.tuner.checkedAt) < 60_000) return this.tuner;
    const at = new Date(this.d.now()).toISOString();
    if (this.session) return (this.tuner = { state: 'busy', message: `Tuned to ${this.session.mhz}`, checkedAt: at });
    if (this.job?.running) return (this.tuner = { state: 'busy', message: 'Looking for HD stations', checkedAt: at });
    if (this.sim) return (this.tuner = { state: 'sim', message: 'Simulated truck: no tuner, so nothing plays. The controls work.', checkedAt: at });
    const rtlTest = this.d.which('rtl_test'), rtlFm = this.d.which('rtl_fm'), ff = this.d.which('ffmpeg');
    if (!rtlTest || !rtlFm || !ff) return (this.tuner = { state: 'no-software', message: `Missing ${[!rtlFm && 'rtl_fm', !rtlTest && 'rtl_test', !ff && 'ffmpeg'].filter(Boolean).join(', ')}: run deploy/pi/install.sh (installs rtl-sdr and ffmpeg).`, checkedAt: at });
    const out = await new Promise<string>((resolve) => {
      let buf = '';
      const p = this.d.spawn(rtlTest, ['-t'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const k = setTimeout(() => p.kill('SIGKILL'), 4000);
      p.stdout?.on('data', (x) => { buf += x; }); p.stderr?.on('data', (x) => { buf += x; });
      p.on('close', () => { clearTimeout(k); resolve(buf); });
      p.on('error', () => { clearTimeout(k); resolve(buf); });
    });
    const n = /Found (\d+) device/.exec(out);
    if (n && Number(n[1]) > 0) return (this.tuner = { state: 'present', hd: !!this.d.which('nrsc5'), message: out.split('\n').find((l) => /^\s*0:/.test(l))?.trim() ?? 'RTL-SDR found', checkedAt: at });
    const busy = /usb_claim_interface error|resource busy/i.test(out);
    return (this.tuner = { state: busy ? 'busy' : 'none', message: busy ? 'The tuner is in use by another program (or the DVB driver: see deploy/pi/README.md).' : 'No RTL-SDR tuner plugged in. AM/FM needs a USB RTL-SDR dongle (about $30) and an antenna.', checkedAt: at });
  }

  stopStream() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    clearInterval(s.timer);
    if (s.leg) for (const p of s.leg.procs) kill(p);
    s.leg = null;
    s.out.end();
  }

  /**
   * Tune and return the MP3 stream: analog with rtl_fm, or HD channel `hd`
   * (1-4) with nrsc5. HD1 falls back to analog when the digital signal is
   * lost (see hd.ts). Throws with a reason when there is no tuner (or no nrsc5).
   */
  async stream(mhz: number, hd: number | null = null): Promise<Readable> {
    this.stopStream();
    await this.cancelHdScan();
    const t = await this.detect(true);
    if (t.state !== 'present') throw Object.assign(new Error(t.message), { status: 503 });
    if (hd !== null && isAm(mhz)) throw Object.assign(new Error('HD Radio here is FM only'), { status: 400 });
    if (hd !== null && !this.d.which('nrsc5')) throw Object.assign(new Error('HD Radio needs nrsc5: run deploy/pi/install.sh again (it builds nrsc5).'), { status: 503 });
    const s: Session = {
      mhz, hd, out: new PassThrough(), leg: null, log: hd !== null ? newHdLog(mhz, hd) : null, since: new Date(this.d.now()).toISOString(),
      lastSynced: null, retryAt: null, tries: 0, analogSince: null, switching: false,
    };
    this.session = s;
    this.startLeg(s, hd !== null ? 'hd' : 'analog');
    if (hd !== null) s.timer = setInterval(() => this.tick(s), 1000);
    s.out.on('close', () => { if (this.session === s) this.stopStream(); });
    return s.out;
  }

  private startLeg(s: Session, kind: 'hd' | 'analog') {
    const f = this.media().fm;
    const src = kind === 'hd'
      ? this.d.spawn(this.d.which('nrsc5')!, nrsc5Args(s.mhz, s.hd!, f), { stdio: ['ignore', 'pipe', 'pipe'] })
      : this.d.spawn(this.d.which('rtl_fm')!, rtlFmArgs(s.mhz, f), { stdio: ['ignore', 'pipe', 'ignore'] });
    const ff = this.d.spawn(this.d.which('ffmpeg')!, kind === 'hd' ? HD_FFMPEG_ARGS : s.hd !== null ? HD_ANALOG_FFMPEG_ARGS : FFMPEG_ARGS, { stdio: ['pipe', 'pipe', 'ignore'] });
    const leg: Leg = { kind, procs: [src, ff], start: this.d.now() };
    s.leg = leg;
    if (kind === 'hd' && s.log) {
      const log = s.log;
      log.synced = false;
      lines(src, (l) => { if (s.leg === leg) readHdLine(log, l); });
    }
    src.stdout!.pipe(ff.stdin!);
    ff.stdin!.on('error', () => {});
    ff.stdout!.pipe(s.out, { end: false });
    // A leg ending by itself ends the stream; one we replaced (s.leg moved on) does not.
    const ended = () => { if (s.leg === leg && this.session === s) this.stopStream(); };
    for (const p of leg.procs) { p.on('exit', ended); p.on('error', ended); }
  }

  /** Swap nrsc5 for rtl_fm or back, on the one tuner: the old program must let go of the USB device first. */
  private async switchLeg(s: Session, kind: 'hd' | 'analog') {
    if (s.switching || this.session !== s) return;
    s.switching = true;
    const old = s.leg;
    s.leg = null;
    if (old) {
      old.procs[1].stdout?.unpipe(s.out);
      for (const p of old.procs) kill(p);
      await exited(old.procs[0]);
    }
    s.switching = false;
    if (this.session === s) this.startLeg(s, kind);
  }

  /** Once a second on HD: follow the lock and fall back / come back (hd.ts: hdWatchStep). */
  private tick(s: Session) {
    if (this.session !== s || !s.leg || !s.log || s.switching) return;
    const now = this.d.now();
    const onHd = s.leg.kind === 'hd';
    if (onHd && s.log.synced) { s.lastSynced = now; s.tries = 0; s.analogSince = null; }
    const step = hdWatchStep({ leg: s.leg.kind, hd: s.hd ?? 1, synced: s.log.synced, legStart: s.leg.start, lastSynced: onHd ? s.lastSynced : null, retryAt: s.retryAt }, now);
    if (step === 'analog') {
      s.analogSince ??= new Date(now).toISOString();
      s.retryAt = hdRetryAt(s.tries, now);
      Object.assign(s.log, { title: null, artist: null, album: null, genre: null, merDb: null, kbps: null });
      void this.switchLeg(s, 'analog');
    } else if (step === 'hd') this.retryNow(s);
  }

  private retryNow(s: Session) {
    s.tries++;
    s.retryAt = null;
    s.lastSynced = null;
    void this.switchLeg(s, 'hd');
  }

  /** "Back to HD" from the cockpit: try the digital signal again now. False when not on an analog fallback. */
  retryHd(): boolean {
    const s = this.session;
    if (!s?.log || s.leg?.kind !== 'analog' || s.switching) return false;
    s.tries = Math.max(0, s.tries - 1); // a tap doesn't use up an automatic try
    this.retryNow(s);
    return true;
  }

  // ---- Finding HD stations ---------------------------------------------------------

  /** Progress of the HD scan and everything found (newest listen per frequency). */
  hdScan(): { job: HdScanJob | null; found: HdScanResult[] } {
    const j = this.job;
    return { job: j && { running: j.running, done: j.done, total: j.total, current: j.current, error: j.error, startedAt: j.startedAt, finishedAt: j.finishedAt }, found: [...this.found.values()].sort((a, b) => a.mhz - b.mhz) };
  }

  /**
   * Listen to each FM frequency for a few seconds with nrsc5 and note which
   * carry HD, the station name and its HD1-HD4 programmes. Stops any stream
   * (one tuner); a new stream cancels the scan. Runs in the background.
   */
  async startHdScan(list: number[]): Promise<HdScanJob> {
    const freqs = [...new Set(list.filter((m) => !isAm(m) && m >= 87.5 && m <= 108).map((m) => Math.round(m * 10) / 10))].sort((a, b) => a - b);
    if (!freqs.length) throw Object.assign(new Error('No FM frequencies to check'), { status: 400 });
    if (this.job?.running) return this.hdScan().job!;
    this.stopStream();
    const t = await this.detect(true);
    if (t.state !== 'present') throw Object.assign(new Error(t.message), { status: 503 });
    const nrsc5 = this.d.which('nrsc5');
    if (!nrsc5) throw Object.assign(new Error('Finding HD stations needs nrsc5: run deploy/pi/install.sh again (it builds nrsc5).'), { status: 503 });
    const job: Job = { running: true, done: 0, total: freqs.length, current: null, error: null, startedAt: new Date(this.d.now()).toISOString(), finishedAt: null, cancel: false, proc: null, loop: null };
    this.job = job;
    job.loop = (async () => {
      try {
        for (const mhz of freqs) {
          if (job.cancel) break;
          job.current = mhz;
          const r = await this.listenForHd(nrsc5, mhz, job);
          if (r && !job.cancel) this.found.set(mhz, r);
          if (!job.cancel) job.done++;
        }
      } catch (e) { job.error = (e as Error).message; }
      if (job.cancel && !job.error) job.error = 'Stopped (the radio was turned on)';
      job.running = false; job.current = null; job.finishedAt = new Date(this.d.now()).toISOString();
    })();
    return this.hdScan().job!;
  }

  private async listenForHd(nrsc5: string, mhz: number, job: Job): Promise<HdScanResult | null> {
    const log = newHdLog(mhz, 1);
    const start = this.d.now();
    let lastNew = start;
    const p = this.d.spawn(nrsc5, nrsc5Args(mhz, 1, this.media().fm), { stdio: ['ignore', 'ignore', 'pipe'] });
    job.proc = p;
    let gone = false;
    p.on('exit', () => { gone = true; }); p.on('error', () => { gone = true; });
    lines(p, (l) => { if (readHdLine(log, l)) lastNew = this.d.now(); });
    let verdict: 'hd' | 'none' | null = null;
    while (!job.cancel && !gone && !(verdict = hdScanVerdict(log, start, lastNew, this.d.now()))) await new Promise((r) => setTimeout(r, 250));
    kill(p);
    await exited(p);
    job.proc = null;
    if (job.cancel) return null;
    return hdScanResult(log, verdict === 'hd' || (verdict === null && log.synced), new Date(this.d.now()).toISOString());
  }

  /** Stop a running HD scan and wait for its nrsc5 to let go of the tuner. */
  async cancelHdScan() {
    const j = this.job;
    if (!j?.running) return;
    j.cancel = true;
    if (j.proc) kill(j.proc);
    await j.loop;
  }

  /** One sweep of the FM band with rtl_power (stops any stream first: one tuner). */
  async scan(): Promise<number[]> {
    if (this.lastChannels && this.d.now() - this.lastChannels.at < 10 * 60_000) return this.lastChannels.list;
    this.stopStream();
    await this.cancelHdScan();
    const t = await this.detect(true);
    if (t.state !== 'present') throw Object.assign(new Error(t.message), { status: 503 });
    const bin = this.d.which('rtl_power');
    if (!bin) throw Object.assign(new Error('rtl_power is missing: run deploy/pi/install.sh'), { status: 503 });
    const f = this.media().fm;
    const csv = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const p = this.d.spawn(bin, ['-f', '87.8M:108M:100k', '-i', '2', '-1', ...(f.gain !== null ? ['-g', String(f.gain)] : []), ...(f.ppm ? ['-p', String(f.ppm)] : []), '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const k = setTimeout(() => p.kill('SIGKILL'), 20_000);
      p.stdout?.on('data', (x) => { buf += x; });
      p.on('close', () => { clearTimeout(k); resolve(buf); });
      p.on('error', (e) => { clearTimeout(k); reject(e); });
    });
    const list = strongChannels(parseRtlPower(csv));
    this.lastChannels = { at: this.d.now(), list };
    return list;
  }

  async seek(from: number, dir: 1 | -1): Promise<number | null> {
    return pickSeek(await this.scan(), from, dir);
  }
}
