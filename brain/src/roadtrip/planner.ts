// The road-trip planner. Pure: a route, the chargers along it, the truck's
// charging curve and the driver's preferences in; the fastest set of stops out,
// each with how much to charge, when to leave, and a backup.
//
// How: every charger near the route is a node. At each one the truck may leave
// at any charge level on a 5% grid (up to MAX_CHARGE). A forward pass over the
// chargers, in route order, keeps the quickest way to leave each charger at
// each level; minutes are driving + detour + charging (from the curve, so
// short stops in the fast part of the curve win) + a fixed stop overhead + a
// small penalty for a poorly scored or slow site. Arrival at every stop and at
// the destination must stay at or above the driver's minimum.
import type { Charger, ChargerAvailability } from '../types.ts';
import { minutesToCharge, type Curve } from './curve.ts';
import { climb, type Route } from './route.ts';
import type { PlannedWaypoint, TripWaypoint } from './types.ts';

export const GRID = 5;
/** A stop adds at least this many points: pulling off for a 1-minute top-up is never worth it. */
export const MIN_ADD = 10;
/** Past 90% the curve is slow enough that a planned stop never goes there. */
export const MAX_CHARGE = 90;
/** Pull off, find a free stall, plug in, start the session, get back on the road. */
export const STOP_OVERHEAD_MIN = 10;
/** Average speed on a detour to a charger and back. */
const DETOUR_MPH = 30;
/** Typical US DC fast-charging price when a site lists none and you've never paid there (an estimate, labelled as one). */
export const TYPICAL_DC_PER_KWH = 0.48;
/** Energy lost between the stall and the pack: you pay for this much more than the pack gains. */
const CHARGE_LOSS = 1.08;
/** kg, loaded: Slate's ~3,600 lb curb weight plus people and gear. */
export const TRUCK_MASS_KG = 1900;
/** Share of a descent's energy the truck gets back through regen. */
const REGEN = 0.6;
/** Drivetrain efficiency on a climb. */
const CLIMB_EFF = 0.9;

export type Candidate = {
  charger: Charger;
  /** Miles along the route where it is reached, and how far off the route it is (one way). */
  routeMi: number;
  offMi: number;
  /** Seen / expected kW at this site in past sessions (1 = as fast as the curve says). */
  perfRatio: number;
};

export type PlanInput = {
  route: Route;
  /** Where on the route the truck is now, and its charge level. */
  startMi: number;
  startSoc: number;
  packKwh: number;
  /** Highway efficiency (mi/kWh) at about 60 mph. */
  effMiPerKwh: number;
  /** Outside temperature (°F) for the heat/cold penalty; null = none. */
  tempF: number | null;
  curve: Curve;
  candidates: Candidate[];
  arriveMinSoc: number;
  /** Arrive at the destination with at least this. */
  destMinSoc: number;
  /** Charger ids not to use (full, broken, or just switched away from). */
  avoid?: ReadonlySet<string>;
  now: number;
  maxCharge?: number;
  /** Plan only to this mile (a stop along the way); default the end of the route. */
  endMi?: number;
  /** The leg starts at a stop along the way: a charger right beside it (within 2 miles back) can be used. */
  fromStop?: boolean;
};

/** Where this leg ends on the route. */
export const endOf = (i: Pick<PlanInput, 'route' | 'endMi'>) => Math.min(i.endMi ?? i.route.miles, i.route.miles);

export type Backup = { id: string; name: string; network: string | null; lat: number; lon: number; maxKw: number | null; routeMi: number; extraMin: number; availability: ChargerAvailability | null };

export type PlanStop = {
  id: string; name: string; network: string | null; lat: number; lon: number; maxKw: number | null;
  connectors: string[]; amenities: string[]; price: string | null;
  score: number; reasons: string[]; availability: ChargerAvailability | null;
  routeMi: number; offMi: number;
  arriveSoc: number; departSoc: number; chargeMin: number;
  arriveAt: string; departAt: string;
  /** Average kW expected over the charge. */
  avgKw: number;
  perfRatio: number;
  /** kWh bought at this stop (pack gain plus charging losses), its price and where the price came from. */
  kwhBought: number;
  pricePerKwh: number;
  priceSource: 'paid' | 'listed' | 'typical';
  cost: number;
  backup: Backup | null;
};

