// Road trips: plan (route + chargers along it + the planner), then follow the
// active trip: where the truck is on the route, a live stall check before each
// stop with an automatic switch to the backup when it's full, a replan when the
// charge level falls behind the plan, and the charging coach at each stop.
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import { metersBetween } from '../geo.ts';
import type { FinderSettings, ChargerFinder } from '../chargers/finder.ts';
import { scoreCharger, type Station } from '../chargers/score.ts';
import type { ChargerAvailability } from '../types.ts';
import { coach, type Coach } from './coach.ts';
import { planLegs, energyModel, type Candidate, type PlanResult, type PlanStop } from './planner.ts';
import { addElevation, fetchRouteVia, locate, samplePoints, type LatLon, type Route } from './route.ts';
import { rateKw, type SampleStore } from './samples.ts';
import type { Destination, PlannedWaypoint, RoadTripBrief, RoadTripView, TripAlert, TripPlan, TripPreset, TripProgress, TripWaypoint } from './types.ts';
export type { RoadTripBrief, RoadTripView, TripAlert, TripPlan, TripProgress } from './types.ts';

/** Search for chargers around a route point every this many miles. */
const SAMPLE_EVERY_MI = 25;
/** A charger farther than this off the route is not a candidate (one way). */
const MAX_OFF_ROUTE_MI = 12;
/** Check the next stop's stalls when it is this close (minutes away). */
export const LIVE_CHECK_MIN = 25;
const LIVE_EVERY_MS = 5 * 60_000;
/** Replan when the projected arrival at the next stop falls this far below plan. */
const BEHIND_PTS = 4;
const REPLAN_EVERY_MS = 5 * 60_000;
/** At a stop when within this distance of it. */
const AT_STOP_M = 400;
/** Within this of the route counts as on it. */
const ON_ROUTE_MI = 3;
/** Farther ahead than this from the last point driven is a jump, not progress (a tick covers well under a mile). */
const JUMP_MI = 25;

export type RoadTripDeps = {
  db: Db;
  finder: ChargerFinder;
  samples: SampleStore;
  settings: () => FinderSettings;
  soc: () => number | null;
  gps: () => LatLon | null;
  speedMph: () => number | null;
  charging: () => boolean;
  tempF: () => number | null;
  highwayEff: () => number;
  /** The charge session open right now, if any (for the coach's live rate). */
  sessionId: () => number | null;
  /** SIM: how much faster than real time charging runs (1 on a real truck). Rates are divided by it. */
  timeScale?: () => number;
  /** Places to offer as a destination (saved places; the demo's towns). */
  destinations?: () => Destination[];
  /** The gas vehicle to compare with (highway mpg) and today's price per gallon, if known. */
  gasCompare?: () => { label: string; mpg: number; pricePerGallon: number } | null;
  /** Ready-made trips (from, to, starting charge), e.g. the demo's factory pickup. */
  presets?: () => TripPreset[];
  router?: string;
  fetchFn?: typeof fetch;
};

type Active = { plan: TripPlan; route: Route; candidates: Candidate[]; avoid: string[]; startedAt: string; done: string[]; lastLive: number; lastReplan: number; startMi?: number; maxMi?: number };

/** At most this many stops along the way (each is its own router call). */
export const MAX_VIA = 8;

export type PlanRequest = { to: LatLon & { name?: string }; from?: (LatLon & { name?: string }) | null; startSoc?: number | null; via?: TripWaypoint[] };

export class PlanError extends Error {}

const strip = (reasons: string[]) => reasons.filter((r) => !/reach not checked|^Arrive ~|mi away/.test(r));

export class RoadTripService {
  private d: RoadTripDeps;
  private draft: { plan: TripPlan; route: Route; candidates: Candidate[] } | null = null;
  private active: Active | null;
  private alerts: TripAlert[] = [];
  private alertSeq = 0;
  private lastSample: { soc: number; at: number } | null = null;
  private listeners: (() => void)[] = [];
  private planning: Promise<TripPlan> | null = null;

  constructor(d: RoadTripDeps) {
    this.d = d;
    this.active = kvGet<Active>(d.db, 'roadtrip.active');
  }

  onChange(f: () => void) { this.listeners.push(f); }
  private changed() { if (this.active) kvSet(this.d.db, 'roadtrip.active', this.active); for (const l of this.listeners) { try { l(); } catch (e) { console.error('[roadtrip] listener', e); } } }

