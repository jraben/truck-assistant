import { describe, expect, it } from 'vitest';
import { homeRateAt, kwhFromSoc, periodCovers, priceHomeSession } from '../src/charges/pricing.ts';
import { periodKey, summarize } from '../src/charges/summary.ts';
import { ChargeService } from '../src/charges/service.ts';
import { ChargeStore, parseSessionInput, toCsv } from '../src/charges/store.ts';
import { openDb } from '../src/db.ts';
import { customVehicle, defaultSettings } from '../src/settings.ts';
import type { ChargeSession, Settings, TouPeriod } from '../src/types.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Local-time dates: the brain prices by the Pi's own clock.
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
// 2027-05-03 is a Monday.
const MON = (h: number, mi = 0) => at(2027, 5, 3, h, mi);
const TUE = (h: number, mi = 0) => at(2027, 5, 4, h, mi);
const SAT = (h: number, mi = 0) => at(2027, 5, 8, h, mi);
const SUN = (h: number, mi = 0) => at(2027, 5, 9, h, mi);

const WEEKDAYS = [1, 2, 3, 4, 5];
const onPeak: TouPeriod = { name: 'on-peak', days: WEEKDAYS, start: '16:00', end: '19:00', perKwh: 0.28 };
const superOff: TouPeriod = { name: 'super off-peak', days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '05:00', perKwh: 0.06 };

describe('TOU periods', () => {
  it('covers a same-day window on its days only, end exclusive', () => {
    expect(periodCovers(onPeak, MON(16))).toBe(true);
    expect(periodCovers(onPeak, MON(18, 59))).toBe(true);
    expect(periodCovers(onPeak, MON(19))).toBe(false);
    expect(periodCovers(onPeak, MON(15, 59))).toBe(false);
    expect(periodCovers(onPeak, SAT(17))).toBe(false);
  });

  it('a window crossing midnight belongs to the day it starts on', () => {
    const friNight: TouPeriod = { name: 'fri night', days: [5], start: '22:00', end: '06:00', perKwh: 0.05 };
    expect(periodCovers(friNight, at(2027, 5, 7, 23))).toBe(true);  // Fri 23:00
    expect(periodCovers(friNight, SAT(2))).toBe(true);              // early Sat = Fri night
    expect(periodCovers(friNight, SAT(6))).toBe(false);             // end exclusive
    expect(periodCovers(friNight, SAT(23))).toBe(false);            // Sat night is not Fri's
    expect(periodCovers(friNight, at(2027, 5, 7, 2))).toBe(false);  // early Fri = Thu night
  });

  it('crossing midnight from Saturday into Sunday wraps the week', () => {
    const satNight: TouPeriod = { name: 'sat night', days: [6], start: '21:00', end: '03:00', perKwh: 0.04 };
    expect(periodCovers(satNight, SUN(1))).toBe(true);
    expect(periodCovers(satNight, MON(1))).toBe(false);
  });

  it('start == end means all day on those days', () => {
    expect(periodCovers({ name: 'weekend', days: [0, 6], start: '00:00', end: '00:00', perKwh: 0.1 }, SUN(13))).toBe(true);
    expect(periodCovers({ name: 'weekend', days: [0, 6], start: '00:00', end: '00:00', perKwh: 0.1 }, MON(13))).toBe(false);
  });

  it('picks the period covering the start, else the flat rate, else null', () => {
    const rate: Settings['homeRate'] = { flatPerKwh: 0.13, tou: [onPeak, superOff], fixedPerSession: 0 };
    expect(homeRateAt(rate, MON(17))).toEqual({ perKwh: 0.28, period: 'on-peak' });
    expect(homeRateAt(rate, TUE(1))).toEqual({ perKwh: 0.06, period: 'super off-peak' });
    expect(homeRateAt(rate, MON(23, 30))).toEqual({ perKwh: 0.06, period: 'super off-peak' });
    expect(homeRateAt(rate, MON(10))).toEqual({ perKwh: 0.13, period: 'flat' });
    expect(homeRateAt({ flatPerKwh: null, tou: [onPeak], fixedPerSession: 0 }, MON(10))).toBeNull();
  });
});

