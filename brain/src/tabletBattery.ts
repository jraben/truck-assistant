// The dash tablet's battery over time, to tell "it charged", "it held" and "it
// drained" apart (was the CarPlay dongle too much for the charger? did the screen
// stay on all night?). The cockpit reports with its minute check-in (level, charging,
// and whether the page is in front, which is "screen on"); a page stops running when
// the screen sleeps, so Tasker can also report (POST /api/tablet/battery, no login,
// the tablet's own address only), and a gap with no reports reads as "asleep".
// Settings › Truck shows the last 48 hours and the rate in each state.
import type { Db } from './db.ts';

export type BatterySample = { t: string; level: number; charging: boolean | null; screen: boolean | null; source: 'page' | 'tasker' };
export type Rate = { pctPerHour: number | null; hours: number };
export type BatterySummary = { charging: Rate; screenOn: Rate; screenOff: Rate; asleep: Rate };

/** A new row at most this often while nothing changes. */
export const KEEP_EVERY_MS = 5 * 60_000;
/** Longer than this between reports: the tablet was asleep (or off the network). */
export const GAP_MS = 20 * 60_000;
export const KEEP_DAYS = 30;

const flag = (v: unknown, on: string[], off: string[]): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v !== 'string' || /^%\w+$/.test(v.trim())) return null; // an unset Tasker variable
  const s = v.trim().toLowerCase();
  return on.includes(s) ? true : off.includes(s) ? false : null;
};

/** A report from the page or from Tasker (%BATT, %SCREEN, a charging flag) as a sample, or null. Pure. */
export function parseBattery(body: unknown, source: BatterySample['source'], now: Date): BatterySample | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  let level = typeof b.level === 'string' ? Number(b.level) : b.level;
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  if (level > 0 && level <= 1 && !Number.isInteger(level)) level *= 100; // the page's 0..1
  if (level < 0 || level > 100) return null;
  return {
    t: now.toISOString(), level: Math.round(level), source,
    charging: flag(b.charging, ['true', '1', 'yes', 'on', 'charging', 'ac', 'usb', 'wireless', 'full'], ['false', '0', 'no', 'off', 'discharging', 'none', 'battery']),
    screen: flag(b.screen, ['true', '1', 'on', 'yes', 'visible'], ['false', '0', 'off', 'no', 'hidden']),
  };
}

/** Keep this sample? A change, or KEEP_EVERY_MS since the last one. Pure. */
export function worthKeeping(last: BatterySample | null, s: BatterySample): boolean {
  if (!last) return true;
  if (last.level !== s.level || last.charging !== s.charging || last.screen !== s.screen) return true;
  return Date.parse(s.t) - Date.parse(last.t) >= KEEP_EVERY_MS;
}

/** % per hour in each state, from consecutive samples (oldest first). Pure. */
export function summarize(samples: BatterySample[]): BatterySummary {
  const acc = { charging: [0, 0], screenOn: [0, 0], screenOff: [0, 0], asleep: [0, 0] } as Record<keyof BatterySummary, [number, number]>;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const ms = Date.parse(b.t) - Date.parse(a.t);
    if (ms <= 0) continue;
    const key: keyof BatterySummary = ms > GAP_MS ? (a.charging ? 'charging' : 'asleep') : a.charging ? 'charging' : a.screen === false ? 'screenOff' : 'screenOn';
    if (ms > GAP_MS && a.charging) continue; // a long gap while charging says little
    acc[key][0] += b.level - a.level;
    acc[key][1] += ms / 3_600_000;
  }
  const rate = ([d, h]: [number, number]): Rate => ({ pctPerHour: h >= 0.25 ? Math.round((d / h) * 10) / 10 : null, hours: Math.round(h * 10) / 10 });
  return { charging: rate(acc.charging), screenOn: rate(acc.screenOn), screenOff: rate(acc.screenOff), asleep: rate(acc.asleep) };
}

export class BatteryLog {
  private db: Db;
  private last: BatterySample | null = null;
  private prunedAt = 0;
  constructor(db: Db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS tablet_battery (t TEXT NOT NULL, level INTEGER NOT NULL, charging INTEGER, screen INTEGER, source TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS tablet_battery_t ON tablet_battery(t)');
    this.last = this.list(24 * 365).at(-1) ?? null;
  }

  record(s: BatterySample | null): boolean {
    if (!s || !worthKeeping(this.last, s)) return false;
    const b = (v: boolean | null) => (v === null ? null : v ? 1 : 0);
    this.db.prepare('INSERT INTO tablet_battery (t, level, charging, screen, source) VALUES (?, ?, ?, ?, ?)').run(s.t, s.level, b(s.charging), b(s.screen), s.source);
    this.last = s;
    const now = Date.parse(s.t);
    if (now - this.prunedAt > 3_600_000) {
      this.prunedAt = now;
      this.db.prepare('DELETE FROM tablet_battery WHERE t < ?').run(new Date(now - KEEP_DAYS * 86_400_000).toISOString());
    }
    return true;
  }

  list(hours: number, now = Date.now()): BatterySample[] {
    const rows = this.db.prepare('SELECT t, level, charging, screen, source FROM tablet_battery WHERE t >= ? ORDER BY t').all(new Date(now - hours * 3_600_000).toISOString()) as { t: string; level: number; charging: number | null; screen: number | null; source: string }[];
    return rows.map((r) => ({ t: r.t, level: r.level, charging: r.charging === null ? null : !!r.charging, screen: r.screen === null ? null : !!r.screen, source: r.source === 'tasker' ? 'tasker' : 'page' }));
  }
}