  private alert(kind: TripAlert['kind'], message: string) {
    const a = { id: ++this.alertSeq, at: new Date().toISOString(), kind, message };
    this.alerts = [a, ...this.alerts].slice(0, 10);
    console.log(`[roadtrip] ${message}`);
  }

  // ---- planning -------------------------------------------------------------

  async planTrip(req: PlanRequest): Promise<TripPlan> {
    if (this.planning) throw new PlanError('Already planning a trip; one moment.');
    this.planning = this.doPlan(req).finally(() => { this.planning = null; });
    return this.planning;
  }

  private async doPlan(req: PlanRequest): Promise<TripPlan> {
    const from = req.from ?? this.d.gps();
    if (!from) throw new PlanError('No GPS fix yet: pick where the trip starts.');
    const startSoc = req.startSoc ?? this.d.soc();
    if (startSoc === null || startSoc === undefined) throw new PlanError('Charge level unknown: set it on the Charge screen first.');
    const s = this.d.settings();
    const warnings: string[] = [];
    const via = (req.via ?? []).slice(0, MAX_VIA);
    const { route: joined, legEnds } = await fetchRouteVia([from, ...via, req.to], { router: this.d.router, fetchFn: this.d.fetchFn });
    const route = await addElevation(joined, this.d.fetchFn);
    const stopsAt = via.map((w, i) => ({ ...w, routeMi: legEnds[i] }));
    if (route.source === 'straight') warnings.push('No road route (router unreachable): distances are a straight line plus 25%.');
    if (!route.elevation) warnings.push('No elevation data: climbs are not counted.');

    // Chargers near the route, one search per sample point, merged by id.
    const radius = Math.max(15, Math.round(SAMPLE_EVERY_MI * 0.75));
    const seen = new Map<string, Station>();
    let errors = 0, lastErr: string | null = null;
    for (const p of samplePoints(route, SAMPLE_EVERY_MI)) {
      const r = await this.d.finder.stationsAround(p.lat, p.lon, radius, s);
      if (r.error) { errors++; lastErr = r.error; }
      for (const st of r.stations) if (!seen.has(st.id)) seen.set(st.id, st);
    }
    if (errors) warnings.push(`Some charger searches failed (${lastErr}).`);
    const candidates = this.candidates([...seen.values()], route, s);
    if (!candidates.length) warnings.push('No fast chargers found near this route.');

    const { result, via: planned } = this.runPlan(route, candidates, 0, startSoc, new Set(), stopsAt);
    const plan: TripPlan = {
      id: `${Date.now().toString(36)}`, createdAt: new Date().toISOString(),
      from: { lat: from.lat, lon: from.lon, name: (req.from as { name?: string } | undefined)?.name ?? null },
      to: { lat: req.to.lat, lon: req.to.lon, name: req.to.name || 'Destination' },
      startSoc: Math.round(startSoc), routeMiles: Math.round(route.miles), routeMinutes: Math.round(route.minutes), routeSource: route.source, elevation: route.elevation,
      candidates: candidates.length, warnings, via: planned, result, gas: this.gasFor(route.miles),
    };
    this.draft = { plan, route, candidates };
    this.changed();
    return plan;
  }

  private gasFor(miles: number): TripPlan['gas'] {
    const g = this.d.gasCompare?.();
    if (!g || !(g.mpg > 0) || !(g.pricePerGallon > 0)) return null;
    const gallons = miles / g.mpg;
    return { label: g.label, mpg: g.mpg, pricePerGallon: g.pricePerGallon, gallons: Math.round(gallons * 10) / 10, cost: Math.round(gallons * g.pricePerGallon * 100) / 100 };
  }

  /** Fast chargers within reach of the route, scored by the driver's preferences (detour as the distance). */
  candidates(stations: Station[], route: Route, s: FinderSettings): Candidate[] {
    const out: Candidate[] = [];
    for (const st of stations) {
      if (st.level2Only || (st.maxKw !== null && st.maxKw < Math.max(40, s.charging.minKw))) continue;
      const at = locate(route, st);
      if (at.offMi > Math.min(MAX_OFF_ROUTE_MI, Math.max(2, s.charging.maxDetourMi))) continue;
      const scored = scoreCharger(st, { distanceMi: at.offMi, soc: null, settings: s });
      out.push({ charger: { ...scored, reasons: strip(scored.reasons) }, routeMi: at.mi, offMi: at.offMi * 1.3, perfRatio: st.performance && st.performance.samples >= 3 ? Math.min(1, st.performance.ratio) : 1 });
    }
    return out;
  }