describe('home session pricing', () => {
  const rate: Settings['homeRate'] = { flatPerKwh: 0.14, tou: [superOff], fixedPerSession: 0.5 };
  it('kWh x rate at the start time + per-session fee', () => {
    expect(priceHomeSession(30, MON(23, 15), rate)).toBe(2.3); // 30 x 0.06 + 0.50
    expect(priceHomeSession(30, MON(12), rate)).toBe(4.7);     // 30 x 0.14 + 0.50
  });
  it('unknown kWh or no rate is null, not $0', () => {
    expect(priceHomeSession(null, MON(12), rate)).toBeNull();
    expect(priceHomeSession(10, MON(12), { flatPerKwh: null, tou: [], fixedPerSession: 0 })).toBeNull();
  });
  it('infers wall kWh from a SoC rise through 90% charging efficiency', () => {
    expect(kwhFromSoc(20, 80, 52.7)).toBeCloseTo(35.13, 2); // 0.6 x 52.7 / 0.9
    expect(kwhFromSoc(80, 80, 52.7)).toBeNull();
    expect(kwhFromSoc(null, 80, 52.7)).toBeNull();
  });
});

const sess = (o: Partial<ChargeSession>): ChargeSession => ({
  id: 1, startedAt: at(2027, 5, 10, 12).toISOString(), endedAt: null, place: 'public', network: null, stationName: null,
  lat: null, lon: null, kwh: null, cost: null, costSource: null, startSoc: null, endSoc: null, maxKw: null, note: null, source: 'manual', driverId: null, simulated: false, ...o,
});

describe('summary math', () => {
  const s = { vehicle: customVehicle(22), priceFor: () => 3.5 };

  it('groups by local month, splits home/public, computes $/kWh, $/mile and the gas comparison', () => {
    const sessions = [
      sess({ startedAt: at(2027, 5, 2, 23).toISOString(), place: 'home', kwh: 40, cost: 2.4, costSource: 'home-rate' }),
      sess({ startedAt: at(2027, 5, 15, 13).toISOString(), place: 'public', kwh: 30, cost: 14.1, costSource: 'receipt' }),
      sess({ startedAt: at(2027, 5, 20, 9).toISOString(), place: 'public', kwh: null, cost: 5, costSource: 'receipt' }), // no kWh
      sess({ startedAt: at(2027, 6, 1, 8).toISOString(), place: 'other', kwh: 10, cost: 0, costSource: 'free' }),
    ];
    const trips = [
      { startedAt: at(2027, 5, 3, 8).toISOString(), miles: 120 },
      { startedAt: at(2027, 5, 18, 8).toISOString(), miles: 100 },
      { startedAt: at(2027, 6, 2, 8).toISOString(), miles: 44 },
    ];
    const [may, june] = summarize(sessions, trips, 'month', s);
    expect(may).toEqual({
      period: '2027-05', sessions: 3, kwh: 70, cost: 21.5, homeCost: 2.4, publicCost: 19.1,
      costPerKwh: 0.236,   // (2.40 + 14.10) / 70; the $5 receipt without kWh is left out of the rate
      miles: 220, costPerMile: 0.098, gasEquivalent: 35, // 220 / 22 x 3.50
      gasVehicle: 'Custom',
    });
    expect(june).toMatchObject({ period: '2027-06', sessions: 1, kwh: 10, cost: 0, costPerKwh: 0, miles: 44, costPerMile: 0, gasEquivalent: 7 });
  });

  it('a period with trips and no charging still appears; unknowns are null not 0', () => {
    const [r] = summarize([], [{ startedAt: at(2027, 3, 3, 8).toISOString(), miles: 50 }], 'month', s);
    expect(r).toMatchObject({ period: '2027-03', sessions: 0, cost: 0, costPerKwh: null, miles: 50, costPerMile: 0 });
    const [c] = summarize([sess({ cost: null, kwh: 12 })], [], 'month', s);
    expect(c).toMatchObject({ costPerKwh: null, costPerMile: null, gasEquivalent: null, miles: 0 });
  });

  it('year periods and ordering', () => {
    const rows = summarize([sess({ startedAt: at(2028, 1, 2, 1).toISOString(), cost: 3 }), sess({ startedAt: at(2027, 12, 31, 23).toISOString(), cost: 2 })], [], 'year', s);
    expect(rows.map((r) => [r.period, r.cost])).toEqual([['2027', 2], ['2028', 3]]);
    expect(periodKey(at(2027, 12, 31, 23, 59).toISOString(), 'month')).toBe('2027-12');
  });
});

