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
  /** $/kWh at public DC fast chargers (the driver's paid average), null = unknown. */
  dcPerKwh?: number | null;
};

/** On the road, a fast charge when the level would drop below this, back up to FAST_TO. */
export const FAST_RESERVE = 10;
export const FAST_TO = 80;
const DC_EFFICIENCY = 0.92;

// Time spent fuelling, for both sides of the comparison.
/** Average DC power over a stop: Slate quotes 20-80% in about 30 minutes, ~63 kW on a 52.7 kWh pack. */
export const FAST_AVG_KW = 63;
/** Per fast-charge stop on top of charging: pull in, find the stall, plug in, unplug. */
export const FAST_STOP_MIN = 5;
/** Per night charged at home: plug in and unplug. The charging itself is overnight, not the driver's time. */
export const HOME_PLUG_MIN = 1;
/** Home (Level 2) charging into the pack: Slate quotes about 7 hours for a full charge, ~7.5 kW. */
export const HOME_AC_KW = 7.5;
/** Per gas fill-up: pull in, pay, pump (about 3 min at ~10 gal/min), go. */
export const GAS_FILL_MIN = 8;
/** A gas car is filled when the tank is down to this share. */
export const GAS_FILL_AT = 0.25;
/** Tank size when it isn't known: about 380 miles on a tank at the combined mpg, 10-40 gal. */
export const tankEstimate = (mpgCombined: number) => Math.round(Math.min(40, Math.max(10, 380 / mpgCombined)) * 10) / 10;

