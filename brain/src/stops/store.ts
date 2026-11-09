// Stops and saved places in SQLite.
import type { Db } from '../db.ts';
import type { Place, Stop } from '../types.ts';
import type { NameSource } from '../places/naming.ts';

type StopRow = {
  id: number; driver_id: string | null; source: string; arrived_at: string; departed_at: string | null;
  lat: number; lon: number; reason: string; name: string | null; name_source: string | null; place_id: number | null; geocode_tried: number;
};

export const toStop = (r: StopRow, now = Date.now()): Stop => ({
  id: r.id, driverId: r.driver_id, source: r.source as Stop['source'],
  arrivedAt: r.arrived_at, departedAt: r.departed_at,
  durationS: Math.max(0, Math.round(((r.departed_at ? Date.parse(r.departed_at) : now) - Date.parse(r.arrived_at)) / 1000)),
  lat: r.lat, lon: r.lon, reason: r.reason as Stop['reason'],
  name: r.name, nameSource: r.name_source as Stop['nameSource'], placeId: r.place_id,
});

export type StopFilter = { from?: string | null; to?: string | null; driver?: string | null; source?: 'truck' | 'phone' | null; limit?: number };

export class StopStore {
  private db: Db;
  constructor(db: Db) { this.db = db; }

  create(s: { driverId: string | null; source: 'truck' | 'phone'; arrivedAt: string; departedAt: string | null; lat: number; lon: number; reason: 'ignition' | 'dwell' }): Stop {
    const res = this.db.prepare('INSERT INTO stops (driver_id, source, arrived_at, departed_at, lat, lon, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.driverId, s.source, s.arrivedAt, s.departedAt, s.lat, s.lon, s.reason);
    return this.get(Number(res.lastInsertRowid))!;
  }

  get(id: number): Stop | null {
    const r = this.db.prepare('SELECT * FROM stops WHERE id = ?').get(id) as StopRow | undefined;
    return r ? toStop(r) : null;
  }

  /** The truck's open stop (from before a restart), if any. */
  openTruckStop(): Stop | null {
    const r = this.db.prepare("SELECT * FROM stops WHERE source = 'truck' AND departed_at IS NULL ORDER BY arrived_at DESC LIMIT 1").get() as StopRow | undefined;
    return r ? toStop(r) : null;
  }

  close(id: number, at: string) { this.db.prepare('UPDATE stops SET departed_at = ? WHERE id = ?').run(at, id); }
  delete(id: number) { this.db.prepare('DELETE FROM stops WHERE id = ?').run(id); }
  setDriver(id: number, driverId: string | null) { this.db.prepare('UPDATE stops SET driver_id = ? WHERE id = ?').run(driverId, id); }

  setName(id: number, n: { name: string; source: NameSource; placeId: number | null } | null) {
    this.db.prepare('UPDATE stops SET name = ?, name_source = ?, place_id = ? WHERE id = ?').run(n?.name ?? null, n?.source ?? null, n?.placeId ?? null, id);
  }
  markGeocodeTried(id: number) { this.db.prepare('UPDATE stops SET geocode_tried = 1 WHERE id = ?').run(id); }

  list(f: StopFilter = {}): Stop[] {
    const where = ['arrived_at >= ?', 'arrived_at < ?'];
    const args: (string | number)[] = [f.from ?? '0000', f.to ?? '9999'];
    if (f.driver) { where.push('driver_id = ?'); args.push(f.driver); }
    if (f.source) { where.push('source = ?'); args.push(f.source); }
    args.push(f.limit ?? 1000);
    return (this.db.prepare(`SELECT * FROM stops WHERE ${where.join(' AND ')} ORDER BY arrived_at DESC LIMIT ?`).all(...args) as StopRow[]).map((r) => toStop(r));
  }

  /** Stops overlapping [from, to), oldest first (a stop over midnight shows on both days). */
  overlapping(from: string, to: string, driver?: string | null): Stop[] {
    const args: string[] = [to, from];
    let sql = "SELECT * FROM stops WHERE arrived_at < ? AND (departed_at IS NULL OR departed_at > ?)";
    if (driver) { sql += ' AND driver_id = ?'; args.push(driver); }
    return (this.db.prepare(sql + ' ORDER BY arrived_at').all(...args) as StopRow[]).map((r) => toStop(r));
  }

  /** Every stop not named by a saved place (for re-naming after zones/feed change). */
  notFromPlaces(): Stop[] {
    return (this.db.prepare("SELECT * FROM stops WHERE name_source IS NULL OR name_source != 'place'").all() as StopRow[]).map((r) => toStop(r));
  }
  all(): Stop[] { return (this.db.prepare('SELECT * FROM stops').all() as StopRow[]).map((r) => toStop(r)); }
  withPlace(placeId: number): Stop[] { return (this.db.prepare('SELECT * FROM stops WHERE place_id = ?').all(placeId) as StopRow[]).map((r) => toStop(r)); }
  needingGeocode(limit = 20): Stop[] {
    return (this.db.prepare('SELECT * FROM stops WHERE name_source IS NULL AND geocode_tried = 0 ORDER BY arrived_at DESC LIMIT ?').all(limit) as StopRow[]).map((r) => toStop(r));
  }

  /** Re-import: drop a driver's phone stops that arrived in [from, to). */
  deletePhone(driverId: string, from: string, to: string): number {
    return Number(this.db.prepare("DELETE FROM stops WHERE source = 'phone' AND driver_id = ? AND arrived_at >= ? AND arrived_at < ?").run(driverId, from, to).changes);
  }
}

type PlaceRow = { id: number; name: string; lat: number; lon: number; radius_m: number; created_at: string; created_by: string | null; kind?: string | null; charge_kw?: number | null; note?: string | null };

export class PlaceStore {
  private db: Db;
  constructor(db: Db) { this.db = db; }

