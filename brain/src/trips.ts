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
};

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

  start(at: Date, soc: number | null, pos: LatLon | null): Trip {
    const res = this.db.prepare('INSERT INTO trips (started_at, start_soc, start_lat, start_lon) VALUES (?, ?, ?, ?)')
      .run(at.toISOString(), soc, pos?.lat ?? null, pos?.lon ?? null);
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

  end(id: number, at: Date, soc: number | null, pos: LatLon | null, effMiPerKwh: number, reason: string): Trip | null {
    const r = this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    const durationS = Math.max(0, Math.round((at.getTime() - Date.parse(r.started_at)) / 1000));
    const kwhEst = r.miles > 0 && effMiPerKwh > 0 ? Math.round((r.miles / effMiPerKwh) * 100) / 100 : r.miles === 0 ? 0 : null;
    const pts = this.points(id);
    const end = pos ?? (pts.length ? pts[pts.length - 1] : null);
    this.db.prepare('UPDATE trips SET ended_at = ?, duration_s = ?, end_soc = ?, kwh_est = ?, end_lat = ?, end_lon = ?, end_reason = ? WHERE id = ?')
      .run(at.toISOString(), durationS, soc, kwhEst, end?.lat ?? null, end?.lon ?? null, reason, id);
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
    const r = this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as Row | undefined;
    return r ? toTrip(r) : null;
  }

  list(limit = 50): Trip[] {
    return (this.db.prepare('SELECT * FROM trips ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]).map(toTrip);
  }

  /** Trips started in [from, to), for the cost summary's miles. */
  between(fromIso: string | null, toIso: string | null): Trip[] {
    return (this.db.prepare('SELECT * FROM trips WHERE started_at >= ? AND started_at < ? ORDER BY started_at')
      .all(fromIso ?? '0000', toIso ?? '9999') as Row[]).map(toTrip);
  }

  points(id: number): TripPoint[] {
    return (this.db.prepare('SELECT t, lat, lon, speed_mph, heading_deg FROM trip_points WHERE trip_id = ? ORDER BY t').all(id) as
      { t: string; lat: number; lon: number; speed_mph: number | null; heading_deg: number | null }[])
      .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, speedMph: p.speed_mph, headingDeg: p.heading_deg }));
  }
}
