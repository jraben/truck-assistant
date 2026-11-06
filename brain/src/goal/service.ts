// The payoff ledger in SQLite (goal_ledger, goal_months, goal_adjustments):
// in cockpit.db, so it rides along in every Track D backup and survives
// restarts and settings migrations.
//
// Freezing: a month is finalised by the first refresh after it ends. Its days
// are computed one last time and marked frozen; from then on nothing rewrites
// them (not a new comparison vehicle, not a new gas source, not a charge
// entered late) except POST /api/goal/recalc. The month that is still running
// is recomputed day by day on every refresh, each day from its own data only.
//
// What counts: truck trips (never source 'phone') not recorded under SIM=1,
// and charge sessions not logged under SIM=1, on or after the start date.
import type { Db } from '../db.ts';
import type { CompareVehicle, GoalAdjustment, GoalDay, GoalSummary, Settings } from '../types.ts';
import { isDay } from '../settings.ts';
import { sessionDemand } from '../charges/peak.ts';
import {
  computeDay, dayRange, isEmptyDay, localDay, monthEnd, monthOf, monthStart, nextMonth, priceForGoalDay, summarizeGoal, addDays,
  type GasRow, type LedgerSession, type LedgerTrip,
} from './ledger.ts';

export class GoalInputError extends Error {}

type DayRow = {
  day: string; trips: number; miles: number; city_miles: number; highway_miles: number; other_miles: number; gallons: number;
  gas_price: number; price_source: string; vehicle: string; gas_cost: number; charge_sessions: number; charge_cost: number;
  charge_cost_unknown: number; home_excluded: number; net: number; demand: number | null; frozen: number; computed_at: string;
};

const toDay = (r: DayRow): GoalDay => ({
  day: r.day, trips: r.trips, miles: r.miles, cityMiles: r.city_miles, highwayMiles: r.highway_miles, otherMiles: r.other_miles,
  gallons: r.gallons, gasPrice: r.gas_price, priceSource: r.price_source as GoalDay['priceSource'], vehicle: JSON.parse(r.vehicle) as CompareVehicle,
  gasCost: r.gas_cost, chargeSessions: r.charge_sessions, chargeCost: r.charge_cost, chargeCostUnknown: r.charge_cost_unknown,
  homeChargeExcluded: r.home_excluded, net: r.net, possibleDemandCharge: r.demand ?? null, frozen: !!r.frozen, computedAt: r.computed_at,
});

const REAL_TRUCK_TRIP = "(source IS NULL OR source = 'truck') AND simulated = 0";

export class GoalService {
  private db: Db;
  private getSettings: () => Settings;
  private gasRows: () => GasRow[];
  private lastRefresh = 0;

  constructor(db: Db, getSettings: () => Settings, gasRows: () => GasRow[]) {
    this.db = db; this.getSettings = getSettings; this.gasRows = gasRows;
    db.exec(`
      CREATE TABLE IF NOT EXISTS goal_ledger (
        day TEXT PRIMARY KEY, trips INTEGER NOT NULL, miles REAL NOT NULL, city_miles REAL NOT NULL, highway_miles REAL NOT NULL, other_miles REAL NOT NULL,
        gallons REAL NOT NULL, gas_price REAL NOT NULL, price_source TEXT NOT NULL, vehicle TEXT NOT NULL, gas_cost REAL NOT NULL,
        charge_sessions INTEGER NOT NULL, charge_cost REAL NOT NULL, charge_cost_unknown INTEGER NOT NULL, home_excluded REAL NOT NULL,
        net REAL NOT NULL, demand REAL, frozen INTEGER NOT NULL DEFAULT 0, computed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goal_months (month TEXT PRIMARY KEY, from_day TEXT NOT NULL, finalized_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goal_adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL, created_at TEXT NOT NULL);
    `);
  }

  /** The start date: the setting, else the local day of the first real truck trip. */
  start(): { day: string; source: 'setting' | 'first-trip' } | null {
    const sd = this.getSettings().payoffGoal.startDate;
    if (sd) return { day: sd, source: 'setting' };
    const r = this.db.prepare(`SELECT started_at FROM trips WHERE ${REAL_TRUCK_TRIP} AND miles > 0 ORDER BY started_at LIMIT 1`).get() as { started_at: string } | undefined;
    return r ? { day: localDay(r.started_at), source: 'first-trip' } : null;
  }

