import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { TripStore } from '../src/trips.ts';
import { ChargeStore } from '../src/charges/store.ts';
import { tripGallons } from '../src/charges/summary.ts';
import { computeDay, priceForGoalDay, projectPayoff, summarizeGoal, tripSplit, addDays, goalLine, ledgerCsv } from '../src/goal/ledger.ts';
import { GoalService } from '../src/goal/service.ts';
import { defaultSettings } from '../src/settings.ts';
import { DEFAULT_LAYOUT, migrateChargeLayout } from '../src/layout.ts';
import type { CompareVehicle, GoalDay, Settings } from '../src/types.ts';

const truck: CompareVehicle = { id: 1, label: '2024 Gas Truck', mpgCity: 20, mpgHighway: 25, mpgCombined: 22, fuel: 'regular' };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('ledger day math', () => {
  it('city at city mpg, highway at highway mpg, the rest at combined (same as the Charge view)', () => {
    const t = { startedAt: at(2027, 5, 1), miles: 30, cityMiles: 10, highwayMiles: 15 };
    expect(tripSplit(t)).toEqual({ city: 10, highway: 15, other: 5 });
    const d = computeDay('2027-05-01', [t], [], truck, { price: 4, source: 'day' }, true, 'x');
    expect(d.gallons).toBeCloseTo(10 / 20 + 15 / 25 + 5 / 22, 3);
    expect(d.gallons).toBeCloseTo(tripGallons(t, truck), 3);
    expect(d.gasCost).toBeCloseTo(d.gallons * 4, 1);
    expect(d.net).toBe(d.gasCost);
  });

  it('subtracts what charging cost; home is left out when includeHomeCharging is off; unknown costs are counted', () => {
    const trips = [{ startedAt: at(2027, 5, 1), miles: 44, cityMiles: null, highwayMiles: null }];
    const sessions = [
      { startedAt: at(2027, 5, 1, 2), place: 'home' as const, cost: 3 },
      { startedAt: at(2027, 5, 1, 15), place: 'public' as const, cost: 5 },
      { startedAt: at(2027, 5, 1, 18), place: 'public' as const, cost: null },
    ];
    const on = computeDay('2027-05-01', trips, sessions, truck, { price: 3.5, source: 'day' }, true, 'x');
    expect(on.gasCost).toBe(7); // 44 / 22 x 3.50
    expect(on.chargeCost).toBe(8);
    expect(on.net).toBe(-1);
    expect(on.chargeCostUnknown).toBe(1);
    const off = computeDay('2027-05-01', trips, sessions, truck, { price: 3.5, source: 'day' }, false, 'x');
    expect(off.chargeCost).toBe(5);
    expect(off.homeChargeExcluded).toBe(3);
    expect(off.net).toBe(2);
  });

  it('a possible demand charge is its own line, never subtracted', () => {
    const d = computeDay('2027-05-03', [], [{ startedAt: at(2027, 5, 3, 16), place: 'home', cost: 2, possibleDemand: 141 }, { startedAt: at(2027, 5, 3, 17), place: 'home', cost: 1, possibleDemand: 90 }], truck, { price: 3, source: 'day' }, true, 'x');
    expect(d.possibleDemandCharge).toBe(141);
    expect(d.net).toBe(-3);
  });

  it("gas price: that day's, else the nearest day's, else the manual price", () => {
    const rows = [{ day: '2027-05-01', fuel: 'regular', price: 3.9 }, { day: '2027-05-10', fuel: 'regular', price: 4.2 }, { day: '2027-05-04', fuel: 'premium', price: 5 }];
    const ha = { source: 'ha' as const, manualPrice: 3.5 };
    expect(priceForGoalDay('2027-05-10', 'regular', rows, ha)).toEqual({ price: 4.2, source: 'day' });
    expect(priceForGoalDay('2027-05-04', 'regular', rows, ha)).toEqual({ price: 3.9, source: 'nearest' });
    expect(priceForGoalDay('2027-05-08', 'regular', rows, ha)).toEqual({ price: 4.2, source: 'nearest' });
    expect(priceForGoalDay('2027-05-04', 'diesel', rows, ha)).toEqual({ price: 3.5, source: 'manual' });
    expect(priceForGoalDay('2027-05-10', 'regular', rows, { source: 'manual', manualPrice: 3.1 })).toEqual({ price: 3.1, source: 'manual' });
  });
});

