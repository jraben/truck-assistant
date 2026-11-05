// Gas prices from the HACS GasBuddy integration (firstof9/ha-gasbuddy) via
// Home Assistant, one stored price per local day per grade, for the "a gas
// truck would have cost" comparison.
//
// GasBuddy sensors (from the integration's README): one per fuel the station
// sells, named like "Regular Gas", "Regular Gas (Cash)", "Premium Gas", keys
// regular_gas, midgrade_gas, premium_gas, diesel, e85, e15 (UNL88); the state is
// the price; attributes include attribution ("… via GasBuddy"), last_updated
// (when GasBuddy last saw the price), station_id, formatted_price ("$3.45/gallon"
// or "145.9¢/liter"). The station name is its own (disabled by default) sensor,
// so the name comes from station_name if present, else the friendly name minus
// the fuel words. Entity ids depend on what Jeff names the stations, so
// everything here is matched tolerantly.
import type { Db } from '../db.ts';
import { HaClient, NOT_CONFIGURED, type HaState } from '../ha/client.ts';
import type { FuelGrade, GasSensor, GasStatus, Settings } from '../types.ts';

export const POLL_MS = 30 * 60_000;
const L_PER_GAL = 3.785411784;

export type GasReading = { entityId: string; price: number; fuel: FuelGrade; cashOrDeal: boolean; station: string | null; updatedAt: string | null };

const FUEL_RE: [RegExp, FuelGrade | null][] = [
  [/\bdiesel\b/i, 'diesel'],
  [/\bpremium\b/i, 'premium'],
  [/\bmid[-_ ]?grade\b|\bmidgrade\b|\bplus\b/i, 'midgrade'],
  [/\be85\b|\be15\b|\bunl88\b/i, null], // other fuels: not a grade we compare against
  [/\bregular\b|\bunleaded\b/i, 'regular'],
];

