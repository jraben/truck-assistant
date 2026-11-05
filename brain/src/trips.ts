// Trip storage: one row per trip, thinned GPS points, simplified on close.
import type { Db } from './db.ts';
import { metersBetween, simplify, type LatLon } from './geo.ts';
import type { Trip, TripPoint } from './types.ts';

/** Keep a point when it moved this far, turned this much, or this long passed. */
export const THIN_M = 25;
export const THIN_TURN_DEG = 20;
export const THIN_MS = 30_000;
export const SIMPLIFY_TOL_M = 8;

type Row = {
  id: number; started_at: string; ended_at: string | null; miles: number; duration_s: number;
  start_soc: number | null; end_soc: number | null; kwh_est: number | null;
  start_lat: number | null; start_lon: number | null; end_lat: number | null; end_lon: number | null;
  driver_id: string | null; source: string | null; start_stop_id: number | null; end_stop_id: number | null;
  city_miles?: number | null; highway_miles?: number | null; city_kwh?: number | null; highway_kwh?: number | null;
  from_name?: string | null; to_name?: string | null;
};

const SELECT = 'SELECT t.*, a.name AS from_name, b.name AS to_name FROM trips t LEFT JOIN stops a ON a.id = t.start_stop_id LEFT JOIN stops b ON b.id = t.end_stop_id';

export type TripFilter = { driver?: string | null; source?: 'truck' | 'phone' | null };

function toTrip(r: Row): Trip {
  const now = Date.now();
  return {
    id: r.id, startedAt: r.started_at, endedAt: r.ended_at,
    miles: Math.round(r.miles * 100) / 100,
    durationS: r.ended_at ? r.duration_s : Math.round((now - Date.parse(r.started_at)) / 1000),
    startSoc: r.start_soc, endSoc: r.end_soc, kwhEst: r.kwh_est,
    // Unknown start (no GPS fix all trip) stays null rather than 0,0.
    start: (r.start_lat === null || r.start_lon === null ? null : { lat: r.start_lat, lon: r.start_lon }) as Trip['start'],
    end: r.end_lat === null || r.end_lon === null ? null : { lat: r.end_lat, lon: r.end_lon },
    driverId: r.driver_id ?? null,
    source: (r.source ?? 'truck') as Trip['source'],
    from: r.start_stop_id ? { stopId: r.start_stop_id, name: r.from_name ?? null } : null,
    to: r.end_stop_id ? { stopId: r.end_stop_id, name: r.to_name ?? null } : null,
    cityMiles: r.city_miles == null ? null : Math.round(r.city_miles * 100) / 100,
    highwayMiles: r.highway_miles == null ? null : Math.round(r.highway_miles * 100) / 100,
    cityKwh: r.city_kwh ?? null, highwayKwh: r.highway_kwh ?? null,
  };
}

/** Should `p` be stored, given the last stored point? Pure, for the thinning rule. */
export function keepPoint(last: (LatLon & { t: number; headingDeg: number | null }) | null, p: LatLon & { t: number; headingDeg: number | null }): boolean {
  if (!last) return true;
  if (metersBetween(last, p) >= THIN_M) return true;
  if (p.t - last.t >= THIN_MS && metersBetween(last, p) >= 2) return true;
  if (last.headingDeg !== null && p.headingDeg !== null && metersBetween(last, p) >= 5) {
    const d = Math.abs(((p.headingDeg - last.headingDeg + 540) % 360) - 180);
    if (d >= THIN_TURN_DEG) return true;
  }
  return false;
}

export class TripStore {
  private lastKept: (LatLon & { t: number; headingDeg: number | null }) | null = null;

  private db: Db;

  constructor(db: Db) { this.db = db; }

