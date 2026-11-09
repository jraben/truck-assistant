// Traffic ahead: 511 cameras and events (crashes, closures, roadwork) for the
// states the truck is in or its trip route crosses, plus speed and red-light
// camera locations from OpenStreetMap. Each state's feed is fetched by the
// truck itself with that state's free developer key (settings page), so it
// works anywhere there's a signal; nothing comes from the home network.
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import type { Route } from '../roadtrip/route.ts';
import { samplePoints } from '../roadtrip/route.ts';
import type { Settings } from '../types.ts';
import { ahead, type Ahead } from './ahead.ts';
import { fetchEnforcement, type EnforcementCam } from './enforcement.ts';
import { fetchCameras, fetchEvents, FeedError, type TrafficCamera, type TrafficEvent } from './feed.ts';
import { STATES_511, statesAt, type State511 } from './states.ts';

/** The camera list barely changes: refetch twice a day. */
const CAMERAS_MS = 12 * 3600_000;
/** Events are live: every 5 minutes while driving or on a trip, every 30 parked. */
const EVENTS_MS = 5 * 60_000;
const EVENTS_PARKED_MS = 30 * 60_000;
/** Ten calls a minute per site: keep at least this long between calls to one site. */
const CALL_GAP_MS = 8_000;
/** Enforcement cameras: one Overpass query per ~17-mile cell, kept a week. */
const ENF_CELL = 0.25;
const ENF_MS = 7 * 24 * 3600_000;
const ENF_RADIUS_M = 30_000;

type Feed = { cameras: TrafficCamera[]; camerasAt: number; events: TrafficEvent[]; eventsAt: number; error: string | null; lastCall: number };

import type { TrafficBrief, TrafficView } from './types.ts';
export type { TrafficBrief, TrafficView } from './types.ts';

export type TrafficDeps = {
  db: Db;
  settings: () => Settings;
  gps: () => { lat: number; lon: number } | null;
  heading: () => number | null;
  speedMph: () => number | null;
  online: () => boolean;
  route: () => { route: Route; mi: number } | null;
  fetchFn?: typeof fetch;
};

const iso = (t: number) => (t ? new Date(t).toISOString() : null);

export class TrafficService {
  private d: TrafficDeps;
  private feeds = new Map<string, Feed>();
  private enf = new Map<string, { at: number; cams: EnforcementCam[] }>();
  private enfErr: string | null = null;
  private busy = false;

  constructor(d: TrafficDeps) {
    this.d = d;
    for (const s of STATES_511) {
      const saved = kvGet<{ cameras: TrafficCamera[]; at: number }>(d.db, `traffic.cams.${s.id}`);
      if (saved) this.feeds.set(s.id, { cameras: saved.cameras, camerasAt: saved.at, events: [], eventsAt: 0, error: null, lastCall: 0 });
    }
  }

  private key(s: State511) { return this.d.settings().keys.traffic511?.[s.id] ?? null; }
  private feed(id: string): Feed { let f = this.feeds.get(id); if (!f) { f = { cameras: [], camerasAt: 0, events: [], eventsAt: 0, error: null, lastCall: 0 }; this.feeds.set(id, f); } return f; }

  /** States the truck is in, plus those its trip route crosses ahead. */
  relevantStates(): State511[] {
    const ids = new Set<string>();
    const g = this.d.gps();
    if (g) for (const s of statesAt(g.lat, g.lon)) ids.add(s.id);
    const r = this.d.route();
    if (r) for (const p of samplePoints(r.route, 50)) if (p.mi >= r.mi && p.mi <= r.mi + 250) for (const s of statesAt(p.lat, p.lon)) ids.add(s.id);
    return STATES_511.filter((s) => ids.has(s.id));
  }

  /** Every minute from the brain. One call per site at a time, spaced for its limit. */
  async tick(now = Date.now()) {
    this.cached = null;
    if (this.busy || !this.d.online()) return;
    this.busy = true;
    try {
      const moving = (this.d.speedMph() ?? 0) > 5 || !!this.d.route();
      for (const s of this.relevantStates()) {
        const key = this.key(s);
        if (!key) continue;
        const f = this.feed(s.id);
        if (now - f.lastCall < CALL_GAP_MS) continue;
        const f2 = this.d.fetchFn;
        try {
          if (now - f.camerasAt > CAMERAS_MS) {
            f.lastCall = now;
            f.cameras = await fetchCameras(s, key, f2);
            f.camerasAt = now;
            kvSet(this.d.db, `traffic.cams.${s.id}`, { cameras: f.cameras, at: now });
          } else if (now - f.eventsAt > (moving ? EVENTS_MS : EVENTS_PARKED_MS)) {
            f.lastCall = now;
            f.events = await fetchEvents(s, key, f2);
            f.eventsAt = now;
          }
          f.error = null;
        } catch (e) {
          f.error = e instanceof FeedError ? e.message : (e as Error).message;
          console.warn(`[traffic] ${s.id}: ${f.error}`);
        }
      }
      await this.refreshEnforcement(now);
    } finally { this.busy = false; }
  }

