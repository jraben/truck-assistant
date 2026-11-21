// The dash tablet's battery log (src/tabletBattery.ts).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { needsAuth } from '../src/ops/auth.ts';
import { BatteryLog, parseBattery, summarize, worthKeeping, type BatterySample } from '../src/tabletBattery.ts';

const T0 = Date.parse('2026-11-20T22:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const s = (min: number, level: number, charging: boolean | null, screen: boolean | null = true): BatterySample => ({ t: at(min).toISOString(), level, charging, screen, source: 'page' });

describe('battery reports', () => {
  it('reads the page (0..1 or %) and Tasker (%BATT, %SCREEN), and ignores junk', () => {
    expect(parseBattery({ level: 0.87, charging: true, screen: true }, 'page', at(0))).toMatchObject({ level: 87, charging: true, screen: true });
    expect(parseBattery({ level: '54', charging: 'discharging', screen: 'off' }, 'tasker', at(0))).toMatchObject({ level: 54, charging: false, screen: false, source: 'tasker' });
    expect(parseBattery({ level: 40, charging: '%charging', screen: '%SCREEN' }, 'tasker', at(0))).toMatchObject({ level: 40, charging: null, screen: null });
    expect(parseBattery({ level: 140 }, 'page', at(0))).toBeNull();
    expect(parseBattery(undefined, 'page', at(0))).toBeNull();
  });
  it('keeps a change at once, an unchanged one every 5 minutes', () => {
    expect(worthKeeping(null, s(0, 80, true))).toBe(true);
    expect(worthKeeping(s(0, 80, true), s(1, 80, true))).toBe(false);
    expect(worthKeeping(s(0, 80, true), s(1, 79, true))).toBe(true);
    expect(worthKeeping(s(0, 80, true), s(1, 80, false))).toBe(true);
    expect(worthKeeping(s(0, 80, true), s(5, 80, true))).toBe(true);
  });
  it('only the tablet may post, without a login; reading needs one', () => {
    expect(needsAuth('POST', '/api/tablet/battery')).toBeNull();
    expect(needsAuth('GET', '/api/tablet/battery')).toBe('api');
  });
});

describe('the rates that answer "did it charge or drain?"', () => {
  it('splits charging, screen on, screen off and asleep (a gap in the reports)', () => {
    // Reports every 5 minutes, as the cockpit sends them; then an 8-hour silence.
    const run = (from: number, to: number, l0: number, l1: number, charging: boolean, screen: boolean) =>
      Array.from({ length: (to - from) / 5 + 1 }, (_, i) => s(from + i * 5, l0 + ((l1 - l0) * i * 5) / (to - from), charging, screen));
    const r = summarize([
      ...run(0, 60, 60, 64, true, true),              // +4 %/h charging (with CarPlay: barely)
      ...run(60, 120, 64, 54, false, true),           // -10 %/h unplugged, screen on
      ...run(120, 150, 54, 53, false, false),          // -2 %/h screen off, page still reporting
      s(630, 45, false, false),                        // 8 h with no reports: asleep, -1 %/h
    ]);
    expect(r.charging.pctPerHour).toBe(4);
    expect(r.screenOn.pctPerHour).toBe(-10);
    expect(r.screenOff.pctPerHour).toBe(-2);
    expect(r.asleep).toEqual({ pctPerHour: -1, hours: 8 });
  });
  it('says nothing from under 15 minutes of a state', () => {
    expect(summarize([s(0, 50, true), s(10, 51, true)]).charging.pctPerHour).toBeNull();
  });
});

describe('the log', () => {
  it('stores, skips repeats, and lists oldest first', () => {
    const log = new BatteryLog(openDb(mkdtempSync(path.join(tmpdir(), 'tbat-')), { sim: true }));
    const now = Date.now();
    const mk = (offMin: number, level: number) => ({ t: new Date(now - offMin * 60_000).toISOString(), level, charging: true, screen: true, source: 'page' as const });
    expect(log.record(mk(30, 70))).toBe(true);
    expect(log.record(mk(29, 70))).toBe(false);
    expect(log.record(mk(20, 72))).toBe(true);
    expect(log.list(1).map((x) => x.level)).toEqual([70, 72]);
  });
});