describe('summary and projection', () => {
  const day = (d: string, net: number): GoalDay => ({ ...computeDay(d, [], [], truck, { price: 3, source: 'day' }, true, 'x'), trips: 1, miles: 10, net, gasCost: net });
  const goal = { target: 1000, startDate: '2027-01-01', includeHomeCharging: true };
  const ex = { simulatedTrips: 0, phoneTrips: 0, simulatedSessions: 0 };

  it('not enough driving yet before 30 days; projected at the 90-day rate after', () => {
    const early = summarizeGoal({ goal, start: { day: '2027-01-01', source: 'setting' }, today: '2027-01-20', days: [day('2027-01-05', 50)], adjustments: [], vehicle: truck, excluded: ex, computedAt: null });
    expect(early.projection.state).toBe('not-enough-data');
    const days = Array.from({ length: 60 }, (_, i) => day(addDays('2027-01-01', i), 10));
    const s = summarizeGoal({ goal, start: { day: '2027-01-01', source: 'setting' }, today: '2027-03-01', days, adjustments: [], vehicle: truck, excluded: ex, computedAt: null });
    expect(s.saved).toBe(600); // $10 a day, Jan 1 .. Mar 1
    expect(s.daysOfData).toBe(60);
    expect(s.projection).toEqual({ state: 'projected', date: addDays('2027-03-01', 40) }); // $400 left at $10/day
  });

  it('projection math', () => {
    expect(projectPayoff({ target: 1000, saved: 400, daysOfData: 90, windowNet: 450, windowDays: 90, today: '2027-04-01', paidOffOn: null }))
      .toEqual({ state: 'projected', date: addDays('2027-04-01', 120) }); // $5/day, $600 left
    expect(projectPayoff({ target: 1000, saved: 400, daysOfData: 29, windowNet: 450, windowDays: 29, today: '2027-04-01', paidOffOn: null }).state).toBe('not-enough-data');
    expect(projectPayoff({ target: 1000, saved: 400, daysOfData: 90, windowNet: -5, windowDays: 90, today: '2027-04-01', paidOffOn: null }).state).toBe('not-saving');
    expect(projectPayoff({ target: 1000, saved: 1000, daysOfData: 90, windowNet: 5, windowDays: 90, today: '2027-04-01', paidOffOn: '2027-03-30' })).toEqual({ state: 'paid-off', date: '2027-03-30' });
    expect(projectPayoff({ target: 1000, saved: 0, daysOfData: 0, windowNet: 0, windowDays: 0, today: '2027-04-01', paidOffOn: null }).state).toBe('no-data');
  });

  it('adjustments count; days before the start never do; average per month over 90 days', () => {
    const days = [day('2026-12-31', 500), ...Array.from({ length: 90 }, (_, i) => day(addDays('2027-01-01', i), 3))];
    const s = summarizeGoal({ goal, start: { day: '2027-01-01', source: 'setting' }, today: addDays('2027-01-01', 89), days, adjustments: [{ id: 1, day: '2026-11-01', label: 'Rebate', amount: 100, createdAt: '' }, { id: 2, day: '2027-02-01', label: 'Fee', amount: -20, createdAt: '' }], vehicle: truck, excluded: ex, computedAt: null });
    expect(s.ledgerSaved).toBe(270);
    expect(s.adjustmentsTotal).toBe(80);
    expect(s.saved).toBe(350);
    expect(s.pct).toBe(35);
    expect(s.avgPerMonth).toBeCloseTo(3 * 30.44, 1);
    expect(s.projection.state).toBe('projected');
    expect(goalLine(s)).toBe('Truck payoff: $350 of $1,000 (35.0%)');
    expect(s.months.map((m) => m.month)).toEqual(['2027-01', '2027-02', '2027-03']);
  });
});

