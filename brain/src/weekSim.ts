// "Simulate my week": a driver's real phone location history (Home Assistant:
// Life360, the companion app) replayed as if driven in the Slate. Per local day:
// miles (straight lines between fixes, scaled to roads), city/highway split,
// kWh, the charge level through the day with a top-up at home every night,
// what that charging costs at the home rate, and what the same miles would
// have cost in gas in the comparison car. Read only: nothing is saved.
//
// Phone history can be sparse (Home Assistant often keeps a fix only when the
// place changes), so each day says how much there was to go on.
import { CHARGE_EFFICIENCY, priceHomeSession } from './charges/pricing.ts';
import { tripGallons } from './charges/summary.ts';
import { segment } from './stops/segment.ts';
import type { TrackerPoint } from './ha/client.ts';
import type { CompareVehicle, Settings } from './types.ts';

/** Straight lines between sparse fixes cut corners; roads are about this much longer. */
export const ROAD_FACTOR = 1.25;
/** A day with fewer fixes than this, or a gap this long while moving, is called thin. */
const THIN_POINTS = 12;
const THIN_GAP_H = 6;

export type SimParams = {
  packKwh: number;
  eff: { city: number; highway: number };   // mi/kWh
  highwayMph: number;
  startSoc: number;                         // % at the start of the first day
  chargeTo: number;                         // % the overnight home charge fills to
  homeRate: Settings['homeRate'];
  compare: Pick<CompareVehicle, 'label' | 'mpgCity' | 'mpgHighway' | 'mpgCombined'>;
  gasPrice: number | null;                  // $/gal
};

export type SimTrip = { startedAt: string; endedAt: string; miles: number; mode: 'city' | 'highway' };
export type SimDay = {
  day: string;                              // local YYYY-MM-DD
  trips: SimTrip[];
  miles: number; cityMiles: number; highwayMiles: number;
  kwh: number;
  socStart: number; socLow: number; socEnd: number;
  /** Would the battery have run out before getting home? */
  ranOut: boolean;
  chargeKwh: number; chargeCost: number | null;
  gallons: number; gasCost: number | null;
  points: number; maxGapH: number | null; coverage: 'good' | 'thin' | 'none';
};
export type WeekSim = {
  from: string; to: string; tracker: string;
  params: SimParams & { roadFactor: number };
  days: SimDay[];
  totals: { miles: number; kwh: number; chargeKwh: number; chargeCost: number | null; gallons: number; gasCost: number | null; saved: number | null; lowestSoc: number; ranOutDays: number; thinDays: number };
  notes: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Simulate local days [from, to) over the tracker's points. Pure (the clock is the points'). */
