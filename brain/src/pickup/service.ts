// Airport pickup: follow one flight (ADS-B by callsign) and say when to leave.
// Polled every 30 s while a pickup is set, nothing otherwise. Alerts go to the
// phone (Settings › Alerts) at "leave now", "landed" and "at the gate".
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import { fetchRoute, type LatLon } from '../roadtrip/route.ts';
import { findFlight, parseAdsb, parseFlight, parseRoute, pickupState, type Airport, type FlightId, type PickupState } from './flight.ts';

export const ADSB_URL = 'https://opendata.adsb.fi/api/v2/callsign/';
export const ROUTE_URL = 'https://api.adsbdb.com/v0/callsign/';
const POLL_MS = 30_000;
const DRIVE_MS = 5 * 60_000;

export type Pickup = {
  flight: FlightId;
  who: string | null;
  bags: boolean;
  origin: Airport | null;
  dest: Airport | null;
  createdAt: string;
  landedAt: number | null;
  stoppedSince: number | null;
  notified: string[];
};
export type PickupView = { pickup: Pickup | null; state: PickupState | null; suggestion: { flight: FlightId; from: string } | null; error: string | null };
export type PickupBrief = { phase: PickupState['phase']; line: string; leaveNow: boolean } | null;

export class PickupError extends Error {}

export type PickupDeps = {
  db: Db;
  gps: () => LatLon | null;
  online: () => boolean;
  notify: (title: string, message: string, clickUrl: string | null) => Promise<void>;
  /** The next calendar appointment's title and place (WOPR), to suggest a flight. */
  nextAppointment?: () => { title: string; location: string | null } | null;
  router?: string;
  fetchFn?: typeof fetch;
};

export class PickupService {
  private d: PickupDeps;
  private p: Pickup | null;
  private state: PickupState | null = null;
  private lastPoll = 0;
  private drive: { at: number; min: number | null } = { at: 0, min: null };
  private error: string | null = null;
  private busy = false;

  constructor(d: PickupDeps) { this.d = d; this.p = kvGet<Pickup>(d.db, 'pickup'); }

  setNextAppointment(f: PickupDeps['nextAppointment']) { this.d.nextAppointment = f; }

  private save() { kvSet(this.d.db, 'pickup', this.p); }
  private f() { return this.d.fetchFn ?? fetch; }

  async start(req: { flight: string; who?: string | null; bags?: boolean }): Promise<PickupView> {
    const flight = parseFlight(req.flight);
    if (!flight) throw new PickupError(`"${req.flight}" doesn't look like a flight number (try AA 1234 or Southwest 2510).`);
    let route = { origin: null as Airport | null, dest: null as Airport | null };
    try {
      const r = await this.f()(ROUTE_URL + flight.callsign, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) { const x = parseRoute(await r.json()); route = { origin: x.origin, dest: x.destination }; }
    } catch { /* route unknown: still follow the plane */ }
    this.p = { flight, who: req.who?.trim() || null, bags: !!req.bags, origin: route.origin, dest: route.dest, createdAt: new Date().toISOString(), landedAt: null, stoppedSince: null, notified: [] };
    this.lastPoll = 0; this.state = null; this.error = route.dest ? null : 'The flight’s route isn’t known yet (adsbdb); the destination will show once it is.';
    this.save();
    await this.tick(Date.now());
    return this.view();
  }

  cancel() { this.p = null; this.state = null; this.error = null; this.save(); }

  suggestion(): PickupView['suggestion'] {
    if (this.p) return null;
    const n = this.d.nextAppointment?.();
    if (!n) return null;
    const f = findFlight(`${n.title} ${n.location ?? ''}`);
    return f ? { flight: f, from: n.title } : null;
  }

  view(): PickupView { return { pickup: this.p, state: this.state, suggestion: this.suggestion(), error: this.error }; }

  brief(): PickupBrief {
    if (!this.p || !this.state) return null;
    const leaveNow = !!this.state.leaveAt && Date.parse(this.state.leaveAt) <= Date.now() && this.state.phase !== 'at-gate';
    return { phase: this.state.phase, line: this.state.line, leaveNow };
  }

  private async driveMinutes(now: number): Promise<number | null> {
    const p = this.p, g = this.d.gps();
    if (!p?.dest || !g) return null;
    if (now - this.drive.at < DRIVE_MS) return this.drive.min;
    try {
      const r = await fetchRoute(g, p.dest, { router: this.d.router, fetchFn: this.d.fetchFn });
      this.drive = { at: now, min: Math.round(r.minutes) };
    } catch { this.drive = { at: now, min: this.drive.min }; }
    return this.drive.min;
  }

  /** Every 30 s from the brain while a pickup is set. */
  async tick(now = Date.now()) {
    const p = this.p;
    if (!p || this.busy || !this.d.online() || now - this.lastPoll < POLL_MS) return;
    this.busy = true; this.lastPoll = now;
    try {
      let ac = null;
      try {
        const r = await this.f()(ADSB_URL + p.flight.callsign, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) ac = parseAdsb(await r.json(), now);
        this.error = r.ok ? (p.dest ? null : this.error) : `Flight tracking answered ${r.status}`;
      } catch (e) { this.error = `Flight tracking unreachable (${(e as Error).message})`; }
      if (!p.dest && !this.error?.startsWith('Flight')) {
        try { const r = await this.f()(ROUTE_URL + p.flight.callsign, { signal: AbortSignal.timeout(10_000) }); if (r.ok) { const x = parseRoute(await r.json()); p.origin = x.origin; p.dest = x.destination; } } catch { /* later */ }
      }
      const driveMin = await this.driveMinutes(now);
      const st = pickupState({ now, ac, dest: p.dest, landedAt: p.landedAt, stoppedSince: p.stoppedSince, bags: p.bags, driveMin, label: p.flight.label, who: p.who });
      if ((st.phase === 'taxiing' || st.phase === 'at-gate') && !p.landedAt) p.landedAt = Date.parse(st.landsAt ?? new Date(now).toISOString());
      if (ac && (ac.gsKt ?? 99) < 3 && st.phase === 'taxiing') p.stoppedSince ??= now; else if (ac && (ac.gsKt ?? 0) >= 3) p.stoppedSince = null;
      this.state = st;
      await this.alerts(p, st, now);
      this.save();
    } finally { this.busy = false; }
  }

  private async alerts(p: Pickup, st: PickupState, now: number) {
    const say = async (key: string, title: string, msg: string) => {
      if (p.notified.includes(key)) return;
      p.notified.push(key);
      const waze = p.dest ? `https://waze.com/ul?ll=${p.dest.lat.toFixed(6)},${p.dest.lon.toFixed(6)}&navigate=yes` : null;
      try { await this.d.notify(title, msg, waze); } catch (e) { console.warn('[pickup] alert', (e as Error).message); }
    };
    if (st.leaveAt && Date.parse(st.leaveAt) <= now && st.phase !== 'at-gate') await say('leave', `Leave now for ${p.dest?.iata ?? 'the airport'}`, st.line);
    if (st.phase === 'taxiing' || st.phase === 'at-gate') await say('landed', `${p.flight.label} landed`, st.line);
    if (st.phase === 'at-gate') await say('gate', `${p.flight.label} is at the gate`, st.line);
  }
}