/** Which grade a sensor is, from its id and friendly name. Unknown -> regular (the integration's default sensor). Null = another fuel (E85, E15). */
export function fuelOf(entityId: string, name: string): FuelGrade | null {
  const text = `${entityId.replace(/_/g, ' ')} ${name}`;
  for (const [re, f] of FUEL_RE) if (re.test(text)) return f;
  return 'regular';
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** USD per gallon from a GasBuddy state, or null when it isn't a usable price. */
export function priceOf(s: HaState): number | null {
  let p = num(s.state);
  if (!Number.isFinite(p) || p <= 0) return null;
  const unit = String(s.attributes?.unit_of_measurement ?? '');
  const fmt = String(s.attributes?.formatted_price ?? '');
  const cents = /¢|cent|\bc\//i.test(unit) || /¢/.test(fmt) || (!unit && p > 20);
  const perLitre = /\bl\b|\/l|lit(re|er)/i.test(unit) || /lit(re|er)/i.test(fmt);
  if (cents) p /= 100;
  if (perLitre) p *= L_PER_GAL;
  return p > 0.5 && p < 20 ? Math.round(p * 1000) / 1000 : null;
}

export function stationOf(s: HaState): string | null {
  const a = s.attributes ?? {};
  if (typeof a.station_name === 'string' && a.station_name.trim()) return a.station_name.trim();
  const fn = typeof a.friendly_name === 'string' ? a.friendly_name : '';
  const cut = fn.replace(/\s*\b(regular|mid[- ]?grade|premium|diesel|e85|e15|unl88)\b.*$/i, '').trim();
  return cut || null;
}

export function readGas(s: HaState): GasReading | null {
  const price = priceOf(s);
  const name = String(s.attributes?.friendly_name ?? '');
  const fuel = fuelOf(s.entity_id, name);
  if (price === null || fuel === null) return null;
  const upd = s.attributes?.last_updated;
  return {
    entityId: s.entity_id, price, fuel,
    cashOrDeal: /\b(cash|deal)\b/i.test(`${s.entity_id.replace(/_/g, ' ')} ${name}`),
    station: stationOf(s),
    updatedAt: typeof upd === 'string' && Number.isFinite(Date.parse(upd)) ? new Date(upd).toISOString() : s.last_updated ?? null,
  };
}

/** One price per grade from several stations: cheapest (with its station) or the average. Card prices beat cash/deal ones. */
export function pickPrices(readings: GasReading[], pick: 'cheapest' | 'average'): Map<FuelGrade, { price: number; station: string | null; updatedAt: string | null }> {
  const out = new Map<FuelGrade, { price: number; station: string | null; updatedAt: string | null }>();
  const byFuel = new Map<FuelGrade, GasReading[]>();
  for (const r of readings) byFuel.set(r.fuel, [...(byFuel.get(r.fuel) ?? []), r]);
  for (const [fuel, list0] of byFuel) {
    const card = list0.filter((r) => !r.cashOrDeal);
    const list = card.length ? card : list0;
    if (pick === 'average') {
      const avg = list.reduce((a, r) => a + r.price, 0) / list.length;
      out.set(fuel, { price: Math.round(avg * 1000) / 1000, station: list.length === 1 ? list[0].station : `average of ${list.length} stations`, updatedAt: list.map((r) => r.updatedAt).filter(Boolean).sort().pop() ?? null });
    } else {
      const best = [...list].sort((a, b) => a.price - b.price)[0];
      out.set(fuel, { price: best.price, station: best.station, updatedAt: best.updatedAt });
    }
  }
  return out;
}

export const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export type GasDay = { day: string; fuel: string; price: number };

/**
 * The price for one trip-day and grade: that day's stored price, else the
 * nearest stored day of that grade (earlier wins a tie), else the manual price.
 */
export function priceForDay(day: string, fuel: FuelGrade, rows: GasDay[], manual: number): number {
  const same = rows.filter((r) => r.fuel === fuel);
  const exact = same.find((r) => r.day === day);
  if (exact) return exact.price;
  if (!same.length) return manual;
  const t = Date.parse(`${day}T12:00:00`);
  let best = same[0], bestD = Infinity;
  for (const r of same) {
    const d = Math.abs(Date.parse(`${r.day}T12:00:00`) - t);
    if (d < bestD || (d === bestD && r.day < best.day)) { best = r; bestD = d; }
  }
  return best.price;
}

export const isGasBuddy = (s: HaState) => /gas ?buddy/i.test(`${s.entity_id} ${String(s.attributes?.attribution ?? '')}`);

export class GasService {
  private db: Db;
  private ha: HaClient;
  private getSettings: () => Settings;
  lastError: string | null = null;

  constructor(db: Db, ha: HaClient, getSettings: () => Settings) { this.db = db; this.ha = ha; this.getSettings = getSettings; }

  rows(): GasDay[] { return this.db.prepare('SELECT day, fuel, price FROM gas_prices ORDER BY day').all() as GasDay[]; }

  /** price for a trip-day for the given grade, honouring the manual source. */
  priceFor(fuel: FuelGrade): (day: string) => number {
    const g = this.getSettings().gas;
    if (g.source === 'manual') return () => g.manualPrice;
    const rows = this.rows();
    return (day) => priceForDay(day, fuel, rows, g.manualPrice);
  }

  async poll(now = new Date()): Promise<boolean> {
    const g = this.getSettings().gas;
    if (g.source !== 'ha' || !g.haEntities.length || !this.ha.configured()) return false;
    const readings: GasReading[] = [];
    const errors: string[] = [];
    for (const e of g.haEntities) {
      try { const r = readGas(await this.ha.state(e)); if (r) readings.push(r); }
      catch (err) { errors.push(`${e}: ${(err as Error).message}`); }
    }
    this.lastError = !readings.length ? (errors[0] ?? 'No usable prices in those sensors yet') : null;
    const picked = pickPrices(readings, g.pick);
    const day = dayKey(now);
    const up = this.db.prepare('INSERT OR REPLACE INTO gas_prices (day, fuel, price, station, fetched_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [fuel, p] of picked) up.run(day, fuel, p.price, p.station, now.toISOString(), p.updatedAt);
    return picked.size > 0;
  }

  status(fuel: FuelGrade): GasStatus {
    const g = this.getSettings().gas;
    const days = (this.db.prepare('SELECT day, fuel, price, station FROM gas_prices ORDER BY day DESC LIMIT 240').all() as { day: string; fuel: string; price: number; station: string | null }[]);
    const latest = this.db.prepare('SELECT * FROM gas_prices WHERE fuel = ? ORDER BY day DESC LIMIT 1').get(fuel) as { day: string; fuel: string; price: number; station: string | null; fetched_at: string; updated_at: string | null } | undefined;
    let message: string | null = null;
    if (g.source === 'ha') {
      if (!this.ha.configured()) message = NOT_CONFIGURED;
      else if (!g.haEntities.length) message = 'Pick GasBuddy sensors on the settings page ("Find GasBuddy sensors").';
      else if (!latest) message = this.lastError ?? `No ${fuel} price from those sensors yet; the manual price is used.`;
      else if (this.lastError) message = this.lastError;
    }
    return {
      source: g.source, fuel,
      today: latest && g.source === 'ha' ? { price: latest.price, station: latest.station, fuel: latest.fuel, fetchedAt: latest.fetched_at, updatedAt: latest.updated_at } : null,
      manualPrice: g.manualPrice, message,
      days: days.slice(0, 240),
    };
  }

  /** "Find GasBuddy sensors": every HA sensor whose id or attribution mentions GasBuddy. */
  async find(): Promise<{ entities: GasSensor[]; message: string | null }> {
    if (!this.ha.configured()) return { entities: [], message: NOT_CONFIGURED };
    try {
      const all = await this.ha.states();
      const entities = all.filter((s) => s.entity_id.startsWith('sensor.') && isGasBuddy(s)).map((s) => ({
        entityId: s.entity_id, name: String(s.attributes?.friendly_name ?? s.entity_id),
        price: priceOf(s), unit: typeof s.attributes?.unit_of_measurement === 'string' ? s.attributes.unit_of_measurement : null,
        attribution: typeof s.attributes?.attribution === 'string' ? s.attributes.attribution : null,
      }));
      return { entities, message: entities.length ? null : 'No GasBuddy sensors in Home Assistant yet: add a station in the GasBuddy integration first.' };
    } catch (e) { return { entities: [], message: (e as Error).message }; }
  }
}