  /** Plan leg by leg through the stops still ahead (charging done while staying at one counts). */
  private runPlan(route: Route, candidates: Candidate[], startMi: number, startSoc: number, avoid: Set<string>, via: (TripWaypoint & { routeMi: number })[]): { result: PlanResult; via: PlannedWaypoint[] } {
    const s = this.d.settings();
    return planLegs({
      route, startMi, startSoc, packKwh: s.packKwh, effMiPerKwh: this.d.highwayEff() || s.efficiencyMiPerKwh, tempF: this.d.tempF(),
      curve: this.d.samples.curve(), candidates, arriveMinSoc: s.charging.arriveMinSoc, destMinSoc: s.charging.arriveMinSoc,
      avoid, now: Date.now(),
    }, via);
  }

  start(planId: string): TripPlan {
    if (!this.draft || this.draft.plan.id !== planId) throw new PlanError('That plan is gone; plan the trip again.');
    if (!this.draft.plan.result.feasible) throw new PlanError(this.draft.plan.result.note ?? 'This plan does not reach the destination.');
    const gps = this.d.gps();
    const at = gps ? locate(this.draft.route, gps) : null;
    // Started near the beginning of the route (planned from here): progress counts from there. Anywhere else, from the start.
    const startMi = at && at.offMi <= ON_ROUTE_MI && at.mi <= JUMP_MI ? at.mi : 0;
    this.active = { ...this.draft, avoid: [], startedAt: new Date().toISOString(), done: [], lastLive: 0, lastReplan: Date.now(), startMi, maxMi: startMi };
    this.draft = null;
    this.alerts = [];
    this.alert('info', `Trip to ${this.active.plan.to.name} started: ${this.active.plan.result.stops.length} charging stop${this.active.plan.result.stops.length === 1 ? '' : 's'}.`);
    this.changed();
    return this.active.plan;
  }

  stop() {
    this.active = null;
    kvSet(this.d.db, 'roadtrip.active', null);
    this.alerts = [];
    this.changed();
  }

  discardDraft() { this.draft = null; this.changed(); }

  /** Replan from where the truck is now, keeping avoided chargers out. */
  replan(reason: string | null = null): TripPlan | null {
    const a = this.active;
    if (!a) return null;
    const soc = this.d.soc();
    const gps = this.d.gps();
    if (soc === null) return a.plan;
    const at = gps ? locate(a.route, gps) : null;
    const mi = at && at.offMi <= ON_ROUTE_MI ? at.mi : (a.maxMi ?? 0);
    // Stops already reached keep their times; the rest are planned again.
    const done = (a.plan.via ?? []).filter((w) => w.routeMi <= mi + 0.2);
    const { result, via } = this.runPlan(a.route, a.candidates, mi, soc, new Set(a.avoid), (a.plan.via ?? []).filter((w) => w.routeMi > mi + 0.2));
    a.plan = { ...a.plan, result, via: [...done, ...via], startSoc: Math.round(soc) };
    a.lastReplan = Date.now();
    if (reason) this.alert('replanned', reason);
    this.changed();
    return a.plan;
  }

  // ---- following the active trip -----------------------------------------------

  progress(): TripProgress | null {
    const a = this.active;
    if (!a) return null;
    const gps = this.d.gps();
    const here = gps ? locate(a.route, gps) : { mi: 0, offMi: 0 };
    const stops = a.plan.result.stops;
    const atIdx = gps ? stops.findIndex((s) => metersBetween(gps, s) <= AT_STOP_M) : -1;
    // On the route AND reachable by driving from where it was last seen on it: a truck parked at the destination (or anywhere ahead) before driving there has not "progressed".
    const offRoute = here.offMi > ON_ROUTE_MI || here.mi > (a.maxMi ?? 0) + JUMP_MI;
    const next = atIdx >= 0 ? atIdx : stops.findIndex((s) => (offRoute || s.routeMi > here.mi - 0.5) && !a.done.includes(s.id));
    let nextArriveSoc: number | null = null;
    const soc = this.d.soc();
    if (next >= 0 && atIdx < 0 && soc !== null && !offRoute) {
      const s = this.d.settings();
      const em = energyModel({ route: a.route, packKwh: s.packKwh, effMiPerKwh: this.d.highwayEff() || s.efficiencyMiPerKwh, tempF: this.d.tempF() });
      nextArriveSoc = Math.round(soc - em.pct(here.mi, stops[next].routeMi) - em.detourPct(stops[next].offMi));
    }
    return { routeMi: Math.round(here.mi * 10) / 10, milesLeft: Math.round(Math.max(0, a.route.miles - (offRoute ? a.maxMi ?? 0 : here.mi))), offRouteMi: Math.round(here.offMi * 10) / 10, onRoute: !offRoute, nextStop: next >= 0 ? next : null, atStop: atIdx >= 0, nextArriveSoc };
  }

