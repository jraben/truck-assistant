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

describe('stored phone trips', () => {
  it('scales Home Assistant imports to roads, keeps Timeline distances, and says which', async () => {
    const { simulateStored, ROAD_FACTOR } = await import('../src/weekSim.ts');
    const t0 = new Date(2026, 10, 9, 9).getTime();
    const r = simulateStored([
      { startedAt: t0, endedAt: t0 + 30 * 60_000, miles: 10, straight: true },
      { startedAt: t0 + 3_600_000, endedAt: t0 + 5_400_000, miles: 10, straight: false },
    ], [[new Date(2026, 10, 9), new Date(2026, 10, 10)]], P, 'Jeff');
    expect(r.days[0].miles).toBeCloseTo(10 * ROAD_FACTOR + 10, 1);
    expect(r.notes.join(' ')).toMatch(/1 drive from Google Timeline/);
    expect(r.notes.join(' ')).toMatch(/1 trip imported from Home Assistant/);
  });
  it('picks the top separate days and simulates them back to back', async () => {
    const { simulateStored, topDays } = await import('../src/weekSim.ts');
    const at = (d: number, h = 9) => new Date(2026, 9, d, h).getTime();
    const trips = [[1, 5], [3, 80], [3, 20], [9, 60], [15, 2], [20, 90]].map(([d, mi], i) => ({ startedAt: at(d, 8 + i), endedAt: at(d, 8 + i) + 1_800_000, miles: mi }));
    const top = topDays(trips, new Date(2026, 9, 1), new Date(2026, 10, 1), 3)!;
    expect(top.days.map((x) => x.day)).toEqual(['2026-10-03', '2026-10-09', '2026-10-20']);
    expect(top.miles).toBe(250);
    expect(top.days[0].trips).toBe(2);
    const days = top.days.map((x) => { const [y, m, d] = x.day.split('-').map(Number); return [new Date(y, m - 1, d), new Date(y, m - 1, d + 1)] as [Date, Date]; });
    const r = simulateStored(trips.map((t) => ({ ...t, straight: false })), days, P, 'Jeff');
    expect(r.days.map((d) => d.miles)).toEqual([100, 60, 90]);
    expect(r.notes.join(' ')).toMatch(/^4 drives from Google Timeline/);
    expect(topDays([], new Date(2026, 9, 1), new Date(2026, 10, 1))).toBeNull();
  });
  it('ranks top days by highway or around-town miles', async () => {
    const { topDays } = await import('../src/weekSim.ts');
    const at = (d: number, mi: number, mins: number) => ({ startedAt: new Date(2026, 9, d, 9).getTime(), endedAt: new Date(2026, 9, d, 9).getTime() + mins * 60_000, miles: mi });
    // Oct 1: 120 highway (60 mph). Oct 2: 40 in town (20 mph). Oct 3: 30 highway + 30 town.
    const trips = [at(1, 120, 120), at(2, 40, 120), { ...at(3, 30, 30) }, { ...at(3, 30, 90), startedAt: new Date(2026, 9, 3, 14).getTime(), endedAt: new Date(2026, 9, 3, 15, 30).getTime() }];
    const F = new Date(2026, 9, 1), T = new Date(2026, 10, 1);
    expect(topDays(trips, F, T, 1, 'highway')!.days[0].day).toBe('2026-10-01');
    expect(topDays(trips, F, T, 1, 'city')!.days[0].day).toBe('2026-10-02');
    const c = topDays(trips, F, T, 2, 'city')!;
    expect(c.days.map((x) => x.day)).toEqual(['2026-10-02', '2026-10-03']);
    expect(c.days[1]).toMatchObject({ cityMiles: 30, highwayMiles: 30, miles: 60 });
    expect(topDays(trips, F, T, 1)!.days[0].day).toBe('2026-10-01');
  });
  it('compares the week with gas cars: savings highway vs town, break-even gas price, how far power could rise', async () => {
    const { simulateStored, compareCars, yearsToMultiple } = await import('../src/weekSim.ts');
    const t0 = new Date(2026, 10, 9, 9).getTime();
    // 30 town miles in an hour, 60 highway miles in an hour.
    const trips = [{ startedAt: t0, endedAt: t0 + 3_600_000, miles: 30, straight: false }, { startedAt: t0 + 7_200_000, endedAt: t0 + 10_800_000, miles: 60, straight: false }];
    const sim = simulateStored(trips, [[new Date(2026, 10, 9), new Date(2026, 10, 10)]], { ...P, dcPerKwh: 0.5 }, 'Jeff');
    const [c] = compareCars(sim, [{ vehicle: { label: 'Truck', mpgCity: 10, mpgHighway: 20, mpgCombined: 13, fuel: 'regular' }, gasPrice: 4 }]);
    expect(c.gallons).toBeCloseTo(30 / 10 + 60 / 20, 2);
    expect(c.gasCost).toBeCloseTo(24, 2);
    const slate = sim.totals.chargeCost! + sim.totals.fastCost!;
    expect(c.slateCost).toBeCloseTo(slate, 2);
    expect(c.breakEvenGas! * c.gallons).toBeCloseTo(slate, 1);
    expect(c.elecMultiple).toBeCloseTo(24 / slate, 1);
    expect(c.highway.miles).toBe(60);
    expect(c.town.miles).toBe(30);
    expect(c.highway.slateCost! + c.town.slateCost!).toBeCloseTo(slate, 1);
    expect(c.town.savedPer100!).toBeGreaterThan(c.highway.savedPer100!);
    expect(yearsToMultiple(2, 3)).toBeCloseTo(23.4, 1);
    expect(yearsToMultiple(0.8, 3)).toBe(0);
    expect(compareCars(sim, [{ vehicle: { label: 'X', mpgCity: 10, mpgHighway: 20, mpgCombined: 13, fuel: 'premium' }, gasPrice: null }])[0].saved).toBeNull();
  });
});