export type PlanResult = {
  feasible: boolean;
  /** Why not, or a note about the plan ("No stops needed"). */
  note: string | null;
  stops: PlanStop[];
  arriveSoc: number;
  arriveAt: string;
  totalMin: number;
  driveMin: number;
  chargeMin: number;
  /** kWh the whole remaining route takes, all-in. */
  kwh: number;
  /** Estimated charging cost for every stop, and how many stops used the typical price (no listed or paid price). */
  chargeCost: number;
  typicalPriceStops: number;
};

const round = (n: number, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Energy model for this route and weather. Exposed for the service and tests. */
export function energyModel(inp: Pick<PlanInput, 'route' | 'packKwh' | 'effMiPerKwh' | 'tempF'>) {
  const { route } = inp;
  const avgMph = route.minutes > 0 ? route.miles / (route.minutes / 60) : 60;
  // Air drag grows with speed: efficiency measured around 60 mph drops at 75.
  const speedK = clamp((60 / Math.max(avgMph, 25)) ** 0.8, 0.7, 1.15);
  // A/C in Phoenix heat, cabin and pack heat in the cold.
  const t = inp.tempF;
  const tempK = t === null ? 1 : t >= 105 ? 0.88 : t >= 95 ? 0.92 : t <= 32 ? 0.8 : t <= 45 ? 0.88 : 1;
  const eff = inp.effMiPerKwh * speedK * tempK;
  const kwhPerM = (TRUCK_MASS_KG * 9.81) / 3.6e6;
  const kwh = (fromMi: number, toMi: number) => {
    if (!(toMi > fromMi)) return 0;
    const flat = (toMi - fromMi) / eff;
    const { up, down } = route.elevation ? climb(route, fromMi, toMi) : { up: 0, down: 0 };
    return Math.max(flat * 0.3, flat + (up * kwhPerM) / CLIMB_EFF - down * kwhPerM * REGEN);
  };
  const pct = (fromMi: number, toMi: number) => (kwh(fromMi, toMi) / inp.packKwh) * 100;
  const detourPct = (offMi: number) => ((offMi / (inp.effMiPerKwh * tempK)) / inp.packKwh) * 100;
  const driveMin = (fromMi: number, toMi: number) => route.miles > 0 ? Math.max(0, toMi - fromMi) * (route.minutes / route.miles) : 0;
  return { eff, speedK, tempK, kwh, pct, detourPct, driveMin };
}

/** Minutes of penalty for choosing this site: poor score, slow last time, nothing free. */
export function sitePenalty(c: Candidate): number {
  let p = Math.max(0, 70 - c.charger.score) * 0.25;
  if (c.perfRatio < 1) p += (1 - c.perfRatio) * 20;
  const av = c.charger.availability;
  if (av && av.total > 0 && av.available === 0) p += 25;
  else if (av && av.total > 0 && av.total <= 2) p += 4;          // one broken stall and the stop is gone
  return p;
}

type Node = { c: Candidate | null; mi: number; offMi: number };
type Label = { cost: number; prev: { node: number; level: number } | null; arrive: number; depart: number; chargeMin: number };

/**
 * The plan. `from` is the starting state; levels at chargers are on the grid.
 * Returns the best path or null when no chain of chargers reaches the end.
 */
function search(inp: PlanInput, em: ReturnType<typeof energyModel>, startMi: number, startSoc: number, avoid: ReadonlySet<string>): { path: { c: Candidate; arrive: number; depart: number; chargeMin: number }[]; arrive: number; cost: number; reach: number } | null {
  const max = inp.maxCharge ?? MAX_CHARGE;
  const levels: number[] = [];
  for (let l = GRID * 2; l <= max; l += GRID) levels.push(l);
  const cands = inp.candidates
    .filter((c) => c.routeMi > startMi + (inp.fromStop && startMi === inp.startMi ? -2 : 0.5) && c.routeMi < endOf(inp) && !avoid.has(c.charger.id))
    .sort((a, b) => a.routeMi - b.routeMi);
  const nodes: Node[] = [{ c: null, mi: startMi, offMi: 0 }, ...cands.map((c) => ({ c, mi: c.routeMi, offMi: c.offMi }))];
  // labels[node][levelIndex]; the start has one level (its own charge).
  const labels: (Label | null)[][] = nodes.map((_, i) => (i === 0 ? [{ cost: 0, prev: null, arrive: startSoc, depart: startSoc, chargeMin: 0 }] : levels.map(() => null)));
  const levelOf = (i: number, k: number) => (i === 0 ? startSoc : levels[k]);
  let reach = startMi;
  let best: { cost: number; node: number; level: number; arrive: number } | null = null;

  for (let i = 0; i < nodes.length; i++) {
    const from = nodes[i];
    for (let k = 0; k < labels[i].length; k++) {
      const lab = labels[i][k];
      if (!lab) continue;
      const depart = levelOf(i, k);
      const exitPct = em.detourPct(from.offMi);
      // To the destination.
      const destArrive = depart - exitPct - em.pct(from.mi, endOf(inp));
      reach = Math.max(reach, from.mi + Math.max(0, (depart - exitPct - inp.arriveMinSoc)) / 100 * inp.packKwh * em.eff);
      if (destArrive >= inp.destMinSoc) {
        const cost = lab.cost + em.driveMin(from.mi, endOf(inp)) + (from.offMi / DETOUR_MPH) * 60;
        if (!best || cost < best.cost) best = { cost, node: i, level: k, arrive: destArrive };
      }
      // To each later charger in reach.
      for (let j = i + 1; j < nodes.length; j++) {
        const to = nodes[j];
        const arrive = depart - exitPct - em.pct(from.mi, to.mi) - em.detourPct(to.offMi);
        if (arrive < inp.arriveMinSoc) { if (em.pct(from.mi, to.mi) > 100) break; continue; }
        const base = lab.cost + em.driveMin(from.mi, to.mi) + ((from.offMi + to.offMi) / DETOUR_MPH) * 60 + STOP_OVERHEAD_MIN + sitePenalty(to.c!);
        for (let m = 0; m < levels.length; m++) {
          const target = levels[m];
          if (target < arrive + MIN_ADD) continue;
          const cm = minutesToCharge(inp.curve, inp.packKwh, arrive, target, to.c!.charger.maxKw, to.c!.perfRatio);
          if (!Number.isFinite(cm)) continue;
          const cost = base + cm;
          const cur = labels[j][m];
          if (!cur || cost < cur.cost) labels[j][m] = { cost, prev: { node: i, level: k }, arrive, depart: target, chargeMin: cm };
        }
      }
    }
  }
  if (!best) return null;
  const path: { c: Candidate; arrive: number; depart: number; chargeMin: number }[] = [];
  let at: { node: number; level: number } | null = { node: best.node, level: best.level };
  while (at && at.node !== 0) {
    const lab: Label = labels[at.node][at.level]!;
    path.unshift({ c: nodes[at.node].c!, arrive: lab.arrive, depart: lab.depart, chargeMin: lab.chargeMin });
    at = lab.prev;
  }
  return { path, arrive: best.arrive, cost: best.cost, reach };
}

export function plan(inp: PlanInput): PlanResult {
  const em = energyModel(inp);
  const avoid = inp.avoid ?? new Set<string>();
  const kwh = em.kwh(inp.startMi, endOf(inp));
  const found = search(inp, em, inp.startMi, inp.startSoc, avoid);
  const t0 = inp.now;
  if (!found) {
    const r = search(inp, em, inp.startMi, inp.startSoc, new Set());   // would it work with every charger allowed?
    const gapNote = (() => {
      const reachable = inp.candidates.filter((c) => !avoid.has(c.charger.id)).map((c) => c.routeMi).sort((a, b) => a - b);
      let prev = inp.startMi;
      for (const m of [...reachable, endOf(inp)]) { if (m - prev > 0 && m > inp.startMi) { if (em.pct(prev, m) > (inp.maxCharge ?? MAX_CHARGE) - inp.arriveMinSoc) return `No charger in reach between mile ${Math.round(prev)} and mile ${Math.round(m)}.`; prev = m; } }
      return 'No set of chargers on this route keeps you above your arrival minimum.';
    })();
    return { feasible: false, note: r && avoid.size ? 'Only possible with a charger that was ruled out (full or skipped).' : gapNote, stops: [], arriveSoc: round(inp.startSoc - em.pct(inp.startMi, endOf(inp))), arriveAt: new Date(t0 + em.driveMin(inp.startMi, endOf(inp)) * 60_000).toISOString(), totalMin: round(em.driveMin(inp.startMi, endOf(inp))), driveMin: round(em.driveMin(inp.startMi, endOf(inp))), chargeMin: 0, kwh: round(kwh, 1), chargeCost: 0, typicalPriceStops: 0 };
  }

  // Walk the path for times, then find each stop's backup.
  const stops: PlanStop[] = [];
  let clock = t0, mi = inp.startMi, off = 0, driveMin = 0, chargeMin = 0;
  for (const s of found.path) {
    const dm = em.driveMin(mi, s.c.routeMi) + ((off + s.c.offMi) / DETOUR_MPH) * 60;
    driveMin += dm; clock += (dm + STOP_OVERHEAD_MIN / 2) * 60_000;
    const arriveAt = new Date(clock).toISOString();
    clock += (s.chargeMin + STOP_OVERHEAD_MIN / 2) * 60_000; chargeMin += s.chargeMin;
    const ch = s.c.charger;
    stops.push({
      id: ch.id, name: ch.name, network: ch.network, lat: ch.lat, lon: ch.lon, maxKw: ch.maxKw,
      connectors: ch.connectors, amenities: ch.amenities, price: ch.price, score: ch.score, reasons: ch.reasons,
      availability: ch.availability ?? null, routeMi: round(s.c.routeMi, 1), offMi: round(s.c.offMi, 1),
      arriveSoc: round(s.arrive), departSoc: round(s.depart), chargeMin: round(s.chargeMin),
      arriveAt, departAt: new Date(clock).toISOString(),
      avgKw: s.chargeMin > 0 ? round(((s.depart - s.arrive) / 100) * inp.packKwh / (s.chargeMin / 60)) : 0,
      perfRatio: s.c.perfRatio,
      ...priceStop(ch, ((s.depart - s.arrive) / 100) * inp.packKwh * CHARGE_LOSS),
      backup: null,
    });
    mi = s.c.routeMi; off = s.c.offMi;
  }
  driveMin += em.driveMin(mi, endOf(inp)) + (off / DETOUR_MPH) * 60;
  const arriveAt = new Date(clock + (em.driveMin(mi, endOf(inp)) + (off / DETOUR_MPH) * 60) * 60_000).toISOString();

  // Backups: from the state before each stop, the best plan that skips it; its first stop is the backup.
  for (let k = 0; k < stops.length; k++) {
    const prev = k === 0 ? { mi: inp.startMi, soc: inp.startSoc } : { mi: stops[k - 1].routeMi, soc: stops[k - 1].departSoc };
    const alt = search(inp, em, prev.mi, prev.soc, new Set([...avoid, stops[k].id]));
    const first = alt?.path[0];
    if (!alt || !first) continue;
    const mainRest = found.cost - costUpTo(found, k, em, inp);
    stops[k].backup = {
      id: first.c.charger.id, name: first.c.charger.name, network: first.c.charger.network, lat: first.c.charger.lat, lon: first.c.charger.lon,
      maxKw: first.c.charger.maxKw, routeMi: round(first.c.routeMi, 1), availability: first.c.charger.availability ?? null,
      extraMin: Math.max(0, round(alt.cost - mainRest)),
    };
  }

  const totalMin = (Date.parse(arriveAt) - t0) / 60_000;
  return {
    feasible: true, note: stops.length ? null : 'No charging stop needed.',
    stops, arriveSoc: round(found.arrive), arriveAt,
    totalMin: round(totalMin), driveMin: round(driveMin), chargeMin: round(chargeMin), kwh: round(kwh, 1),
    chargeCost: round(stops.reduce((a, s) => a + s.cost, 0), 2), typicalPriceStops: stops.filter((s) => s.priceSource === 'typical').length,
  };
}

/** The main plan's cost spent before reaching stop k (so a backup's cost compares like with like). */
function costUpTo(found: NonNullable<ReturnType<typeof search>>, k: number, em: ReturnType<typeof energyModel>, inp: PlanInput): number {
  let c = 0, mi = inp.startMi, off = 0;
  for (let i = 0; i < k; i++) {
    const s = found.path[i];
    c += em.driveMin(mi, s.c.routeMi) + ((off + s.c.offMi) / DETOUR_MPH) * 60 + STOP_OVERHEAD_MIN + sitePenalty(s.c) + s.chargeMin;
    mi = s.c.routeMi; off = s.c.offMi;
  }
  return c;
}

/** "$0.56/kWh", "0.48 per kWh": a per-kWh price in a site's price text. Per-minute and session fees aren't guessed. */
export function listedPerKwh(price: string | null): number | null {
  const m = price?.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*kwh/i);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 && v < 3 ? v : null;
}