  /** Every 30 s from the brain: samples while charging, stop arrivals and departures, the live check, falling behind. */
  async tick(now = Date.now()) {
    this.recordSample(now);
    const a = this.active;
    if (!a) return;
    const p = this.progress();
    if (!p) return;
    const stops = a.plan.result.stops;
    const moving = (this.d.speedMph() ?? 0) > 5;
    // Only a truck on the route counts as progress: one parked elsewhere (or a
    // trip planned from another city) never "passes" stops or "arrives".
    const onRoute = p.onRoute;
    if (onRoute && moving && p.routeMi > (a.maxMi ?? 0)) a.maxMi = p.routeMi;
    const driven = (a.maxMi ?? 0) - (a.startMi ?? p.routeMi);
    // Left a stop: mark it done.
    for (const s of stops) {
      const gps = this.d.gps();
      if (onRoute && !a.done.includes(s.id) && gps && moving && s.routeMi < p.routeMi - 1 && metersBetween(gps, s) > 1500) { a.done.push(s.id); this.changed(); }
    }
    // Arrived: on the route, near the end, stopped, after driving a real part of it.
    if (onRoute && p.milesLeft < 0.5 && !moving && driven > Math.min(20, a.route.miles * 0.5)) { this.alert('info', `Arrived at ${a.plan.to.name}.`); this.stop(); return; }
    if (!onRoute) return;
    if (p.nextStop === null || p.atStop) return;
    const next = stops[p.nextStop];
    // Falling behind the plan (headwind, heat, a lead foot): replan before it matters.
    if (p.nextArriveSoc !== null && p.nextArriveSoc < next.arriveSoc - BEHIND_PTS && now - a.lastReplan > REPLAN_EVERY_MS) {
      this.replan(`Using more than planned: you'd reach ${next.name} at ${p.nextArriveSoc}% instead of ${next.arriveSoc}%. Plan updated.`);
      return;
    }
    // Live stall check before arriving.
    const minsAway = (Date.parse(next.arriveAt) - now) / 60_000;
    const etaMin = Number.isFinite(minsAway) ? minsAway : Infinity;
    const close = etaMin <= LIVE_CHECK_MIN || (next.routeMi - p.routeMi) <= LIVE_CHECK_MIN * 1.1;
    if (close && now - a.lastLive > LIVE_EVERY_MS) {
      a.lastLive = now;
      await this.liveCheck(a, next);
    }
  }

  private async liveCheck(a: Active, next: PlanStop) {
    const s = this.d.settings();
    const live = await this.d.finder.liveAround(next.lat, next.lon, s);
    const near = live.filter((x) => metersBetween(x, next) <= 250 && x.availability).map((x) => x.availability!) as ChargerAvailability[];
    if (!near.length) return;   // no live data: nothing to act on
    const av = near.reduce((acc, x) => ({ available: acc.available + x.available, total: acc.total + x.total, outOfService: acc.outOfService + x.outOfService, updatedAt: x.updatedAt ?? acc.updatedAt }), { available: 0, total: 0, outOfService: 0, updatedAt: null } as ChargerAvailability);
    next.availability = av;
    const c = a.candidates.find((x) => x.charger.id === next.id);
    if (c) c.charger = { ...c.charger, availability: av };
    if (av.total > 0 && av.available === 0) {
      a.avoid.push(next.id);
      const before = a.plan.result;
      const plan = this.replan(null);
      const first = plan?.result.stops[0];
      if (plan?.result.feasible && first) {
        const extra = Math.max(0, Math.round(plan.result.totalMin - minutesLeft(before)));
        this.alert('switched', `${next.name} is full (0 of ${av.total}). Going to ${first.name} instead${extra ? `, +${extra} min` : ''}.`);
      } else {
        a.avoid.pop();
        this.replan(null);
        this.alert('full', `${next.name} is full (0 of ${av.total}) and no other charger is in reach. Expect a wait.`);
      }
    } else this.changed();
  }