describe('session input and CSV', () => {
  it('validates and normalises', () => {
    expect(parseSessionInput({ cost: '12.5', place: 'public', network: '  EA ' })).toEqual({ cost: 12.5, place: 'public', network: 'EA' });
    expect(() => parseSessionInput({ place: 'moon' })).toThrow(/place/);
    expect(() => parseSessionInput({ kwh: -3 })).toThrow(/kwh/);
  });
  it('escapes CSV', () => {
    const csv = toCsv([sess({ note: 'paid, "idle" fee', cost: 4 })]);
    expect(csv.split('\r\n')[1]).toContain('"paid, ""idle"" fee"');
  });
});

describe('charge detection', () => {
  const setup = () => {
    const db = openDb(mkdtempSync(path.join(tmpdir(), 'slate-test-')));
    const svc = new ChargeService(new ChargeStore(db));
    const settings = defaultSettings();
    settings.homeLocation = { lat: 33.4990, lon: -111.9800 };
    settings.homeRate = { flatPerKwh: 0.12, tou: [], fixedPerSession: 0 };
    const ctx = (gps: { lat: number; lon: number } | null, parked = true) => ({
      settings, parked, gps, homeChargerKwh: null, driverId: 'jeff',
      nearestStation: () => ({ id: 'afdc:1', source: 'afdc' as const, name: 'EA Tempe', network: 'Electrify America', lat: 33.43, lon: -111.9, maxKw: 150, connectors: ['CCS'], amenities: [], price: null }),
    });
    return { svc, ctx };
  };
  const change = (prev: number | null, next: number, at = '2027-05-03T20:00:00Z') => ({ prev, next, source: 'manual' as const, prevAt: '2027-05-03T18:00:00Z', at });

  it('a parked rise at home is a priced home session', () => {
    const { svc, ctx } = setup();
    const s = svc.onSocAnchor(change(30, 80), ctx({ lat: 33.4991, lon: -111.9801 }))!;
    expect(s.place).toBe('home');
    expect(s.source).toBe('detected');
    expect(s.kwh).toBeCloseTo(29.28, 2); // 0.5 x 52.7 / 0.9
    expect(s.cost).toBeCloseTo(3.51, 2);
    expect(s.costSource).toBe('home-rate');
    expect(s.startedAt).toBe('2027-05-03T18:00:00.000Z');
  });

  it('a parked rise elsewhere is an unpriced public draft named after the nearest charger', () => {
    const { svc, ctx } = setup();
    const s = svc.onSocAnchor(change(20, 70), ctx({ lat: 33.43, lon: -111.9 }))!;
    expect(s).toMatchObject({ place: 'public', network: 'Electrify America', stationName: 'EA Tempe', cost: null, costSource: null, maxKw: 150 });
  });

  it('ignores small changes, drops, unknown starts and rises while moving', () => {
    const { svc, ctx } = setup();
    expect(svc.onSocAnchor(change(50, 51), ctx(null))).toBeNull();
    expect(svc.onSocAnchor(change(50, 40), ctx(null))).toBeNull();
    expect(svc.onSocAnchor(change(null, 80), ctx(null))).toBeNull();
    expect(svc.onSocAnchor(change(40, 80), ctx(null, false))).toBeNull();
  });

  it('a second step-up soon after extends the same session', () => {
    const { svc, ctx } = setup();
    const a = svc.onSocAnchor(change(30, 60), ctx({ lat: 33.4990, lon: -111.9800 }))!;
    const b = svc.onSocAnchor(change(60, 80, '2027-05-03T21:00:00Z'), ctx({ lat: 33.4990, lon: -111.9800 }))!;
    expect(b.id).toBe(a.id);
    expect(b.endSoc).toBe(80);
    expect(svc.store.list()).toHaveLength(1);
  });
});