  /** A trip still open from before a crash or power cut is closed at its last point. */
  closeOrphans(): number {
    const open = this.db.prepare('SELECT * FROM trips WHERE ended_at IS NULL').all() as Row[];
    for (const r of open) {
      const last = this.db.prepare('SELECT t, lat, lon FROM trip_points WHERE trip_id = ? ORDER BY t DESC LIMIT 1').get(r.id) as { t: string; lat: number; lon: number } | undefined;
      const endedAt = last?.t ?? r.started_at;
      this.db.prepare('UPDATE trips SET ended_at = ?, duration_s = ?, end_lat = ?, end_lon = ?, end_reason = ? WHERE id = ?')
        .run(endedAt, Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(r.started_at)) / 1000)), last?.lat ?? null, last?.lon ?? null, 'restart', r.id);
    }
    return open.length;
  }

  start(at: Date, soc: number | null, pos: LatLon | null, driverId: string | null = null, startStopId: number | null = null): Trip {
    const res = this.db.prepare("INSERT INTO trips (started_at, start_soc, start_lat, start_lon, driver_id, source, start_stop_id) VALUES (?, ?, ?, ?, ?, 'truck', ?)")
      .run(at.toISOString(), soc, pos?.lat ?? null, pos?.lon ?? null, driverId, startStopId);
    this.lastKept = null;
    return this.get(Number(res.lastInsertRowid))!;
  }

  addMiles(id: number, miles: number) {
    this.db.prepare('UPDATE trips SET miles = miles + ? WHERE id = ?').run(miles, id);
  }

  /** Record a GPS sample if the thinning rule keeps it. Fills in a missing start position. */
  addPoint(id: number, p: { t: Date; lat: number; lon: number; speedMph: number | null; headingDeg: number | null }) {
    const cand = { lat: p.lat, lon: p.lon, t: p.t.getTime(), headingDeg: p.headingDeg };
    if (!keepPoint(this.lastKept, cand)) return false;
    this.db.prepare('INSERT INTO trip_points (trip_id, t, lat, lon, speed_mph, heading_deg) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, p.t.toISOString(), p.lat, p.lon, p.speedMph, p.headingDeg);
    if (!this.lastKept) this.db.prepare('UPDATE trips SET start_lat = COALESCE(start_lat, ?), start_lon = COALESCE(start_lon, ?) WHERE id = ?').run(p.lat, p.lon, id);
    this.lastKept = cand;
    return true;
  }

  end(id: number, at: Date, soc: number | null, pos: LatLon | null, effMiPerKwh: number, reason: string, endStopId: number | null = null): Trip | null {
    const r = this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    const durationS = Math.max(0, Math.round((at.getTime() - Date.parse(r.started_at)) / 1000));
    const kwhEst = r.miles > 0 && effMiPerKwh > 0 ? Math.round((r.miles / effMiPerKwh) * 100) / 100 : r.miles === 0 ? 0 : null;
    const pts = this.points(id);
    const end = pos ?? (pts.length ? pts[pts.length - 1] : null);
    this.db.prepare('UPDATE trips SET ended_at = ?, duration_s = ?, end_soc = ?, kwh_est = ?, end_lat = ?, end_lon = ?, end_reason = ?, end_stop_id = ? WHERE id = ?')
      .run(at.toISOString(), durationS, soc, kwhEst, end?.lat ?? null, end?.lon ?? null, reason, endStopId, id);
    // Douglas-Peucker on close keeps the shape, drops the straight-line filler.
    if (pts.length > 2) {
      const kept = new Set(simplify(pts, SIMPLIFY_TOL_M).map((p) => p.t));
      const drop = pts.filter((p) => !kept.has(p.t));
      const del = this.db.prepare('DELETE FROM trip_points WHERE trip_id = ? AND t = ?');
      this.db.exec('BEGIN');
      try { for (const p of drop) del.run(id, p.t); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
    this.lastKept = null;
    return this.get(id);
  }

  get(id: number): Trip | null {
    const r = this.db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
    return r ? toTrip(r) : null;
  }

  private where(f: TripFilter, args: (string | number)[]): string {
    const w: string[] = [];
    if (f.driver) { w.push('t.driver_id = ?'); args.push(f.driver); }
    if (f.source === 'phone') w.push("t.source = 'phone'");
    else if (f.source === 'truck') w.push("(t.source IS NULL OR t.source = 'truck')");
    return w.length ? ` AND ${w.join(' AND ')}` : '';
  }

  list(limit = 50, f: TripFilter = {}): Trip[] {
    const args: (string | number)[] = [];
    const w = this.where(f, args);
    return (this.db.prepare(`${SELECT} WHERE 1 = 1${w} ORDER BY t.started_at DESC LIMIT ?`).all(...args, limit) as Row[]).map(toTrip);
  }

  /** Trips started in [from, to), e.g. for the cost summary's miles. */
  between(fromIso: string | null, toIso: string | null, f: TripFilter = {}): Trip[] {
    const args: (string | number)[] = [fromIso ?? '0000', toIso ?? '9999'];
    const w = this.where(f, args);
    return (this.db.prepare(`${SELECT} WHERE t.started_at >= ? AND t.started_at < ?${w} ORDER BY t.started_at`).all(...args) as Row[]).map(toTrip);
  }

  /** Trips overlapping [from, to), oldest first (the day timeline). */
  overlapping(fromIso: string, toIso: string, f: TripFilter = {}): Trip[] {
    const args: (string | number)[] = [toIso, fromIso];
    const w = this.where(f, args);
    return (this.db.prepare(`${SELECT} WHERE t.started_at < ? AND (t.ended_at IS NULL OR t.ended_at > ?)${w} ORDER BY t.started_at`).all(...args) as Row[]).map(toTrip);
  }

  setDriver(id: number, driverId: string | null) { this.db.prepare('UPDATE trips SET driver_id = ? WHERE id = ?').run(driverId, id); }
  setStartStop(id: number, stopId: number | null) { this.db.prepare('UPDATE trips SET start_stop_id = ? WHERE id = ?').run(stopId, id); }

  /** The trip that ended at this stop, if any. */
  endingAt(stopId: number): Trip | null {
    const r = this.db.prepare(`${SELECT} WHERE t.end_stop_id = ?`).get(stopId) as Row | undefined;
    return r ? toTrip(r) : null;
  }

  /**
   * A stop too short to count: the trip that ended there carries on. `curId`
   * (the trip started from that stop, if any) is folded into `prevId`, which is
   * open again.
   */
  reopen(prevId: number, curId: number | null): Trip | null {
    this.db.exec('BEGIN');
    try {
      if (curId !== null && curId !== prevId) {
        const cur = this.db.prepare('SELECT miles, city_miles, highway_miles FROM trips WHERE id = ?').get(curId) as { miles: number; city_miles: number | null; highway_miles: number | null } | undefined;
        this.db.prepare('UPDATE trip_points SET trip_id = ? WHERE trip_id = ?').run(prevId, curId);
        this.db.prepare('UPDATE trips SET miles = miles + ? WHERE id = ?').run(cur?.miles ?? 0, prevId);
        if (cur && (cur.city_miles !== null || cur.highway_miles !== null)) this.db.prepare('UPDATE trips SET city_miles = COALESCE(city_miles, 0) + ?, highway_miles = COALESCE(highway_miles, 0) + ? WHERE id = ?').run(cur.city_miles ?? 0, cur.highway_miles ?? 0, prevId);
        this.db.prepare('DELETE FROM trips WHERE id = ?').run(curId);
      }
      this.db.prepare('UPDATE trips SET ended_at = NULL, end_soc = NULL, kwh_est = NULL, end_lat = NULL, end_lon = NULL, end_reason = NULL, end_stop_id = NULL WHERE id = ?').run(prevId);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this.lastKept = null;
    return this.get(prevId);
  }

  /** Phone history: one finished trip with its points, in one go. */
  insertPhone(t: { driverId: string; startedAt: number; endedAt: number; miles: number; points: { t: number; lat: number; lon: number; speedMph: number | null }[]; startStopId: number | null; endStopId: number | null }): number {
    const a = t.points[0], b = t.points[t.points.length - 1];
    const res = this.db.prepare(`INSERT INTO trips (started_at, ended_at, miles, duration_s, start_lat, start_lon, end_lat, end_lon, end_reason, driver_id, source, start_stop_id, end_stop_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'phone', ?, 'phone', ?, ?)`)
      .run(new Date(t.startedAt).toISOString(), new Date(t.endedAt).toISOString(), t.miles, Math.round((t.endedAt - t.startedAt) / 1000), a.lat, a.lon, b.lat, b.lon, t.driverId, t.startStopId, t.endStopId);
    const id = Number(res.lastInsertRowid);
    const ins = this.db.prepare('INSERT INTO trip_points (trip_id, t, lat, lon, speed_mph, heading_deg) VALUES (?, ?, ?, ?, ?, NULL)');
    for (const p of t.points) ins.run(id, new Date(p.t).toISOString(), p.lat, p.lon, p.speedMph === null ? null : Math.round(p.speedMph * 10) / 10);
    return id;
  }

  /** Re-import: drop a driver's phone trips that started in [from, to). */
  deletePhone(driverId: string, fromIso: string, toIso: string): number {
    const ids = (this.db.prepare("SELECT id FROM trips WHERE source = 'phone' AND driver_id = ? AND started_at >= ? AND started_at < ?").all(driverId, fromIso, toIso) as { id: number }[]).map((r) => r.id);
    const delP = this.db.prepare('DELETE FROM trip_points WHERE trip_id = ?');
    const delT = this.db.prepare('DELETE FROM trips WHERE id = ?');
    for (const id of ids) { delP.run(id); delT.run(id); }
    return ids.length;
  }

  points(id: number): TripPoint[] {
    return (this.db.prepare('SELECT t, lat, lon, speed_mph, heading_deg FROM trip_points WHERE trip_id = ? ORDER BY t').all(id) as
      { t: string; lat: number; lon: number; speed_mph: number | null; heading_deg: number | null }[])
      .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, speedMph: p.speed_mph, headingDeg: p.heading_deg }));
  }
}