  /** While charging: a rate sample each time the charge level rises. */
  private recordSample(now: number) {
    const soc = this.d.soc();
    if (!this.d.charging() || soc === null) { this.lastSample = null; return; }
    const last = this.lastSample;
    if (!last || soc < last.soc) { this.lastSample = { soc, at: now }; return; }
    if (soc - last.soc < 1) return;
    const s = this.d.settings();
    const raw = rateKw(last.soc, soc, (now - last.at) * (this.d.timeScale?.() ?? 1), s.packKwh);
    const kw = raw;
    this.lastSample = { soc, at: now };
    if (kw === null) return;
    const gps = this.d.gps();
    const st = gps ? this.d.finder.nearestKnown(gps.lat, gps.lon) : null;
    this.d.samples.add({ at: new Date(now).toISOString(), socFrom: last.soc, socTo: soc, kw, stationKw: st?.maxKw ?? null, lat: gps?.lat ?? null, lon: gps?.lon ?? null, sessionId: this.d.sessionId() });
  }

  /** The coach, while charging: against the planned stop when there is a trip, else just the live rate. */
  coach(now = Date.now()): Coach | null {
    if (!this.d.charging()) return null;
    const s = this.d.settings();
    const sid = this.d.sessionId();
    const samples = sid === null ? [] : this.d.samples.forSession(sid);
    const a = this.active;
    const gps = this.d.gps();
    let stop: PlanStop | null = null, nextName: string | null = null;
    if (a) {
      const stops = a.plan.result.stops;
      const i = gps ? stops.findIndex((x) => metersBetween(gps, x) <= AT_STOP_M) : -1;
      const k = i >= 0 ? i : stops.findIndex((x) => !a.done.includes(x.id));
      if (k >= 0) { stop = stops[k]; nextName = stops[k + 1]?.name ?? a.plan.to.name; }
    }
    const st = gps ? this.d.finder.nearestKnown(gps.lat, gps.lon) : null;
    return coach({
      soc: this.d.soc(), samples, stationKw: stop?.maxKw ?? st?.maxKw ?? null, curve: this.d.samples.curve(), packKwh: s.packKwh,
      effMiPerKwh: this.d.highwayEff() || s.efficiencyMiPerKwh, targetSoc: stop?.departSoc ?? null,
      next: stop && nextName ? { name: nextName, needSoc: stop.departSoc } : null, now,
    });
  }

  /** The active trip's route and where the truck is on it (for traffic ahead), or null. */
  routeNow(): { route: Route; mi: number } | null {
    const a = this.active;
    const p = this.progress();
    return a && p?.onRoute ? { route: a.route, mi: p.routeMi } : null;
  }

  view(): RoadTripView {
    const curve = this.d.samples.curve();
    return {
      draft: this.draft?.plan ?? null,
      active: this.active?.plan ?? null,
      progress: this.progress(),
      coach: this.coach(),
      alerts: this.alerts,
      destinations: (this.d.destinations?.() ?? []).slice(0, 30),
      presets: this.d.presets?.() ?? [],
      curve: { learnedBins: curve.learnedBins, samples: curve.points.reduce((n, p) => n + p.samples, 0), points: curve.points },
    };
  }

  brief(): RoadTripBrief {
    const a = this.active;
    const c = this.coach();
    if (!a) return null;
    const p = this.progress();
    const st = p?.nextStop !== null && p?.nextStop !== undefined ? a.plan.result.stops[p.nextStop] : null;
    const recent = this.alerts[0] && Date.now() - Date.parse(this.alerts[0].at) < 10 * 60_000 && this.alerts[0].kind !== 'info' ? this.alerts[0] : null;
    return { to: a.plan.to.name, nextStop: st ? { name: st.name, arriveSoc: st.arriveSoc, departSoc: st.departSoc, arriveAt: st.arriveAt } : null, alert: recent, coach: c ? { state: c.state, message: c.message } : null };
  }
}

/** Minutes left on a plan result from now (its arrival time). */
function minutesLeft(r: PlanResult): number { return Math.max(0, (Date.parse(r.arriveAt) - Date.now()) / 60_000); }