  all(): PlaceRow[] { return this.db.prepare('SELECT * FROM places ORDER BY name').all() as PlaceRow[]; }
  get(id: number): PlaceRow | null { return (this.db.prepare('SELECT * FROM places WHERE id = ?').get(id) as PlaceRow | undefined) ?? null; }

  create(p: { name: string; lat: number; lon: number; radiusM: number; createdBy: string | null }): PlaceRow {
    const res = this.db.prepare('INSERT INTO places (name, lat, lon, radius_m, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.name, p.lat, p.lon, p.radiusM, new Date().toISOString(), p.createdBy);
    return this.get(Number(res.lastInsertRowid))!;
  }
  update(id: number, p: { name?: string; radiusM?: number; kind?: string | null; chargeKw?: number | null; note?: string | null }) {
    if (p.kind !== undefined) this.db.prepare('UPDATE places SET kind = ? WHERE id = ?').run(p.kind, id);
    if (p.chargeKw !== undefined) this.db.prepare('UPDATE places SET charge_kw = ? WHERE id = ?').run(p.chargeKw, id);
    if (p.note !== undefined) this.db.prepare('UPDATE places SET note = ? WHERE id = ?').run(p.note, id);
    if (p.name !== undefined) this.db.prepare('UPDATE places SET name = ? WHERE id = ?').run(p.name, id);
    if (p.radiusM !== undefined) this.db.prepare('UPDATE places SET radius_m = ? WHERE id = ?').run(p.radiusM, id);
    return this.get(id);
  }
  delete(id: number): boolean { return Number(this.db.prepare('DELETE FROM places WHERE id = ?').run(id).changes) > 0; }

  /** With visit counts (stops named by the place), optionally for one driver. */
  withVisits(driver?: string | null): Place[] {
    const sql = `SELECT p.*, COUNT(s.id) AS visits, MAX(s.arrived_at) AS last_visit FROM places p
      LEFT JOIN stops s ON s.place_id = p.id ${driver ? 'AND s.driver_id = ?' : ''} GROUP BY p.id ORDER BY visits DESC, p.name`;
    const rows = (driver ? this.db.prepare(sql).all(driver) : this.db.prepare(sql).all()) as (PlaceRow & { visits: number; last_visit: string | null })[];
    return rows.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, radiusM: r.radius_m, visits: Number(r.visits), lastVisit: r.last_visit, kind: (r.kind ?? null) as Place['kind'], chargeKw: r.charge_kw ?? null, note: r.note ?? null }));
  }
}