  private cellOf(lat: number, lon: number) { return `${Math.round(lat / ENF_CELL)},${Math.round(lon / ENF_CELL)}`; }

  private async refreshEnforcement(now: number) {
    const g = this.d.gps();
    if (!g) return;
    const cell = this.cellOf(g.lat, g.lon);
    const hit = this.enf.get(cell) ?? kvGet<{ at: number; cams: EnforcementCam[] }>(this.d.db, `traffic.enf.${cell}`);
    if (hit) this.enf.set(cell, hit);
    if (hit && now - hit.at < ENF_MS) return;
    try {
      const cams = await fetchEnforcement(Math.round(g.lat / ENF_CELL) * ENF_CELL, Math.round(g.lon / ENF_CELL) * ENF_CELL, ENF_RADIUS_M, this.d.fetchFn);
      const e = { at: now, cams };
      this.enf.set(cell, e);
      kvSet(this.d.db, `traffic.enf.${cell}`, e);
      this.enfErr = null;
    } catch (e) { this.enfErr = (e as Error).message; if (hit) this.enf.set(cell, { ...hit, at: now - ENF_MS + 3600_000 }); }
  }

  private cached: { at: number; v: TrafficView } | null = null;

  /** The view, at most 5 s old (State asks on every GPS fix; the route pass is not free). */
  view(): TrafficView {
    const now = Date.now();
    if (this.cached && now - this.cached.at < 5000) return this.cached.v;
    const v = this.compute();
    this.cached = { at: now, v };
    return v;
  }

  private compute(): TrafficView {
    const g = this.d.gps();
    const route = this.d.route();
    const heading = (this.d.speedMph() ?? 0) > 5 ? this.d.heading() : null;
    const states = STATES_511.filter((s) => this.relevantStates().some((r) => r.id === s.id) || this.key(s)).map((s) => {
      const f = this.feeds.get(s.id);
      return { id: s.id, name: s.name, keyed: !!this.key(s), checked: s.checked, error: f?.error ?? null, cameras: f?.cameras.length ?? 0, events: f?.events.length ?? 0, camerasAt: iso(f?.camerasAt ?? 0), eventsAt: iso(f?.eventsAt ?? 0) };
    });
    const following = route ? 'route' : heading !== null ? 'heading' : 'nearby';
    if (!g) return { cameras: [], events: [], enforcement: [], states, message: 'No GPS fix yet.', following };
    const here = this.relevantStates();
    const unkeyed = here.filter((s) => !this.key(s));
    const message = !here.length ? 'No 511 feed covers where you are yet (supported: ' + STATES_511.map((s) => s.id.toUpperCase()).join(', ') + ').'
      : unkeyed.length ? `Add a free ${unkeyed.map((s) => s.name).join(', ')} developer key on the settings page to see cameras and incidents here.`
      : !this.d.online() ? 'Offline: showing the last cameras; incidents need a connection.' : null;
    const all = [...this.feeds.values()];
    const base = { here: g, heading, route };
    const cameras = ahead(all.flatMap((f) => f.cameras), { ...base, maxMi: route ? 40 : 25, offMi: 0.6, nearMi: 8 }).slice(0, 8);
    const now = Date.now();
    const live = all.flatMap((f) => f.events).filter((e) => !(e.type === 'roadwork' && e.startsAt && Date.parse(e.startsAt) > now));
    const events = ahead(live, { ...base, maxMi: route ? 80 : 40, offMi: 1, nearMi: 10 }).slice(0, 10);
    const enforcement = ahead([...this.enf.values()].flatMap((e) => e.cams), { ...base, maxMi: 10, offMi: 0.3, nearMi: 3, coneDeg: 20 }).slice(0, 5);
    return { cameras, events, enforcement, states, message, following };
  }

  /** The banner line: a crash or closure close ahead, or a camera coming up while moving. */
  brief(v = this.view()): TrafficBrief {
    const moving = (this.d.speedMph() ?? 0) > 5;
    const cam = moving ? v.enforcement.find((c) => c.distMi <= 0.8) : null;
    if (cam) return { kind: 'camera', text: `${cam.kind === 'red-light' ? 'Red-light' : 'Speed'} camera in ${cam.distMi < 0.2 ? 'a moment' : `${cam.distMi} mi`}${cam.maxspeed ? ` (limit ${cam.maxspeed})` : ''}` };
    const ev = v.events.find((e) => (e.type === 'crash' || e.type === 'closure') && e.distMi <= 25);
    if (ev) return { kind: ev.type === 'crash' ? 'crash' : 'closure', text: `${ev.type === 'crash' ? 'Crash' : ev.fullClosure ? 'Road closed' : 'Closure'} ahead${ev.roadway ? ` on ${ev.roadway}` : ''}${ev.direction ? ` ${ev.direction}` : ''}, ${ev.distMi} mi` };
    return null;
  }
}
