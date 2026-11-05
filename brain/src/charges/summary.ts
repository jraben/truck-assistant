// Charging cost summary per month or year. Pure.
import type { ChargeSession, ChargeSummary, Settings, Trip } from '../types.ts';
import { round2 } from './pricing.ts';

export type Period = 'month' | 'year';

/** "2027-05" or "2027", in the Pi's local time. */
export function periodKey(iso: string, period: Period): string {
  const d = new Date(iso);
  const y = String(d.getFullYear());
  return period === 'year' ? y : `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * One row per period that has sessions or trips, oldest first.
 * - cost sums every session with a known cost (a free session counts as $0).
 * - kwh sums every session with known kWh.
 * - costPerKwh uses only sessions where both are known, so a receipt with no
 *   kWh doesn't inflate the rate.
 * - miles come from trips started in the period; costPerMile = cost / miles.
 * - gasEquivalent = miles / compareMpg x gasPrice.
 */
export function summarize(sessions: ChargeSession[], trips: Pick<Trip, 'startedAt' | 'miles'>[], period: Period, s: Pick<Settings, 'compareMpg' | 'gasPrice'>): ChargeSummary[] {
  const rows = new Map<string, { sessions: number; kwh: number; cost: number; home: number; pub: number; pairCost: number; pairKwh: number; miles: number }>();
  const row = (k: string) => {
    let r = rows.get(k);
    if (!r) { r = { sessions: 0, kwh: 0, cost: 0, home: 0, pub: 0, pairCost: 0, pairKwh: 0, miles: 0 }; rows.set(k, r); }
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
  for (const t of trips) if (t.miles > 0) row(periodKey(t.startedAt, period)).miles += t.miles;

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
    gasEquivalent: r.miles > 0 && s.compareMpg > 0 ? round2((r.miles / s.compareMpg) * s.gasPrice) : null,
  }));
}