export function simulateWeek(points: TrackerPoint[], days: [Date, Date][], p: SimParams, tracker: string): WeekSim {
  const pts = [...points].sort((a, b) => a.t - b.t);
  const end = days.length ? days[days.length - 1][1].getTime() : 0;
  const seg = segment(pts.map((x) => ({ t: x.t, lat: x.lat, lon: x.lon, speedMph: x.speedMph })), end);
  let soc = p.startSoc;
  const out: SimDay[] = [];
  for (const [a, b] of days) {
    const lo = a.getTime(), hi = b.getTime();
    const inDay = pts.filter((x) => x.t >= lo && x.t < hi);
    let maxGap: number | null = null;
    for (let i = 1; i < inDay.length; i++) maxGap = Math.max(maxGap ?? 0, (inDay[i].t - inDay[i - 1].t) / 3_600_000);
    const trips: SimTrip[] = [];
    let city = 0, hwy = 0, kwh = 0;
    const socStart = soc;
    let socLow = soc;
    for (const t of seg.trips) {
      if (t.startedAt < lo || t.startedAt >= hi) continue;
      const miles = t.miles * ROAD_FACTOR;
      const hours = Math.max((t.endedAt - t.startedAt) / 3_600_000, 1 / 60);
      const mode: 'city' | 'highway' = miles / hours >= p.highwayMph ? 'highway' : 'city';
      const used = miles / (mode === 'highway' ? p.eff.highway : p.eff.city);
      if (mode === 'highway') hwy += miles; else city += miles;
      kwh += used;
      soc -= (used / p.packKwh) * 100;
      socLow = Math.min(socLow, soc);
      trips.push({ startedAt: new Date(t.startedAt).toISOString(), endedAt: new Date(t.endedAt).toISOString(), miles: r1(miles), mode });
    }
    const socEnd = soc;
    // Overnight at home: back up to the charge target (a run-out day is assumed rescued by a charge on the road).
    const from = Math.max(soc, 0);
    const chargeKwh = from < p.chargeTo ? ((p.chargeTo - from) / 100) * p.packKwh / CHARGE_EFFICIENCY : 0;
    const night = new Date(lo); night.setHours(22, 0, 0, 0);
    const chargeCost = chargeKwh > 0 ? priceHomeSession(chargeKwh, night, p.homeRate) : 0;
    soc = Math.max(soc, p.chargeTo);
    const miles = city + hwy;
    const gallons = miles > 0 ? tripGallons({ startedAt: new Date(lo).toISOString(), miles, cityMiles: city, highwayMiles: hwy }, p.compare) : 0;
    const coverage: SimDay['coverage'] = inDay.length === 0 ? 'none' : inDay.length < THIN_POINTS || (maxGap !== null && maxGap > THIN_GAP_H && trips.length > 0) ? 'thin' : 'good';
    out.push({
      day: dayKey(lo), trips, miles: r1(miles), cityMiles: r1(city), highwayMiles: r1(hwy), kwh: r1(kwh),
      socStart: r1(socStart), socLow: r1(socLow), socEnd: r1(socEnd), ranOut: socLow < 0,
      chargeKwh: r1(chargeKwh), chargeCost: chargeCost === null ? null : r2(chargeCost),
      gallons: r2(gallons), gasCost: p.gasPrice === null ? null : r2(gallons * p.gasPrice),
      points: inDay.length, maxGapH: maxGap === null ? null : r1(maxGap), coverage,
    });
  }
  const sum = (f: (d: SimDay) => number) => out.reduce((s, d) => s + f(d), 0);
  const costKnown = out.every((d) => d.chargeCost !== null);
  const chargeCost = costKnown ? r2(sum((d) => d.chargeCost ?? 0)) : null;
  const gasCost = p.gasPrice === null ? null : r2(sum((d) => d.gasCost ?? 0));
  const notes: string[] = [`Miles are straight lines between location fixes × ${ROAD_FACTOR} for roads: an estimate, low where fixes are sparse.`];
  if (!costKnown) notes.push('No home electricity rate set (Settings, Charging): charging cost unknown.');
  if (p.gasPrice === null) notes.push('No gas price: gas cost unknown.');
  const thin = out.filter((d) => d.coverage !== 'good').length;
  if (thin) notes.push(`${thin} of ${out.length} days have thin or no location history, so trips there are likely missing.`);
  return {
    from: days.length ? days[0][0].toISOString() : '', to: days.length ? days[days.length - 1][1].toISOString() : '', tracker,
    params: { ...p, roadFactor: ROAD_FACTOR },
    days: out,
    totals: {
      miles: r1(sum((d) => d.miles)), kwh: r1(sum((d) => d.kwh)), chargeKwh: r1(sum((d) => d.chargeKwh)), chargeCost,
      gallons: r2(sum((d) => d.gallons)), gasCost, saved: chargeCost !== null && gasCost !== null ? r2(gasCost - chargeCost) : null,
      lowestSoc: r1(Math.min(p.startSoc, ...out.map((d) => d.socLow))), ranOutDays: out.filter((d) => d.ranOut).length, thinDays: thin,
    },
    notes,
  };
}