/** What a stop costs: what you paid there before, else the listed price, else the typical one. */
export function priceStop(ch: Charger, kwhBought: number): Pick<PlanStop, 'kwhBought' | 'pricePerKwh' | 'priceSource' | 'cost'> {
  const paid = ch.lastPaid?.perKwh ?? null;
  const listed = listedPerKwh(ch.price);
  const [pricePerKwh, priceSource] = paid !== null ? [paid, 'paid' as const] : listed !== null ? [listed, 'listed' as const] : [TYPICAL_DC_PER_KWH, 'typical' as const];
  return { kwhBought: round(kwhBought, 1), pricePerKwh, priceSource, cost: round(kwhBought * pricePerKwh, 2) };
}

/** Most a stay charges the pack to (kind to the battery overnight). */
export const STAY_CHARGE_MAX = 90;
/** A wall charger delivers about this share of its rating into the pack. */
const STAY_CHARGE_EFF = 0.9;

/**
 * The whole trip through stops along the way: each leg (to the next stop, then
 * to the destination) planned on its own; at each stop the truck waits its
 * stay and, where there's charging, gains what that charger gives in that time.
 */
export function planLegs(inp: PlanInput, via: (TripWaypoint & { routeMi: number })[]): { result: PlanResult; via: PlannedWaypoint[] } {
  const ahead = via.filter((w) => w.routeMi > inp.startMi + 0.1).sort((a, b) => a.routeMi - b.routeMi);
  const t0 = inp.now;
  let mi = inp.startMi, soc = inp.startSoc, now = inp.now;
  const stops: PlanStop[] = [], planned: PlannedWaypoint[] = [];
  let driveMin = 0, chargeMin = 0, kwh = 0, cost = 0, typical = 0;
  const legs = [...ahead.map((w) => ({ w, end: w.routeMi })), { w: null as (TripWaypoint & { routeMi: number }) | null, end: inp.endMi ?? inp.route.miles }];
  for (const { w, end } of legs) {
    const r = plan({ ...inp, startMi: mi, startSoc: soc, endMi: end, now, destMinSoc: w ? inp.arriveMinSoc : inp.destMinSoc, fromStop: planned.length > 0 });
    if (!r.feasible) {
      return { result: { ...r, note: `${w ? `On the way to ${w.name}: ` : planned.length ? 'On the last leg: ' : ''}${r.note ?? 'not reachable'}`, stops: [...stops, ...r.stops] }, via: planned };
    }
    stops.push(...r.stops);
    driveMin += r.driveMin; chargeMin += r.chargeMin; kwh += r.kwh; cost += r.chargeCost; typical += r.typicalPriceStops;
    if (!w) {
      const totalMin = (Date.parse(r.arriveAt) - t0) / 60_000;
      return {
        result: { feasible: true, note: stops.length ? null : r.note, stops, arriveSoc: r.arriveSoc, arriveAt: r.arriveAt, totalMin: Math.round(totalMin), driveMin: Math.round(driveMin), chargeMin: Math.round(chargeMin), kwh: Math.round(kwh * 10) / 10, chargeCost: Math.round(cost * 100) / 100, typicalPriceStops: typical },
        via: planned,
      };
    }
    const gain = w.chargeKw ? ((w.chargeKw * STAY_CHARGE_EFF * (w.stayMin / 60)) / inp.packKwh) * 100 : 0;
    const depart = Math.max(r.arriveSoc, Math.min(STAY_CHARGE_MAX, r.arriveSoc + gain));
    const departAt = new Date(Date.parse(r.arriveAt) + w.stayMin * 60_000).toISOString();
    planned.push({ ...w, arriveAt: r.arriveAt, departAt, arriveSoc: Math.round(r.arriveSoc), departSoc: Math.round(depart) });
    mi = end; soc = depart; now = Date.parse(departAt);
  }
  throw new Error('unreachable');
}
