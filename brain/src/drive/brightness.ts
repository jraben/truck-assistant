// Screen brightness. Auto: the truck box's ambient light sensor
// (slate/truckbox/sensor/ambient_lux/state), smoothed, on a log curve between
// minPct and maxPct, capped at nightMaxPct after sunset. Written to the panel:
// - ddcutil (DDC/CI over HDMI, VCP 0x10 "brightness") for an HDMI panel like
//   the Waveshare 12.3"; needs i2c-dev loaded and the user in group i2c;
// - else /sys/class/backlight/* (DSI panels);
// - else simulated (a desk), which only remembers the value.
// Writes are rate-limited: ddcutil takes ~0.3 s and the bus dislikes chatter.
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';

export const WRITE_MIN_MS = 4_000;
export const WRITE_MIN_STEP = 3;

/** lux -> % on a log curve: 1 lux = min, 10,000 lux (shade on a sunny day) = max. */
export function luxToPct(lux: number, minPct: number, maxPct: number): number {
  const x = Math.max(0, Math.min(1, Math.log10(Math.max(1, lux)) / 4));
  return Math.round(minPct + (maxPct - minPct) * x);
}

export function targetPct(o: { auto: boolean; manualPct: number; minPct: number; maxPct: number; nightMaxPct: number; lux: number | null; night: boolean }): number {
  let p = !o.auto || o.lux === null ? o.manualPct : luxToPct(o.lux, o.minPct, o.maxPct);
  if (o.auto && o.night) p = Math.min(p, o.nightMaxPct);
  return Math.max(1, Math.min(100, p));
}

export type Backend = { kind: 'ddcutil' | 'sysfs' | 'sim' | 'none'; set(pct: number): Promise<void> };

const run = (cmd: string, args: string[], ms = 8000) => new Promise<string>((res, rej) => execFile(cmd, args, { timeout: ms }, (e, out) => (e ? rej(e) : res(String(out)))));

export async function pickBrightnessBackend(sim: boolean): Promise<Backend> {
  const simB: Backend = { kind: 'sim', async set() { /* desk: nothing to drive */ } };
  if (sim || process.platform !== 'linux') return simB;
  try {
    await run('ddcutil', ['detect', '--brief'], 15_000);
    return { kind: 'ddcutil', set: async (pct) => { await run('ddcutil', ['setvcp', '10', String(Math.round(pct)), '--noverify']); } };
  } catch { /* no ddcutil or no DDC panel */ }
  try {
    const dirs = await readdir('/sys/class/backlight');
    if (dirs.length) {
      const dir = `/sys/class/backlight/${dirs[0]}`;
      const max = Number(await readFile(`${dir}/max_brightness`, 'utf8'));
      return { kind: 'sysfs', set: async (pct) => { await writeFile(`${dir}/brightness`, String(Math.round((max * pct) / 100))); } };
    }
  } catch { /* no backlight class */ }
  return { kind: 'none', async set() { throw new Error('no ddcutil panel and no /sys/class/backlight'); } };
}

/** Exponential smoothing of lux in log space, so a passing shadow doesn't flicker the screen. */
export function smoothLux(prev: number | null, lux: number, k = 0.3): number {
  if (prev === null) return lux;
  const a = Math.log10(Math.max(1, prev)), b = Math.log10(Math.max(1, lux));
  return Math.round(10 ** (a + k * (b - a)));
}