export type SimTrip = { startedAt: string; endedAt: string; miles: number; mode: 'city' | 'highway' };
export type SimDay = {
  day: string;                              // local YYYY-MM-DD
  trips: SimTrip[];
  miles: number; cityMiles: number; highwayMiles: number;
  kwh: number;
  socStart: number; socLow: number; socEnd: number;
  /** Would the battery have run out without a charge on the road? (Then fastStops > 0.) */
  ranOut: boolean;
  fastStops: number; fastKwh: number; fastCost: number | null;
  /** Minutes at fast chargers (charging plus FAST_STOP_MIN a stop), and plugging in at home. */
  fastMinutes: number; homeMinutes: number;
  /** Hours plugged in at home overnight: shown apart, it isn't the driver's time. */
  homeChargeHours: number;
  chargeKwh: number; chargeCost: number | null;
  gallons: number; gasCost: number | null;
  points: number; maxGapH: number | null; coverage: 'good' | 'thin' | 'none' | 'stored';
};
export type WeekSim = {
  from: string; to: string; tracker: string;
  params: SimParams & { roadFactor: number };
  days: SimDay[];
  totals: { miles: number; kwh: number; chargeKwh: number; chargeCost: number | null; fastStops: number; fastKwh: number; fastCost: number | null; fastMinutes: number; homeMinutes: number; chargeMinutes: number; homeChargeHours: number; gallons: number; gasCost: number | null; saved: number | null; lowestSoc: number; ranOutDays: number; thinDays: number };
  notes: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** A drive to simulate: times, and miles already on roads. */
export type DriveIn = { startedAt: number; endedAt: number; miles: number };
/** A stored phone trip: `straight` = imported from Home Assistant fixes (straight lines), else a Google Timeline drive (road miles). */
export type StoredDrive = DriveIn & { straight: boolean };
type Coverage = (lo: number, hi: number) => { points: number; maxGapH: number | null; coverage: SimDay['coverage'] };

/** The simulation itself, over drives: local days [from, to), the charge level carried day to day. Pure. */
export function simulateDrives(drives: DriveIn[], days: [Date, Date][], p: SimParams, source: string, cover: Coverage, notes: string[]): WeekSim {
  let soc = p.startSoc;
  const out: SimDay[] = [];
  for (const [a, b] of days) {
    const lo = a.getTime(), hi = b.getTime();
    const trips: SimTrip[] = [];
    let city = 0, hwy = 0, kwh = 0, fastStops = 0, fastKwh = 0, fastMinutes = 0;
    const socStart = soc;
    let socLow = soc;
    for (const t of drives) {
      if (t.startedAt < lo || t.startedAt >= hi) continue;
      const hours = Math.max((t.endedAt - t.startedAt) / 3_600_000, 1 / 60);
      const mode: 'city' | 'highway' = t.miles / hours >= p.highwayMph ? 'highway' : 'city';
      const used = t.miles / (mode === 'highway' ? p.eff.highway : p.eff.city);
      if (mode === 'highway') hwy += t.miles; else city += t.miles;
      kwh += used;
      // Drive it, stopping at a DC fast charger whenever the level would go below the reserve.
      let need = (used / p.packKwh) * 100;
      while (soc - need < FAST_RESERVE && fastStops < 20) {
        const drove = Math.max(0, soc - FAST_RESERVE);
        need -= drove; soc -= drove;
        socLow = Math.min(socLow, soc);
        fastKwh += ((FAST_TO - soc) / 100) * p.packKwh / DC_EFFICIENCY;
        fastMinutes += (((FAST_TO - soc) / 100) * p.packKwh / FAST_AVG_KW) * 60 + FAST_STOP_MIN;
        fastStops++;
        soc = FAST_TO;
      }
      soc -= need;
      socLow = Math.min(socLow, soc);
      trips.push({ startedAt: new Date(t.startedAt).toISOString(), endedAt: new Date(t.endedAt).toISOString(), miles: r1(t.miles), mode });
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
    const c = cover(lo, hi);
    const fastCost = fastKwh === 0 ? 0 : p.dcPerKwh == null ? null : r2(fastKwh * p.dcPerKwh);
    out.push({
      day: dayKey(lo), trips, miles: r1(miles), cityMiles: r1(city), highwayMiles: r1(hwy), kwh: r1(kwh),
      socStart: r1(socStart), socLow: r1(socLow), socEnd: r1(socEnd), ranOut: fastStops > 0,
      fastStops, fastKwh: r1(fastKwh), fastCost,
      fastMinutes: Math.round(fastMinutes), homeMinutes: chargeKwh > 0 ? HOME_PLUG_MIN : 0,
      homeChargeHours: r1((chargeKwh * CHARGE_EFFICIENCY) / HOME_AC_KW),
      chargeKwh: r1(chargeKwh), chargeCost: chargeCost === null ? null : r2(chargeCost),
      gallons: r2(gallons), gasCost: p.gasPrice === null ? null : r2(gallons * p.gasPrice),
      points: c.points, maxGapH: c.maxGapH, coverage: c.coverage,
    });
  }
  const sum = (f: (d: SimDay) => number) => out.reduce((s, d) => s + f(d), 0);
  const costKnown = out.every((d) => d.chargeCost !== null);
  const chargeCost = costKnown ? r2(sum((d) => d.chargeCost ?? 0)) : null;
  const gasCost = p.gasPrice === null ? null : r2(sum((d) => d.gasCost ?? 0));
  const fastKnown = out.every((d) => d.fastCost !== null);
  const fastCost = fastKnown ? r2(sum((d) => d.fastCost ?? 0)) : null;
  const all = [...notes];
  const stops = sum((d) => d.fastStops);
  if (stops) all.push(`${stops} fast-charge stop${stops === 1 ? '' : 's'} on the road (below ${FAST_RESERVE}%, back to ${FAST_TO}%)${fastKnown ? ` at $${(p.dcPerKwh ?? 0).toFixed(2)}/kWh` : ': no public charging price yet (log a paid fast charge, or add ?dcPerKwh=), so their cost is unknown'}.`);
  if (!costKnown) all.push('No home electricity rate set (Settings, Charging): charging cost unknown.');
  if (p.gasPrice === null) all.push('No gas price: gas cost unknown.');
  const thin = out.filter((d) => d.coverage === 'thin' || d.coverage === 'none').length;
  if (thin) all.push(`${thin} of ${out.length} days have thin or no location history, so trips there are likely missing.`);
  return {
    from: days.length ? days[0][0].toISOString() : '', to: days.length ? days[days.length - 1][1].toISOString() : '', tracker: source,
    params: { ...p, roadFactor: ROAD_FACTOR },
    days: out,
    totals: {
      miles: r1(sum((d) => d.miles)), kwh: r1(sum((d) => d.kwh)), chargeKwh: r1(sum((d) => d.chargeKwh)), chargeCost,
      fastStops: stops, fastKwh: r1(sum((d) => d.fastKwh)), fastCost,
      fastMinutes: sum((d) => d.fastMinutes), homeMinutes: sum((d) => d.homeMinutes), chargeMinutes: sum((d) => d.fastMinutes + d.homeMinutes), homeChargeHours: r1(sum((d) => d.homeChargeHours)),
      gallons: r2(sum((d) => d.gallons)), gasCost, saved: chargeCost !== null && fastCost !== null && gasCost !== null ? r2(gasCost - chargeCost - fastCost) : null,
      lowestSoc: r1(Math.min(p.startSoc, ...out.map((d) => d.socLow))), ranOutDays: out.filter((d) => d.ranOut).length, thinDays: thin,
    },
    notes: all,
  };
}

/** From Home Assistant: the tracker's raw fixes, split into trips here. Pure (the clock is the points'). */
export function simulateWeek(points: TrackerPoint[], days: [Date, Date][], p: SimParams, tracker: string): WeekSim {
  const pts = [...points].sort((a, b) => a.t - b.t);
  const end = days.length ? days[days.length - 1][1].getTime() : 0;
  const seg = segment(pts.map((x) => ({ t: x.t, lat: x.lat, lon: x.lon, speedMph: x.speedMph })), end);
  const drives = seg.trips.map((t) => ({ startedAt: t.startedAt, endedAt: t.endedAt, miles: t.miles * ROAD_FACTOR }));
  const cover: Coverage = (lo, hi) => {
    const inDay = pts.filter((x) => x.t >= lo && x.t < hi);
    let maxGap: number | null = null;
    for (let i = 1; i < inDay.length; i++) maxGap = Math.max(maxGap ?? 0, (inDay[i].t - inDay[i - 1].t) / 3_600_000);
    const moved = drives.some((d) => d.startedAt >= lo && d.startedAt < hi);
    const coverage: SimDay['coverage'] = inDay.length === 0 ? 'none' : inDay.length < THIN_POINTS || (maxGap !== null && maxGap > THIN_GAP_H && moved) ? 'thin' : 'good';
    return { points: inDay.length, maxGapH: maxGap === null ? null : r1(maxGap), coverage };
  };
  return simulateDrives(drives, days, p, tracker, cover, [`Miles are straight lines between location fixes × ${ROAD_FACTOR} for roads: an estimate, low where fixes are sparse.`]);
}

/** From TA's stored phone trips (a Google Timeline import, or Home Assistant imports): their miles as stored. */
export function simulateStored(trips: StoredDrive[], days: [Date, Date][], p: SimParams, label: string): WeekSim {
  // The days need not be consecutive (a "top days" week), so count only trips inside one of them.
  const inRange = trips.filter((t) => days.some(([a, b]) => t.startedAt >= a.getTime() && t.startedAt < b.getTime()));
  const straight = inRange.filter((t) => t.straight).length, timeline = inRange.length - straight;
  const notes: string[] = [];
  if (timeline) notes.push(`${timeline} drive${timeline === 1 ? '' : 's'} from Google Timeline, at Google's distances.`);
  if (straight) notes.push(`${straight} trip${straight === 1 ? '' : 's'} imported from Home Assistant: straight lines between location fixes × ${ROAD_FACTOR} for roads, an estimate.`);
  if (!inRange.length) notes.push('No stored phone trips in these days.');
  const drives = trips.map((t) => ({ startedAt: t.startedAt, endedAt: t.endedAt, miles: t.straight ? t.miles * ROAD_FACTOR : t.miles }));
  return simulateDrives(drives, days, p, label, () => ({ points: 0, maxGapH: null, coverage: 'stored' }), notes);
}

/** Stored trips' road miles, for the busiest-week search: Home Assistant imports scaled like the simulation. */
export const roadMiles = (t: StoredDrive) => (t.straight ? t.miles * ROAD_FACTOR : t.miles);

/** What a "top days" week ranks by: all miles, highway miles, or around-town miles. */
export type TopBy = 'miles' | 'highway' | 'city';
/** A drive is highway when its average speed reaches this (the same split the simulation makes). */
export const isHighway = (t: DriveIn, highwayMph: number) => t.miles / Math.max((t.endedAt - t.startedAt) / 3_600_000, 1 / 60) >= highwayMph;

/**
 * The n separate local days with the most miles (or most highway, or most
 * around-town miles) between from and to, in date order: a made-up week of
 * those days, to stress the battery or show the everyday case. Pure.
 */
export function topDays(trips: DriveIn[], from: Date, to: Date, n = 7, by: TopBy = 'miles', highwayMph = 45): { by: TopBy; days: { day: string; miles: number; cityMiles: number; highwayMiles: number; trips: number }[]; miles: number } | null {
  const days = new Map<string, { city: number; hwy: number; trips: number }>();
  const lo = from.getTime(), hi = to.getTime();
  for (const t of trips) {
    if (t.startedAt < lo || t.startedAt >= hi) continue;
    const k = dayKey(t.startedAt), x = days.get(k) ?? { city: 0, hwy: 0, trips: 0 };
    if (isHighway(t, highwayMph)) x.hwy += t.miles; else x.city += t.miles;
    x.trips++; days.set(k, x);
  }
  const score = (x: { city: number; hwy: number }) => (by === 'highway' ? x.hwy : by === 'city' ? x.city : x.city + x.hwy);
  const top = [...days.entries()].filter(([, x]) => score(x) > 0).sort((a, b) => score(b[1]) - score(a[1])).slice(0, n);
  if (!top.length) return null;
  top.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    by,
    days: top.map(([day, x]) => ({ day, miles: r1(x.city + x.hwy), cityMiles: r1(x.city), highwayMiles: r1(x.hwy), trips: x.trips })),
    miles: r1(top.reduce((s, [, x]) => s + x.city + x.hwy, 0)),
  };
}

/** The 7 consecutive local days with the most miles, between from and to. Pure. */
export function busiestWeek(trips: DriveIn[], from: Date, to: Date, len = 7): { start: string; miles: number; daily: { day: string; miles: number }[] } | null {
  const daily: { day: string; t: number; miles: number }[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) daily.push({ day: dayKey(d.getTime()), t: d.getTime(), miles: 0 });
  if (daily.length < len) return null;
  const at = new Map(daily.map((x, i) => [x.day, i]));
  for (const t of trips) { const i = at.get(dayKey(t.startedAt)); if (i !== undefined) daily[i].miles += t.miles; }
  let best = -1, bestAt = 0, run = 0;
  for (let i = 0; i < daily.length; i++) {
    run += daily[i].miles; if (i >= len) run -= daily[i - len].miles;
    if (i >= len - 1 && run > best) { best = run; bestAt = i - len + 1; }
  }
  if (best <= 0) return null;
  return { start: daily[bestAt].day, miles: r1(best), daily: daily.slice(bestAt, bestAt + len).map((x) => ({ day: x.day, miles: r1(x.miles) })) };
}

// ---- Gas cars side by side ----------------------------------------------------

/** A gas car to compare the simulated week against, at its own fuel grade's price. */
export type GasCar = { vehicle: { label: string; mpgCity: number; mpgHighway: number; mpgCombined: number; fuel: string; tankGal?: number | null }; gasPrice: number | null; priceEstimated?: boolean };
type Leg = { miles: number; gasCost: number | null; slateCost: number | null; saved: number | null; savedPer100: number | null };
export type CarCompare = {
  label: string; fuel: string; gasPrice: number | null; priceEstimated: boolean;
  gallons: number; gasCost: number | null; slateCost: number | null; saved: number | null; savedPct: number | null;
  gasPerMile: number | null; slatePerMile: number | null; savedPer100: number | null;
  /** The gas price at which this car would cost the same as the Slate for this week. */
  breakEvenGas: number | null;
  /** How many times over the Slate's electricity (home and fast) could cost before this car is cheaper. */
  elecMultiple: number | null;
  highway: Leg; town: Leg;
  /** Fill-ups this week (filling at GAS_FILL_AT of a tank; fractional = an average week) and minutes at the pump. */
  tankGal: number; tankEstimated: boolean; fills: number; fillMinutes: number;
  /** Minutes the Slate spends charging (fast stops + plugging in at home) against this car's pump time; + = Slate takes longer. */
  chargeMinutes: number; extraMinutes: number;
};

/**
 * The simulated week against each gas car: its gallons and cost on the same city
 * and highway miles, the Slate's cost (home + fast charging), and the break-even
 * points. The Slate's cost is split highway/town by energy. Pure.
 */
export function compareCars(sim: WeekSim, cars: GasCar[]): CarCompare[] {
  const p = sim.params;
  const city = sim.days.reduce((s, d) => s + d.cityMiles, 0), hwy = sim.days.reduce((s, d) => s + d.highwayMiles, 0);
  const miles = city + hwy;
  const t = sim.totals;
  const slate = t.chargeCost !== null && t.fastCost !== null ? t.chargeCost + t.fastCost : null;
  const kCity = city / p.eff.city, kHwy = hwy / p.eff.highway;
  const share = kCity + kHwy > 0 ? kHwy / (kCity + kHwy) : 0;
  const leg = (mi: number, gal: number, price: number | null, slateCost: number | null): Leg => {
    const gas = price === null ? null : r2(gal * price);
    const saved = gas !== null && slateCost !== null ? r2(gas - slateCost) : null;
    return { miles: r1(mi), gasCost: gas, slateCost: slateCost === null ? null : r2(slateCost), saved, savedPer100: saved !== null && mi > 0 ? r2((saved / mi) * 100) : null };
  };
  return cars.map(({ vehicle: v, gasPrice, priceEstimated }) => {
    const gCity = city / v.mpgCity, gHwy = hwy / v.mpgHighway, gallons = gCity + gHwy;
    const tankGal = v.tankGal && v.tankGal > 0 ? v.tankGal : tankEstimate(v.mpgCombined);
    const fills = gallons / (tankGal * (1 - GAS_FILL_AT));
    const fillMinutes = Math.round(fills * GAS_FILL_MIN);
    const gasCost = gasPrice === null ? null : r2(gallons * gasPrice);
    const saved = gasCost !== null && slate !== null ? r2(gasCost - slate) : null;
    return {
      label: v.label, fuel: v.fuel, gasPrice, priceEstimated: !!priceEstimated,
      gallons: r2(gallons), gasCost, slateCost: slate === null ? null : r2(slate), saved,
      savedPct: saved !== null && gasCost ? Math.round((saved / gasCost) * 100) : null,
      gasPerMile: gasCost !== null && miles > 0 ? Math.round((gasCost / miles) * 1000) / 1000 : null,
      slatePerMile: slate !== null && miles > 0 ? Math.round((slate / miles) * 1000) / 1000 : null,
      savedPer100: saved !== null && miles > 0 ? r2((saved / miles) * 100) : null,
      breakEvenGas: slate !== null && gallons > 0 ? r2(slate / gallons) : null,
      elecMultiple: slate && gasCost !== null ? r2(gasCost / slate) : null,
      highway: leg(hwy, gHwy, gasPrice, slate === null ? null : slate * share),
      town: leg(city, gCity, gasPrice, slate === null ? null : slate * (1 - share)),
      tankGal, tankEstimated: !(v.tankGal && v.tankGal > 0), fills: r1(fills), fillMinutes,
      chargeMinutes: t.chargeMinutes, extraMinutes: t.chargeMinutes - fillMinutes,
    };
  });
}

/** Years until electricity, rising `ratePct` a year, costs `multiple` times today (gas held still). */
export const yearsToMultiple = (multiple: number, ratePct: number) => (multiple <= 1 ? 0 : ratePct <= 0 ? Infinity : Math.log(multiple) / Math.log(1 + ratePct / 100));

