// Speed limits from OpenStreetMap's maxspeed tag, through the Overpass API.
// Online only, rate-limited (one query per 15 s at most, longer after a busy
// answer), and cached per road segment: every way an answer returns is kept with
// its geometry, so the next fix on the same road is answered locally. A limit
// is a hint from a volunteer map, never a fact; the UI labels it "OSM".
import type { Db } from '../db.ts';
import { bearingDeg, type LatLon } from '../geo.ts';

export const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export const MIN_QUERY_MS = 15_000;
const BUSY_BACKOFF_MS = 2 * 60_000;
/** A fix this close to a cached way's line is on that way. */
export const MATCH_M = 25;
const QUERY_RADIUS_M = 40;
const HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service';

/**
 * OSM maxspeed -> mph. Bare numbers are km/h ("50"), units are written out
 * ("35 mph", "35mph", "100 km/h", "10 knots"). Implicit ("US:urban", "RU:rural"),
 * "none", "walk", "signals" and anything unreadable -> null. "50;30" takes the first.
 */
export function parseMaxspeed(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().split(';')[0].trim();
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph|knots?)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  if (!(v > 0)) return null;
  const unit = m[2] ?? 'km/h';
  if (unit === 'mph') return Math.round(v);
  if (unit.startsWith('knot')) return Math.round(v * 1.150779);
  return Math.round(v / 1.609344);
}

export type CachedWay = { id: number; name: string | null; ref: string | null; maxspeed: string | null; forward: string | null; backward: string | null; oneway: boolean; geom: LatLon[] };

