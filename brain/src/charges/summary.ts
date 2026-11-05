// Charging cost summary per month or year. Pure.
import type { ChargeSession, ChargeSummary, CompareVehicle } from '../types.ts';
import { round2 } from './pricing.ts';

export type Period = 'month' | 'year';

/** "2027-05" or "2027", in the Pi's local time. */
export function periodKey(iso: string, period: Period): string {
  const d = new Date(iso);
  const y = String(d.getFullYear());
  return period === 'year' ? y : `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2027-05-14", local. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A trip as the summary sees it. cityMiles/highwayMiles are optional until trips carry that split. */
export type SummaryTrip = { startedAt: string; miles: number; cityMiles?: number | null; highwayMiles?: number | null };

/**
 * Gallons the compare vehicle would have burned on one trip: city miles at city
 * mpg, highway miles at highway mpg, anything left over (or a trip with no
 * split) at combined mpg.
 */
export function tripGallons(t: SummaryTrip, v: Pick<CompareVehicle, 'mpgCity' | 'mpgHighway' | 'mpgCombined'>): number {
  const miles = Math.max(0, t.miles);
  const city = Math.max(0, t.cityMiles ?? 0), hwy = Math.max(0, t.highwayMiles ?? 0);
  if (t.cityMiles == null && t.highwayMiles == null) return miles / v.mpgCombined;
  const split = city + hwy;
  const scale = split > miles && split > 0 ? miles / split : 1; // a split that overshoots the total is scaled down to it
  const rest = Math.max(0, miles - split * scale);
  return (city * scale) / v.mpgCity + (hwy * scale) / v.mpgHighway + rest / v.mpgCombined;
}

export type GasContext = {
  vehicle: CompareVehicle;
  /** USD/gal for that local day ("2027-05-14") and the vehicle's fuel grade. */
  priceFor: (day: string) => number;
};

/**
 * One row per period that has sessions or trips, oldest first.
 * - cost sums every session with a known cost (a free session counts as $0).
 * - kwh sums every session with known kWh.
 * - costPerKwh uses only sessions where both are known, so a receipt with no
 *   kWh doesn't inflate the rate.
 * - miles come from trips started in the period; costPerMile = cost / miles.
 * - gasEquivalent = per trip, gallons (tripGallons) x that trip-day's price.
 */
export function summarize(sessions: ChargeSession[], trips: SummaryTrip[], period: Period, gas: GasContext): ChargeSummary[] {
  const rows = new Map<string, { sessions: number; kwh: number; cost: number; home: number; pub: number; pairCost: number; pairKwh: number; miles: number; gas: number }>();
  const row = (k: string) => {
    let r = rows.get(k);
    if (!r) { r = { sessions: 0, kwh: 0, cost: 0, home: 0, pub: 0, pairCost: 0, pairKwh: 0, miles: 0, gas: 0 }; rows.set(k, r); }
    return r;
  };
  for (const c of sessions) {
    const r = row(periodKey(c.startedAt, period));
    r.sessions++;
    if (c.kwh !== null) r.kwh += c.kwh;
    if (c.cost !== null) {
      r.cost += c.cost;
      if (c.place === 'home') r.home += c.cost; else r.pub += c.cost;
      if (c.kwh !== null && c.kwh > 0) { r.pairCost += c.cost; r.pairKwh += c.kwh; }
    }
  }
  for (const t of trips) {
    if (!(t.miles > 0)) continue;
    const r = row(periodKey(t.startedAt, period));
    r.miles += t.miles;
    r.gas += tripGallons(t, gas.vehicle) * gas.priceFor(dayOf(t.startedAt));
  }

  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => ({
    period: k,
    sessions: r.sessions,
    kwh: round2(r.kwh),
    cost: round2(r.cost),
    homeCost: round2(r.home),
    publicCost: round2(r.pub),
    costPerKwh: r.pairKwh > 0 ? Math.round((r.pairCost / r.pairKwh) * 1000) / 1000 : null,
    miles: Math.round(r.miles * 10) / 10,
    costPerMile: r.miles > 0 ? Math.round((r.cost / r.miles) * 1000) / 1000 : null,
    gasEquivalent: r.miles > 0 ? round2(r.gas) : null,
    gasVehicle: gas.vehicle.label,
  }));
}
