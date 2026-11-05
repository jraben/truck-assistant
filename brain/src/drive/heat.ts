// Heat (Phoenix cab). The Pi's CPU temperature from the kernel's thermal zone
// (or vcgencmd), simulated on a desk; the cabin from the truck box. Above
// throttleC the UI drops animations, above warnC it warns, and held above
// shutdownC for SHUTDOWN_HOLD_MS the brain asks the Pi to power off
// (Linux, not SIM, and HEAT_SHUTDOWN not "0"). Parked, by day, with the cabin
// at parkedSunF or more: a parked-in-sun warning.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { HeatLevel } from './types.ts';

export const SHUTDOWN_HOLD_MS = 30_000;

export function heatLevel(cpuC: number | null, t: { throttleC: number; warnC: number; shutdownC: number }): HeatLevel {
  if (cpuC === null) return 'ok';
  if (cpuC >= t.shutdownC) return 'shutdown';
  if (cpuC >= t.warnC) return 'warn';
  if (cpuC >= t.throttleC) return 'throttle';
  return 'ok';
}

export const parkedInSun = (o: { parked: boolean; daytime: boolean; cabinF: number | null; limitF: number }) => o.parked && o.daytime && o.cabinF !== null && o.cabinF >= o.limitF;

export function heatMessage(level: HeatLevel, cpuC: number | null, sun: boolean, cabinF: number | null): string | null {
  if (level === 'shutdown') return `Screen computer at ${cpuC?.toFixed(0)}°C: shutting down to protect it`;
  if (level === 'warn') return `Screen computer hot (${cpuC?.toFixed(0)}°C): animations off, shade the dash`;
  if (sun) return `Parked in the sun: cabin ${cabinF?.toFixed(0)}°F. Use a sunshade; the screen may dim or turn off`;
  return null;
}

/** "temp=48.3'C" -> 48.3 */
export function parseVcgencmd(out: string): number | null {
  const m = /temp=([\d.]+)/.exec(out);
  return m ? Number(m[1]) : null;
}

/** /sys/class/thermal/thermal_zone0/temp is millidegrees. */
export function parseThermalZone(s: string): number | null {
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n / 100) / 10 : null;
}

export type CpuReader = () => Promise<{ c: number | null; source: 'thermal' | 'vcgencmd' | 'sim' | null }>;

export function cpuReader(sim: boolean): CpuReader {
  if (sim || process.platform !== 'linux') {
    const t0 = Date.now();
    return async () => ({ c: Math.round((52 + 6 * Math.sin((Date.now() - t0) / 90_000)) * 10) / 10, source: 'sim' });
  }
  return async () => {
    try { return { c: parseThermalZone(await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8')), source: 'thermal' }; } catch { /* try vcgencmd */ }
    return new Promise((res) => execFile('vcgencmd', ['measure_temp'], { timeout: 3000 }, (err, out) => res(err ? { c: null, source: null } : { c: parseVcgencmd(String(out)), source: 'vcgencmd' })));
  };
}

export function requestShutdown(sim: boolean): boolean {
  if (sim || process.platform !== 'linux' || process.env.HEAT_SHUTDOWN === '0') { console.warn('[heat] would power off now (not on a Pi, SIM, or HEAT_SHUTDOWN=0)'); return false; }
  console.error('[heat] CPU over the shutdown limit: powering off');
  execFile('systemctl', ['poweroff'], (e) => { if (e) console.error('[heat] poweroff failed:', e.message); });
  return true;
}