/** Overpass `out tags geom` JSON -> ways. */
export function parseOverpass(body: unknown): CachedWay[] {
  const els = (body as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out: CachedWay[] = [];
  for (const e of els as Record<string, any>[]) {
    if (e?.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    const t = e.tags ?? {};
    out.push({
      id: Number(e.id), name: t.name ?? null, ref: t.ref ?? null,
      maxspeed: t.maxspeed ?? null, forward: t['maxspeed:forward'] ?? null, backward: t['maxspeed:backward'] ?? null,
      oneway: t.oneway === 'yes' || t.highway === 'motorway',
      geom: e.geometry.map((g: { lat: number; lon: number }) => ({ lat: g.lat, lon: g.lon })),
    });
  }
  return out;
}

/** Distance (m) from p to the polyline, and the bearing of the nearest segment. Flat projection; fine at road scale. */
export function nearestOnWay(p: LatLon, geom: LatLon[]): { distM: number; bearing: number } {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111_320;
  let best = { distM: Infinity, bearing: 0 };
  for (let i = 0; i + 1 < geom.length; i++) {
    const a = geom[i], b = geom[i + 1];
    const ax = a.lon * k, ay = a.lat * 110_540, bx = b.lon * k, by = b.lat * 110_540, px = p.lon * k, py = p.lat * 110_540;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.distM) best = { distM: d, bearing: bearingDeg(a, b) };
  }
  return best;
}

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The way the truck is on: within MATCH_M, preferring ways whose direction
 * matches the heading (either way along it, unless one-way). Pure.
 */
export function matchWay(p: LatLon, headingDeg: number | null, ways: CachedWay[]): { way: CachedWay; forward: boolean } | null {
  let best: { way: CachedWay; forward: boolean; score: number } | null = null;
  for (const w of ways) {
    const n = nearestOnWay(p, w.geom);
    if (n.distM > MATCH_M) continue;
    let score = n.distM, forward = true;
    if (headingDeg !== null) {
      const fwd = angDiff(headingDeg, n.bearing), back = angDiff(headingDeg, (n.bearing + 180) % 360);
      forward = fwd <= back;
      const off = w.oneway ? fwd : Math.min(fwd, back);
      score += off > 60 ? 100 : off / 3; // a cross street is a poor match
    }
    if (!best || score < best.score) best = { way: w, forward, score };
  }
  return best ? { way: best.way, forward: best.forward } : null;
}

/** The limit that applies on a way in that direction. */
export function limitOn(w: CachedWay, forward: boolean): { mph: number | null; raw: string | null } {
  const raw = (forward ? w.forward : w.backward) ?? w.maxspeed;
  return { mph: parseMaxspeed(raw), raw };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class SpeedLimits {
  ways = new Map<number, CachedWay>();
  error: string | null = null;
  private lastQuery = 0;
  private busyUntil = 0;
  private inflight = false;
  private urlIdx = 0;
  private db: Db;
  private ua: string;
  private fetchFn: Fetch;

  constructor(db: Db, version: string, fetchFn: Fetch = fetch as unknown as Fetch) {
    this.db = db; this.ua = `slate-cockpit/${version}`; this.fetchFn = fetchFn;
    db.exec('CREATE TABLE IF NOT EXISTS osm_ways (id INTEGER PRIMARY KEY, min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL, body TEXT NOT NULL, fetched_at TEXT NOT NULL)');
    db.exec('CREATE INDEX IF NOT EXISTS osm_ways_box ON osm_ways(min_lat, max_lat)');
  }

  /** Cached ways whose bounding box (plus ~50 m) holds p. */
  private near(p: LatLon): CachedWay[] {
    const m = 0.0005;
    const rows = this.db.prepare('SELECT id, body FROM osm_ways WHERE min_lat - ? <= ? AND max_lat + ? >= ? AND min_lon - ? <= ? AND max_lon + ? >= ?').all(m, p.lat, m, p.lat, m, p.lon, m, p.lon) as { id: number; body: string }[];
    for (const r of rows) if (!this.ways.has(r.id)) this.ways.set(r.id, JSON.parse(r.body) as CachedWay);
    return rows.map((r) => this.ways.get(r.id)!);
  }

  private store(ws: CachedWay[]) {
    const ins = this.db.prepare('INSERT OR REPLACE INTO osm_ways (id, min_lat, max_lat, min_lon, max_lon, body, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    for (const w of ws) {
      this.ways.set(w.id, w);
      const lats = w.geom.map((g) => g.lat), lons = w.geom.map((g) => g.lon);
      ins.run(w.id, Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons), JSON.stringify(w), now);
    }
  }

  /** Local answer, if the cache covers this spot. */
  lookupCached(p: LatLon, headingDeg: number | null) {
    const m = matchWay(p, headingDeg, this.near(p));
    if (!m) return null;
    return { ...limitOn(m.way, m.forward), road: m.way.name ?? m.way.ref, wayId: m.way.id };
  }

  /** Ask Overpass about the roads around p, if allowed now. Resolves true when new ways were stored. */
  async query(p: LatLon, now = Date.now()): Promise<boolean> {
    if (this.inflight || now - this.lastQuery < MIN_QUERY_MS || now < this.busyUntil) return false;
    this.inflight = true; this.lastQuery = now;
    const q = `[out:json][timeout:10];way(around:${QUERY_RADIUS_M},${p.lat.toFixed(6)},${p.lon.toFixed(6)})[highway~"^(${HIGHWAYS})$"];out tags geom;`;
    const url = OVERPASS_URLS[this.urlIdx % OVERPASS_URLS.length];
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await this.fetchFn(url, { method: 'POST', headers: { 'user-agent': this.ua, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: `data=${encodeURIComponent(q)}`, signal: ctl.signal });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { this.busyUntil = Date.now() + BUSY_BACKOFF_MS; this.urlIdx++; }
        this.error = `Overpass answered ${res.status}`;
        return false;
      }
      const ways = parseOverpass(await res.json());
      this.store(ways);
      this.error = null;
      return ways.length > 0;
    } catch (e) {
      this.error = (e as Error).name === 'AbortError' ? 'Overpass timed out' : 'Overpass unreachable';
      this.busyUntil = Date.now() + BUSY_BACKOFF_MS; this.urlIdx++;
      return false;
    } finally { clearTimeout(t); this.inflight = false; }
  }
}
