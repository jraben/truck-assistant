import { describe, expect, it } from 'vitest';
import { simulateWeek, ROAD_FACTOR } from '../src/weekSim.ts';

// A drive east along a street: one fix a minute at ~30 mph (0.5 mi apart), parked before and after.
const H = 3_600_000, MIN = 60_000;
function drive(start: number, miles: number) {
  const pts = [];
  const lat = 33.45, lon0 = -112.07, mpdeg = 57.7; // miles per degree of longitude here
  for (let i = 0; i <= miles * 2; i++) pts.push({ t: start + i * MIN, lat, lon: lon0 + (i * 0.5) / mpdeg, speedMph: 30, accuracyM: 10 });
  return pts;
}
const day = (d: number) => [new Date(2026, 10, d), new Date(2026, 10, d + 1)] as [Date, Date];
const P = { packKwh: 50, eff: { city: 4, highway: 3 }, highwayMph: 45, startSoc: 80, chargeTo: 80, homeRate: { flatPerKwh: 0.15, tou: [], fixedPerSession: 0, demandPerKw: null }, compare: { label: 'Gas truck', mpgCity: 20, mpgHighway: 25, mpgCombined: 22 }, gasPrice: 3 };

describe('simulate my week', () => {
  it('turns a day of phone fixes into miles, kWh, charge level, home charging and gas', () => {
    const base = new Date(2026, 10, 9, 8).getTime();
    const pts = [
      ...Array.from({ length: 20 }, (_, i) => ({ t: base - 3 * H + i * 6 * MIN, lat: 33.45, lon: -112.07, speedMph: 0, accuracyM: 10 })),
      ...drive(base, 10),
      ...Array.from({ length: 20 }, (_, i) => ({ t: base + 40 * MIN + i * 6 * MIN, lat: 33.45, lon: -112.07 + 10 / 57.7, speedMph: 0, accuracyM: 10 })),
    ];
    const r = simulateWeek(pts, [day(9), day(10)], P, 'device_tracker.life360_test');
    const d = r.days[0];
    expect(d.trips.length).toBe(1);
    expect(d.miles).toBeGreaterThan(10 * ROAD_FACTOR * 0.9);
    expect(d.miles).toBeLessThan(10 * ROAD_FACTOR * 1.1);
    expect(d.trips[0].mode).toBe('city');
    expect(d.kwh).toBeCloseTo(d.miles / 4, 0);
    expect(d.socLow).toBeLessThan(80);
    expect(d.chargeKwh).toBeGreaterThan(d.kwh);                 // charging losses
    expect(d.chargeCost).toBeCloseTo(d.chargeKwh * 0.15, 1);
    expect(d.gasCost).toBeCloseTo((d.miles / 20) * 3, 1);
    expect(d.coverage).toBe('good');
    expect(r.days[1]).toMatchObject({ trips: [], miles: 0, coverage: 'none', socStart: 80 });
    expect(r.totals.saved).toBeCloseTo(r.totals.gasCost! - r.totals.chargeCost!, 2);
    expect(r.notes.join(' ')).toMatch(/1 of 2 days/);
  });
  it('fast charges on the road when the level would go below 10%, and says when costs are unknown', () => {
    const base = new Date(2026, 10, 9, 8).getTime();
    const r = simulateWeek(drive(base, 160), [day(9)], { ...P, homeRate: { flatPerKwh: null, tou: [], fixedPerSession: 0, demandPerKw: null }, gasPrice: null }, 't');
    const d = r.days[0];
    expect(d.ranOut).toBe(true);
    expect(d.fastStops).toBeGreaterThanOrEqual(1);
    expect(d.socLow).toBeGreaterThanOrEqual(9.9);
    expect(d.fastCost).toBeNull();
    expect(r.totals.saved).toBeNull();
    expect(r.notes.join(' ')).toMatch(/fast-charge stop/);
    const priced = simulateWeek(drive(base, 160), [day(9)], { ...P, dcPerKwh: 0.5 }, 't');
    expect(priced.days[0].fastCost).toBeCloseTo(priced.days[0].fastKwh * 0.5, 1);
    expect(priced.totals.saved).toBeCloseTo(priced.totals.gasCost! - priced.totals.chargeCost! - priced.totals.fastCost!, 2);
  });
});