  /** Compute [from, to] (inclusive local days) from the data, replacing any unfrozen rows there. */
  private computeRange(from: string, to: string, frozen: boolean, now: Date) {
    if (from > to) return;
    const st = this.getSettings();
    const vehicle = st.compareVehicle;
    const gasRows = st.gas.source === 'ha' ? this.gasRows() : [];
    const a = dayRange(from)[0], b = dayRange(to)[1];
    const trips = (this.db.prepare(`SELECT started_at, miles, city_miles, highway_miles FROM trips WHERE ${REAL_TRUCK_TRIP} AND started_at >= ? AND started_at < ?`).all(a, b) as
      { started_at: string; miles: number; city_miles: number | null; highway_miles: number | null }[]);
    const sessions = (this.db.prepare('SELECT started_at, ended_at, place, cost, kwh, max_kw FROM charge_sessions WHERE simulated = 0 AND started_at >= ? AND started_at < ?').all(a, b) as
      { started_at: string; ended_at: string | null; place: LedgerSession['place']; cost: number | null; kwh: number | null; max_kw: number | null }[]);
    const tByDay = new Map<string, LedgerTrip[]>(), sByDay = new Map<string, LedgerSession[]>();
    for (const t of trips) { const d = localDay(t.started_at); tByDay.set(d, [...(tByDay.get(d) ?? []), { startedAt: t.started_at, miles: t.miles, cityMiles: t.city_miles, highwayMiles: t.highway_miles }]); }
    for (const s of sessions) { const d = localDay(s.started_at); sByDay.set(d, [...(sByDay.get(d) ?? []), {
      startedAt: s.started_at, place: s.place, cost: s.cost,
      possibleDemand: sessionDemand({ startedAt: s.started_at, endedAt: s.ended_at, kwh: s.kwh, maxKw: s.max_kw, place: s.place }, st.homeRate),
    }]); }
    const at = now.toISOString();
    const del = this.db.prepare('DELETE FROM goal_ledger WHERE day = ? AND frozen = 0');
    const has = this.db.prepare('SELECT frozen FROM goal_ledger WHERE day = ?');
    const ins = this.db.prepare(`INSERT OR REPLACE INTO goal_ledger (day, trips, miles, city_miles, highway_miles, other_miles, gallons, gas_price, price_source, vehicle, gas_cost,
      charge_sessions, charge_cost, charge_cost_unknown, home_excluded, net, demand, frozen, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const cur = has.get(d) as { frozen: number } | undefined;
      if (cur?.frozen) continue; // frozen stays frozen
      del.run(d);
      const row = computeDay(d, tByDay.get(d) ?? [], sByDay.get(d) ?? [], vehicle, priceForGoalDay(d, vehicle.fuel, gasRows, st.gas), st.payoffGoal.includeHomeCharging, at);
      if (isEmptyDay(row)) continue;
      ins.run(row.day, row.trips, row.miles, row.cityMiles, row.highwayMiles, row.otherMiles, row.gallons, row.gasPrice, row.priceSource, JSON.stringify(row.vehicle), row.gasCost,
        row.chargeSessions, row.chargeCost, row.chargeCostUnknown, row.homeChargeExcluded, row.net, row.possibleDemandCharge, frozen ? 1 : 0, at);
    }
  }

  /**
   * Bring the ledger up to date: finalise every month that has ended since the
   * last refresh, recompute the running month. Cheap (one month of queries)
   * once caught up.
   */
  refresh(now = new Date()): void {
    this.lastRefresh = now.getTime();
    const start = this.start();
    const today = localDay(now);
    if (!start) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM goal_ledger WHERE day < ? AND frozen = 0').run(start.day);
      const finalized = new Map((this.db.prepare('SELECT month, from_day FROM goal_months').all() as { month: string; from_day: string }[]).map((r) => [r.month, r.from_day]));
      const curMonth = monthOf(today);
      const upd = this.db.prepare('INSERT OR REPLACE INTO goal_months (month, from_day, finalized_at) VALUES (?, ?, ?)');
      for (let m = monthOf(start.day); m <= curMonth; m = nextMonth(m)) {
        const from = start.day > monthStart(m) ? start.day : monthStart(m);
        const fin = finalized.get(m);
        if (fin !== undefined) {
          // Finalised with a later start: the days now in front of it are computed once, frozen.
          if (from < fin) { this.computeRange(from, addDays(fin, -1), true, now); upd.run(m, from, now.toISOString()); }
          continue;
        }
        if (m < curMonth) {
          this.computeRange(from, monthEnd(m), true, now);
          this.db.prepare('UPDATE goal_ledger SET frozen = 1 WHERE day >= ? AND day <= ?').run(monthStart(m), monthEnd(m));
          upd.run(m, from, now.toISOString());
        } else this.computeRange(from, today, false, now);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /** Refresh unless it ran in the last `maxAgeMs`. */
  fresh(maxAgeMs = 30_000, now = new Date()) { if (now.getTime() - this.lastRefresh > maxAgeMs) this.refresh(now); }

  /** POST /api/goal/recalc: forget every row (frozen too) and compute it all again with today's settings. */
  recalc(now = new Date()): void {
    this.db.exec('DELETE FROM goal_ledger; DELETE FROM goal_months;');
    this.refresh(now);
  }

  ledger(from?: string | null, to?: string | null): GoalDay[] {
    return (this.db.prepare('SELECT * FROM goal_ledger WHERE day >= ? AND day <= ? ORDER BY day').all(from ?? '0000', to ?? '9999') as DayRow[]).map(toDay);
  }

  private excluded(start: string | null): GoalSummary['excluded'] {
    const from = start ? dayRange(start)[0] : '0000';
    const n = (sql: string) => Number((this.db.prepare(sql).get(from) as { n: number }).n);
    return {
      simulatedTrips: n("SELECT COUNT(*) AS n FROM trips WHERE (source IS NULL OR source = 'truck') AND simulated = 1 AND started_at >= ?"),
      phoneTrips: n("SELECT COUNT(*) AS n FROM trips WHERE source = 'phone' AND started_at >= ?"),
      simulatedSessions: n('SELECT COUNT(*) AS n FROM charge_sessions WHERE simulated = 1 AND started_at >= ?'),
    };
  }

  summary(now = new Date()): GoalSummary {
    const st = this.getSettings();
    const start = this.start();
    const days = start ? this.ledger(start.day, localDay(now)) : [];
    const last = this.db.prepare('SELECT MAX(computed_at) AS at FROM goal_ledger').get() as { at: string | null };
    return summarizeGoal({
      goal: st.payoffGoal, start, today: localDay(now), days, adjustments: this.adjustments(),
      vehicle: st.compareVehicle, excluded: this.excluded(start?.day ?? null),
      computedAt: last.at ?? (this.lastRefresh ? new Date(this.lastRefresh).toISOString() : null),
    });
  }

  // ---- adjustments -----------------------------------------------------------------

  adjustments(): GoalAdjustment[] {
    return (this.db.prepare('SELECT id, day, label, amount, created_at FROM goal_adjustments ORDER BY day, id').all() as { id: number; day: string; label: string; amount: number; created_at: string }[])
      .map((r) => ({ id: r.id, day: r.day, label: r.label, amount: r.amount, createdAt: r.created_at }));
  }

  private parseAdj(body: unknown, partial: boolean): Partial<Pick<GoalAdjustment, 'day' | 'label' | 'amount'>> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new GoalInputError('body must be a JSON object');
    const b = body as Record<string, unknown>;
    const out: Partial<Pick<GoalAdjustment, 'day' | 'label' | 'amount'>> = {};
    if (b.day !== undefined || !partial) { if (!isDay(b.day)) throw new GoalInputError('day must be YYYY-MM-DD'); out.day = b.day; }
    if (b.label !== undefined || !partial) {
      if (typeof b.label !== 'string' || !b.label.trim()) throw new GoalInputError('label is required (e.g. "Federal EV credit")');
      out.label = b.label.trim().slice(0, 80);
    }
    if (b.amount !== undefined || !partial) {
      const a = typeof b.amount === 'string' ? Number(b.amount) : b.amount;
      if (typeof a !== 'number' || !Number.isFinite(a) || a === 0 || Math.abs(a) > 1_000_000) throw new GoalInputError('amount must be a non-zero number of dollars (negative counts against the goal)');
      out.amount = Math.round(a * 100) / 100;
    }
    return out;
  }

  addAdjustment(body: unknown, now = new Date()): GoalAdjustment {
    const a = this.parseAdj(body, false) as Pick<GoalAdjustment, 'day' | 'label' | 'amount'>;
    const id = Number(this.db.prepare('INSERT INTO goal_adjustments (day, label, amount, created_at) VALUES (?, ?, ?, ?)').run(a.day, a.label, a.amount, now.toISOString()).lastInsertRowid);
    return this.adjustments().find((x) => x.id === id)!;
  }

  updateAdjustment(id: number, body: unknown): GoalAdjustment | null {
    if (!this.adjustments().some((x) => x.id === id)) return null;
    const p = this.parseAdj(body, true);
    const keys = Object.keys(p) as (keyof typeof p)[];
    if (keys.length) this.db.prepare(`UPDATE goal_adjustments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => p[k] as string | number), id);
    return this.adjustments().find((x) => x.id === id) ?? null;
  }

  deleteAdjustment(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM goal_adjustments WHERE id = ?').run(id).changes) > 0;
  }
}

