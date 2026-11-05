// Reverse geocoding with OpenStreetMap Nominatim, per its usage policy: at
// most one request a second, an identifying User-Agent (no personal email),
// and every answer cached (here: forever, in SQLite). Only tried when online;
// a failure backs off and leaves the stop unnamed for a later pass.
import type { Db } from '../db.ts';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
export const MIN_INTERVAL_MS = 1100;
const OFFLINE_BACKOFF_MS = 10 * 60_000;

/** ~11 m cells: nearby stops share one lookup. */
export const cacheKey = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

/** A short name from a Nominatim jsonv2 answer: the POI name, else "123 Main St", else the first part of the address. */
export function nameFromNominatim(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { name?: string; address?: Record<string, string>; display_name?: string; error?: string };
  if (b.error) return null;
  if (b.name && b.name.trim()) return b.name.trim().slice(0, 80);
  const a = b.address ?? {};
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.path;
  if (road) return (a.house_number ? `${a.house_number} ${road}` : road).slice(0, 80);
  const area = a.neighbourhood ?? a.suburb ?? a.village ?? a.town ?? a.city;
  if (area) return area.slice(0, 80);
  return b.display_name ? b.display_name.split(',')[0].trim().slice(0, 80) || null : null;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class Geocoder {
  private db: Db;
  private userAgent: string;
  private fetchFn: Fetch;
  private chain: Promise<unknown> = Promise.resolve();
  private lastAt = 0;
  private offlineUntil = 0;

  constructor(db: Db, version: string, fetchFn: Fetch = fetch as unknown as Fetch) {
    this.db = db;
    this.userAgent = `slate-cockpit/${version}`;
    this.fetchFn = fetchFn;
  }

  cached(lat: number, lon: number): { hit: boolean; name: string | null } {
    const r = this.db.prepare('SELECT name FROM geocode_cache WHERE key = ?').get(cacheKey(lat, lon)) as { name: string | null } | undefined;
    return r ? { hit: true, name: r.name } : { hit: false, name: null };
  }

  /** Name for a point: cache, else one queued Nominatim call. undefined = couldn't ask (offline); try later. */
  lookup(lat: number, lon: number): Promise<string | null | undefined> {
    const c = this.cached(lat, lon);
    if (c.hit) return Promise.resolve(c.name);
    if (Date.now() < this.offlineUntil) return Promise.resolve(undefined);
    const run = this.chain.then(() => this.fetchOne(lat, lon));
    this.chain = run.catch(() => {});
    return run;
  }

  private async fetchOne(lat: number, lon: number): Promise<string | null | undefined> {
    const again = this.cached(lat, lon);
    if (again.hit) return again.name;
    if (Date.now() < this.offlineUntil) return undefined;
    const wait = this.lastAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt = Date.now();
    const url = `${NOMINATIM}?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&zoom=18&addressdetails=1`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await this.fetchFn(url, { headers: { 'user-agent': this.userAgent, accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) { this.offlineUntil = Date.now() + OFFLINE_BACKOFF_MS; return undefined; }
      const name = nameFromNominatim(await res.json());
      this.db.prepare('INSERT OR REPLACE INTO geocode_cache (key, name, fetched_at) VALUES (?, ?, ?)').run(cacheKey(lat, lon), name, new Date().toISOString());
      return name;
    } catch {
      this.offlineUntil = Date.now() + OFFLINE_BACKOFF_MS;
      return undefined;
    } finally { clearTimeout(timer); }
  }
}