function setup(sim = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'slate-goal-'));
  const db = openDb(dir);
  let st: Settings = defaultSettings();
  st = { ...st, compareVehicle: truck, gas: { ...st.gas, source: 'manual', manualPrice: 4 }, payoffGoal: { ...st.payoffGoal, startDate: '2027-05-01' } };
  const goal = new GoalService(db, () => st, () => []);
  const trips = new TripStore(db, { sim });
  const charges = new ChargeStore(db, { sim });
  const drive = (when: Date, miles: number, store = trips) => { const t = store.start(when, null, null); store.addMiles(t.id, miles); store.end(t.id, new Date(when.getTime() + 1800_000), null, null, 3.5, 'test'); return t.id; };
  return { db, goal, trips, charges, drive, set: (p: Partial<Settings>) => { st = { ...st, ...p }; }, get: () => st };
}

describe('goal ledger in SQLite', () => {
  it('a closed month is frozen: a new comparison vehicle or gas price does not rewrite it; recalc does', () => {
    const g = setup();
    g.drive(new Date(2027, 4, 10, 9), 44);
    g.drive(new Date(2027, 5, 3, 9), 44);
    g.goal.refresh(new Date(2027, 5, 5, 12)); // May has ended: frozen. June runs.
    const may = g.goal.ledger('2027-05-10', '2027-05-10')[0];
    expect(may.frozen).toBe(true);
    expect(may.gasCost).toBe(8); // 44 / 22 x $4
    g.set({ compareVehicle: { ...truck, label: 'Thirsty', mpgCombined: 11 }, gas: { ...g.get().gas, manualPrice: 5 } });
    g.goal.refresh(new Date(2027, 5, 6, 12));
    expect(g.goal.ledger('2027-05-10', '2027-05-10')[0]).toMatchObject({ gasCost: 8, vehicle: { label: '2024 Gas Truck' }, frozen: true });
    const jun = g.goal.ledger('2027-06-03', '2027-06-03')[0];
    expect(jun).toMatchObject({ gasCost: 20, frozen: false, vehicle: { label: 'Thirsty' }, gasPrice: 5 }); // 44 / 11 x $5
    g.goal.recalc(new Date(2027, 5, 6, 12));
    expect(g.goal.ledger('2027-05-10', '2027-05-10')[0]).toMatchObject({ gasCost: 20, vehicle: { label: 'Thirsty' }, frozen: true });
    g.db.close();
  });

  it('a late charge in a closed month is not counted until recalc', () => {
    const g = setup();
    g.drive(new Date(2027, 4, 10, 9), 44);
    g.goal.refresh(new Date(2027, 5, 2));
    g.charges.create({ startedAt: new Date(2027, 4, 10, 20).toISOString(), endedAt: null, place: 'public', network: null, stationName: null, lat: null, lon: null, kwh: 10, cost: 5, costSource: 'receipt', startSoc: null, endSoc: null, maxKw: null, note: null, source: 'manual', driverId: null });
    g.goal.refresh(new Date(2027, 5, 3));
    expect(g.goal.summary(new Date(2027, 5, 3)).saved).toBe(8);
    g.goal.recalc(new Date(2027, 5, 3));
    expect(g.goal.summary(new Date(2027, 5, 3)).saved).toBe(3);
    g.db.close();
  });

  it('phone trips, simulated trips and sessions, and anything before the start date never count', () => {
    const g = setup();
    g.drive(new Date(2027, 3, 30, 9), 44); // before the start date
    g.drive(new Date(2027, 4, 2, 9), 44, new TripStore(g.db, { sim: true }));
    g.trips.insertPhone({ driverId: 'jeff', startedAt: new Date(2027, 4, 2, 9).getTime(), endedAt: new Date(2027, 4, 2, 10).getTime(), miles: 50, points: [{ t: 0, lat: 1, lon: 1, speedMph: null }, { t: 1, lat: 1.1, lon: 1.1, speedMph: null }], startStopId: null, endStopId: null });
    new ChargeStore(g.db, { sim: true }).create({ startedAt: new Date(2027, 4, 2, 20).toISOString(), endedAt: null, place: 'public', network: null, stationName: null, lat: null, lon: null, kwh: 10, cost: 9, costSource: 'receipt', startSoc: null, endSoc: null, maxKw: null, note: null, source: 'manual', driverId: null });
    g.drive(new Date(2027, 4, 3, 9), 22);
    g.goal.refresh(new Date(2027, 4, 4));
    const s = g.goal.summary(new Date(2027, 4, 4));
    expect(s.saved).toBe(4); // only the real May 3 drive: 22 / 22 x $4
    expect(s.excluded).toEqual({ simulatedTrips: 1, phoneTrips: 1, simulatedSessions: 1 });
    expect(g.goal.ledger().map((d) => d.day)).toEqual(['2027-05-03']);
    g.db.close();
  });

  it('SIM=1: every new trip is simulated, so the goal shows $0 and says why; receipts stay real', () => {
    const g = setup(true);
    g.set({ payoffGoal: { ...g.get().payoffGoal, startDate: null } });
    g.drive(new Date(2027, 4, 3, 9), 22);
    expect(g.trips.list(5)[0].simulated).toBe(true);
    const r = g.charges.create({ startedAt: new Date().toISOString(), endedAt: null, place: 'public', network: null, stationName: null, lat: null, lon: null, kwh: null, cost: 1, costSource: 'receipt', startSoc: null, endSoc: null, maxKw: null, note: null, source: 'receipt', driverId: null });
    expect(r.simulated).toBe(false);
    g.goal.refresh(new Date(2027, 4, 4));
    const s = g.goal.summary(new Date(2027, 4, 4));
    expect(s.saved).toBe(0);
    expect(s.startDate).toBeNull();
    expect(s.message).toMatch(/1 simulated trip \(SIM=1\)/);
    g.db.close();
  });

  it('without a start date, the first real truck trip starts it', () => {
    const g = setup();
    g.set({ payoffGoal: { ...g.get().payoffGoal, startDate: null } });
    g.drive(new Date(2027, 4, 7, 9), 22);
    expect(g.goal.start()).toEqual({ day: '2027-05-07', source: 'first-trip' });
    g.db.close();
  });

  it('existing rows are marked simulated when the flag arrives on a SIM=1 brain', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slate-goal-'));
    const db0 = openDb(dir);
    new TripStore(db0).start(new Date(2027, 4, 1), null, null);
    db0.exec('ALTER TABLE trips DROP COLUMN simulated; ALTER TABLE charge_sessions DROP COLUMN simulated;'); // a database from before the flag
    db0.close();
    const db = openDb(dir, { sim: true });
    expect(new TripStore(db).list(5)[0].simulated).toBe(true);
    db.close();
  });

  it('adjustments CRUD and the CSV', () => {
    const g = setup();
    const a = g.goal.addAdjustment({ day: '2027-05-01', label: 'Utility EV rebate', amount: 250 });
    expect(g.goal.updateAdjustment(a.id, { amount: 300 })?.amount).toBe(300);
    expect(() => g.goal.addAdjustment({ day: 'May 1', label: 'x', amount: 1 })).toThrow(/YYYY-MM-DD/);
    expect(g.goal.summary(new Date(2027, 4, 2)).adjustmentsTotal).toBe(300);
    expect(g.goal.deleteAdjustment(a.id)).toBe(true);
    g.drive(new Date(2027, 4, 10, 9), 44);
    g.goal.refresh(new Date(2027, 4, 11));
    expect(ledgerCsv(g.goal.ledger()).split('\r\n')[1]).toMatch(/^2027-05-10,1,44,0,0,44,2024 Gas Truck,regular,/);
    g.db.close();
  });
});

describe('Charge view layout', () => {
  it('the old default Charge view gains the goal card; a custom one is left alone', () => {
    const old = { views: [{ id: 'charge', label: 'Charge', widgets: [
      { type: 'chargers', col: 1, row: 1, w: 6, h: 2 }, { type: 'socSlider', col: 7, row: 1, w: 3, h: 1 },
      { type: 'costSummary', col: 10, row: 1, w: 3, h: 1 }, { type: 'costSessions', col: 7, row: 2, w: 6, h: 1 }] }] };
    expect(migrateChargeLayout(old).views[0].widgets.map((w) => w.type)).toContain('payoffGoal');
    const custom = structuredClone(old); custom.views[0].widgets[0].w = 5;
    expect(migrateChargeLayout(custom)).toBe(custom);
    expect(DEFAULT_LAYOUT.views.find((v) => v.id === 'charge')!.widgets.map((w) => w.type)).toContain('payoffGoal');
  });
});
