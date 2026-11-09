// The truck tuner's HD Radio without a dongle: rtl_test, nrsc5, rtl_fm and
// ffmpeg are fake child processes, so the fallback and the HD scan can be
// driven second by second.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FmService } from '../src/media/fm.ts';
import { HD_ANALOG_FFMPEG_ARGS, HD_FFMPEG_ARGS, hdScanVerdict, hdWatchStep, newHdLog } from '../src/media/hd.ts';
import { defaultMediaSettings } from '../src/media/settings.ts';

/** The fakes' pipes are PassThroughs (ChildProcess types them as Readable). */
const w = (s: unknown) => s as PassThrough;
type Fake = ChildProcess & { cmd: string; args: string[]; say: (line: string) => void; dead: boolean };

function rig(onSpawn: (p: Fake) => void = () => {}) {
  const procs: Fake[] = [];
  const spawn = (cmd: string, args: string[]) => {
    const p = new EventEmitter() as Fake;
    Object.assign(p, { cmd, args, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, dead: false });
    p.say = (line) => { w(p.stderr).write(`10:00:00 ${line}\n`); };
    p.kill = () => {
      if (p.dead) return true;
      p.dead = true;
      setTimeout(() => { (p as { exitCode: number | null }).exitCode = 0; p.emit('exit', 0, null); p.emit('close', 0); }, 50);
      return true;
    };
    procs.push(p);
    if (cmd.endsWith('rtl_test')) setTimeout(() => { w(p.stdout).end('Found 1 device(s):\n  0:  Realtek, RTL2838UHIDIR, SN: 00000001\n'); p.emit('close', 0); }, 10);
    onSpawn(p);
    return p;
  };
  const media = defaultMediaSettings();
  const fm = new FmService(false, () => media, { spawn, which: (b) => `/usr/bin/${b}` });
  const live = (name: string) => procs.filter((p) => p.cmd.endsWith(name) && !p.dead);
  return { fm, procs, live, media };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
/** Let the fake rtl_test answer, then settle `p` (detect() waits on it). */
const run = async <T>(p: Promise<T>) => { await tick(20); return p; };

describe('HD Radio fallback to analog (truck tuner)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rules: HD1 only, after a first-lock or lost-lock wait, and comes back on schedule', () => {
    const w = { leg: 'hd' as const, hd: 1, synced: false, legStart: 0, lastSynced: null, retryAt: null };
    expect(hdWatchStep(w, 14_000)).toBeNull();
    expect(hdWatchStep(w, 16_000)).toBe('analog');
    expect(hdWatchStep({ ...w, lastSynced: 10_000 }, 17_000)).toBeNull();
    expect(hdWatchStep({ ...w, lastSynced: 10_000 }, 18_500)).toBe('analog');
    expect(hdWatchStep({ ...w, hd: 2 }, 99_000)).toBeNull();
    expect(hdWatchStep({ ...w, synced: true }, 99_000)).toBeNull();
    expect(hdWatchStep({ ...w, leg: 'analog', retryAt: 5000 }, 4000)).toBeNull();
    expect(hdWatchStep({ ...w, leg: 'analog', retryAt: 5000 }, 5000)).toBe('hd');
    expect(hdWatchStep({ ...w, leg: 'analog', retryAt: null }, 1e9)).toBeNull();
  });

  it('plays analog on one unbroken stream when HD1 is lost, and tries HD again', async () => {
    const { fm, live } = rig();
    const out = fm.stream(91.5, 1);
    await tick(20);
    const audio: string[] = [];
    (await out).on('data', (c: Buffer) => audio.push(c.toString()));
    const hd1 = live('nrsc5')[0];
    expect(hd1.args.slice(-2)).toEqual(['91.5', '0']);
    expect(live('ffmpeg')[0].args).toEqual(HD_FFMPEG_ARGS);
    hd1.say('Synchronized'); hd1.say('Station name: KJZZ'); hd1.say('Title: So What');
    w(live('ffmpeg')[0].stdout).write('hd');
    await tick(5000);
    expect(fm.hdNow()).toMatchObject({ synced: true, station: 'KJZZ', title: 'So What', fallback: null });

    hd1.say('Lost synchronization');
    await tick(10_000);
    expect(hd1.dead).toBe(true);
    expect(live('rtl_fm')).toHaveLength(1);
    expect(live('ffmpeg')[0].args).toEqual(HD_ANALOG_FFMPEG_ARGS);
    w(live('ffmpeg')[0].stdout).write('analog');
    await tick(10);
    expect(audio.join('')).toBe('hdanalog');                    // the same <audio> stream carries on
    const fb = fm.hdNow()!;
    expect(fb).toMatchObject({ synced: false, station: 'KJZZ', title: null });
    expect(Date.parse(fb.fallback!.retryAt!) - Date.parse(fb.fallback!.since)).toBeGreaterThanOrEqual(119_000);

    await tick(121_000);                                       // first automatic try
    expect(live('rtl_fm')).toHaveLength(0);
    expect(live('nrsc5')).toHaveLength(1);
    expect(fm.hdNow()!.fallback).not.toBeNull();               // still "fallen back" until it locks
    await tick(17_000);                                        // no lock: analog again, next try in 10 min
    expect(live('rtl_fm')).toHaveLength(1);
    const again = fm.hdNow()!.fallback!;
    expect(Date.parse(again.retryAt!) - Date.now()).toBeGreaterThan(590_000);

    expect(fm.retryHd()).toBe(true);                           // "Back to HD" tapped
    await tick(200);
    live('nrsc5')[0].say('Synchronized');
    await tick(1500);
    expect(fm.hdNow()).toMatchObject({ synced: true, fallback: null });
    expect(fm.retryHd()).toBe(false);
    fm.stopStream();
    await tick(100);
    expect(live('nrsc5').length + live('ffmpeg').length).toBe(0);
  });

  it('never swaps HD2 for analog (analog is HD1’s programme)', async () => {
    const { fm, live } = rig();
    void fm.stream(91.5, 2);
    await tick(60_000);
    expect(live('rtl_fm')).toHaveLength(0);
    expect(fm.hdNow()).toMatchObject({ hd: 2, synced: false, fallback: null });
    fm.stopStream();
  });

  it('a leg that dies by itself ends the stream', async () => {
    const { fm, live } = rig();
    const out = await run(fm.stream(91.5, 1));
    let ended = false;
    out.on('end', () => { ended = true; }).resume();
    await tick(20);
    live('nrsc5')[0].kill();
    await tick(100);
    expect(fm.current()).toBeNull();
    expect(ended).toBe(true);
  });
});

