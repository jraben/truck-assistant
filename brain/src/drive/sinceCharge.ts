// "Since last charge" (docs/drive-v2.md §3). Pure.
import type { ChargeSession } from '../types.ts';
import type { SinceCharge } from './types.ts';

export type SinceTrip = { startedAt: string; endedAt: string | null; miles: number; cityMiles: number | null; highwayMiles: number | null };

/** The charge that counts: the most recently ended session. */
export function lastEndedCharge(sessions: ChargeSession[]): ChargeSession | null {
  let best: ChargeSession | null = null;
  for (const s of sessions) if (s.endedAt && (!best || Date.parse(s.endedAt) > Date.parse(best.endedAt!))) best = s;
  return best;
}

/**
 * Miles, kWh, mi/kWh, % used and cost per mile since `charge` ended.
 * - miles: truck trips that started at or after the charge ended.
 * - kWh: from the SoC drop when the SoC now is a real reading (CAN) and the
 *   charge's end SoC is known, and the result is believable (1-8 mi/kWh);
 *   else city miles / city mi/kWh + highway miles / highway mi/kWh (+ unsplit at city).
 * - % used: the SoC drop, or kWh as a share of the pack when estimated.
 * - cost per mile: what the charge cost per kWh x kWh used / miles; null without both cost and kWh.
 */
export function sinceCharge(charge: ChargeSession, trips: SinceTrip[], now: { soc: number | null; socReal: boolean; packKwh: number; eff: { city: number; highway: number } }): SinceCharge {
  const since = charge.endedAt!;
  const t0 = Date.parse(since);
  let miles = 0, city = 0, hwy = 0, rest = 0;
  for (const t of trips) {
    if (Date.parse(t.startedAt) < t0 || !(t.miles > 0)) continue;
    miles += t.miles;
    const c = t.cityMiles ?? 0, h = t.highwayMiles ?? 0;
    city += c; hwy += h; rest += Math.max(0, t.miles - c - h);
  }
  const est = (city + rest) / now.eff.city + hwy / now.eff.highway;
  let kwh = est, kwhSource: SinceCharge['kwhSource'] = 'miles';
  let pctUsed: number | null = now.packKwh > 0 ? (est / now.packKwh) * 100 : null;
  if (now.socReal && charge.endSoc !== null && now.soc !== null) {
    const drop = Math.max(0, charge.endSoc - now.soc);
    const k = (drop / 100) * now.packKwh;
    if (miles === 0 ? drop === 0 : k > 0 && miles / k >= 1 && miles / k <= 8) { kwh = k; kwhSource = 'soc'; pctUsed = drop; }
  }
  const perKwh = charge.cost !== null && charge.kwh !== null && charge.kwh > 0 ? charge.cost / charge.kwh : null;
  return {
    since, sessionId: charge.id,
    miles: Math.round(miles * 10) / 10,
    kwh: Math.round(kwh * 10) / 10,
    kwhSource,
    miPerKwh: kwh > 0 && miles > 0 ? Math.round((miles / kwh) * 100) / 100 : null,
    pctUsed: pctUsed === null ? null : Math.round(pctUsed * 10) / 10,
    costPerMile: perKwh !== null && miles > 0 ? Math.round(((perKwh * kwh) / miles) * 1000) / 1000 : null,
  };
}