describe('Finding HD stations (truck tuner)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rules: no lock in 12 s is no HD; a lock waits for the programme list to settle', () => {
    const log = newHdLog(91.5, 1);
    expect(hdScanVerdict(log, 0, 0, 11_000)).toBeNull();
    expect(hdScanVerdict(log, 0, 0, 12_500)).toBe('none');
    Object.assign(log, { synced: true, station: 'KJZZ', programs: [{ hd: 1, type: 'News' }] });
    expect(hdScanVerdict(log, 0, 4000, 6000)).toBeNull();
    expect(hdScanVerdict(log, 0, 4000, 7000)).toBe('hd');
    expect(hdScanVerdict({ ...log, station: null }, 0, 4000, 26_000)).toBe('hd');
  });

  it('listens to each frequency in turn and keeps what it heard', async () => {
    const { fm, procs } = rig((p) => {
      if (!p.cmd.endsWith('nrsc5')) return;
      if (p.args.includes('91.5')) setTimeout(() => {
        p.say('Synchronized'); p.say('Station name: KJZZ'); p.say('Slogan: Phoenix Public Radio');
        p.say('Audio program 0: public, type: News, sound experience 0');
        p.say('Audio program 1: public, type: Jazz, sound experience 0');
      }, 2000);
    });
    const job = await run(fm.startHdScan([99.9, 91.5, 0.62, 91.5]));
    expect(job).toMatchObject({ running: true, total: 2, done: 0 });
    expect(await run(fm.detect(true))).toMatchObject({ state: 'busy' });
    await tick(8000);
    expect(fm.hdScan().job).toMatchObject({ done: 1, current: 99.9 });
    await tick(15_000);
    const r = fm.hdScan();
    expect(r.job).toMatchObject({ running: false, done: 2, error: null });
    expect(r.found).toEqual([
      expect.objectContaining({ mhz: 91.5, hd: true, station: 'KJZZ', programs: [{ hd: 1, type: 'News' }, { hd: 2, type: 'Jazz' }] }),
      expect.objectContaining({ mhz: 99.9, hd: false, station: null, programs: [] }),
    ]);
    expect(procs.filter((p) => p.cmd.endsWith('nrsc5')).every((p) => p.dead && p.args.includes('-o'))).toBe(true);
  });

  it('turning the radio on stops the scan first', async () => {
    const { fm, live } = rig();
    await run(fm.startHdScan([88.5, 90.1, 93.3]));
    await tick(100);
    const s = fm.stream(88.5);
    await tick(200);
    await s;
    expect(fm.hdScan().job).toMatchObject({ running: false, error: 'Stopped (the radio was turned on)' });
    expect(live('nrsc5')).toHaveLength(0);
    expect(live('rtl_fm')).toHaveLength(1);
    fm.stopStream();
  });

  it('needs nrsc5 and some FM to check', async () => {
    const { fm } = rig();
    await expect(fm.startHdScan([0.62])).rejects.toThrow(/No FM frequencies/);
    const bare = new FmService(false, () => defaultMediaSettings(), { which: (b) => (b === 'nrsc5' ? null : `/usr/bin/${b}`) });
    expect(bare.hasNrsc5()).toBe(false);
    expect(new FmService(true, () => defaultMediaSettings(), { which: (b) => `/usr/bin/${b}` }).hasNrsc5()).toBe(false); // simulated truck
  });
});
