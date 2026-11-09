// Charger finder: fetch (AFDC + OCM), cache in SQLite, score per request.
// Offline-first: a stale cache beats an error.
//
// Google Places (live stall counts) is a separate, memory-only layer: it is
// billed, so it is called at most once per GOOGLE_MIN_INTERVAL_MS for the
// whole truck (the UI polls every 20 s and a moving truck changes grid cell
// every minute), and a failure there only adds a note. The charge log's
// last-paid price is joined on every request, never cached.
import type { Db } from '../db.ts';
import { haversineMi, metersBetween } from '../geo.ts';
import type { Charger, ChargingPrefs, Settings, SitePerformance } from '../types.ts';

/** Truck settings plus the active driver's charging prefs. */
export type FinderSettings = Pick<Settings, 'keys' | 'packKwh' | 'efficiencyMiPerKwh'> & { charging: ChargingPrefs };
import { rankChargers, type Station } from './score.ts';
import { fetchAfdc, fetchGoogle, fetchOcm, mergeGoogle, mergeStations, type FetchFn } from './sources.ts';
import { withLastPaid, type PaidSession } from './paid.ts';

export const CACHE_TTL_MS = 30 * 60_000;
export const STALE_OK_MS = 14 * 24 * 3600_000;
/** At most one billed Google call per this long, truck-wide. */
export const GOOGLE_MIN_INTERVAL_MS = 5 * 60_000;
/** Google results are dropped after this long rather than shown as live. */
export const GOOGLE_KEEP_MS = 30 * 60_000;
/** Snap requests to a ~0.7 mi grid so a moving truck reuses one fetch. */
const GRID = 0.01;

export type FindResult = { chargers: Charger[]; message: string | null };

export class ChargerFinder {
  private mem = new Map<string, { at: number; stations: Station[] }>();
  private inflight = new Map<string, Promise<Station[]>>();
  private lastErr = new Map<string, string>();
  private google: { at: number; stations: Station[] } | null = null;
  private googleTriedAt = 0;
  private googleErr: string | null = null;
  private googleInflight: Promise<void> | null = null;

  private db: Db;
  private fetchFn: FetchFn;
  private perf: ((lat: number, lon: number) => SitePerformance | null) | null = null;

  /** How each site charged the truck before (road trip samples), joined onto every station. */
  setPerformance(fn: (lat: number, lon: number) => SitePerformance | null) { this.perf = fn; }
  withPerf(stations: Station[]): Station[] {
    const f = this.perf;
    if (!f) return stations;
    return stations.map((s) => { try { const p = f(s.lat, s.lon); return p ? { ...s, performance: p } : s; } catch { return s; } });
  }

  constructor(db: Db, fetchFn: FetchFn = fetch) { this.db = db; this.fetchFn = fetchFn; }

  private radius(s: FinderSettings) { return Math.max(15, Math.ceil(s.charging.maxDetourMi * 2.5)); }

  async find(lat: number, lon: number, soc: number | null, s: FinderSettings): Promise<FindResult> {
    const haveKeys = !!(s.keys.afdc || s.keys.openChargeMap);   // the cached base list; Google is layered on below
    const radius = this.radius(s);
    const key = `${(Math.round(lat / GRID) * GRID).toFixed(2)},${(Math.round(lon / GRID) * GRID).toFixed(2)},${radius}`;
    let entry = this.mem.get(key) ?? this.fromDb(key);
    let message: string | null = null;

    if (!haveKeys && !entry && !s.keys.googlePlaces) {
      return { chargers: [], message: 'No charger API keys yet. Add a free NREL AFDC or Open Charge Map key on the settings page (/settings).' };
    }
    if (haveKeys && (!entry || Date.now() - entry.at > CACHE_TTL_MS)) {
      try {
        const stations = await this.fetchOnce(key, lat, lon, radius, s);
        entry = { at: Date.now(), stations };
        this.mem.set(key, entry);
        this.db.prepare('INSERT INTO charger_cache (key, fetched_at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body')
          .run(key, entry.at, JSON.stringify(stations));
      } catch (e) {
        message = entry ? `Showing saved results from ${new Date(entry.at).toLocaleString()}: ${(e as Error).message}` : `Couldn't reach the charger databases: ${(e as Error).message}`;
      }
    }
    const google = await this.googleLayer(lat, lon, radius, s);
    if (!entry && !google.length) return { chargers: [], message };
    if (!haveKeys && !s.keys.googlePlaces) message = 'No API keys set; showing saved results only.';
    const partial = this.lastErr.get(key);
    if (!message && partial) message = partial;
    if (!message && this.googleErr) message = `Live stall counts unavailable: ${this.googleErr}`;
    const stations = this.withPerf(withLastPaid(mergeGoogle(entry?.stations ?? [], google), this.paidSessions()));
    return { chargers: rankChargers(stations, { lat, lon }, soc, s, haversineMi), message };
  }

  /**
   * Stations around any point (a trip planner's sample along a route), from the
   * same cache as find(), with what you paid joined in. Unscored. A failed fetch
   * with nothing cached is [] plus the reason.
   */
  async stationsAround(lat: number, lon: number, radiusMi: number, s: FinderSettings): Promise<{ stations: Station[]; error: string | null }> {
    const key = `${(Math.round(lat / GRID) * GRID).toFixed(2)},${(Math.round(lon / GRID) * GRID).toFixed(2)},${radiusMi}`;
    let entry = this.mem.get(key) ?? this.fromDb(key);
    let error: string | null = null;
    if ((s.keys.afdc || s.keys.openChargeMap) && (!entry || Date.now() - entry.at > CACHE_TTL_MS)) {
      try {
        const stations = await this.fetchOnce(key, lat, lon, radiusMi, s);
        entry = { at: Date.now(), stations };
        this.mem.set(key, entry);
        this.db.prepare('INSERT INTO charger_cache (key, fetched_at, body) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body')
          .run(key, entry.at, JSON.stringify(stations));
      } catch (e) { error = (e as Error).message; }
    } else if (!s.keys.afdc && !s.keys.openChargeMap) error = 'No charger API keys yet (settings page).';
    return { stations: this.withPerf(withLastPaid(entry?.stations ?? [], this.paidSessions())), error };
  }

  private live = new Map<string, { at: number; stations: Station[] }>();
  /**
   * Live stall counts right around one stop (Google Places), for the trip's
   * check before arriving. Billed, so each spot is asked at most every
   * GOOGLE_MIN_INTERVAL_MS. [] without a key or on failure.
   */
  async liveAround(lat: number, lon: number, s: FinderSettings): Promise<Station[]> {
    const k = s.keys.googlePlaces;
    if (!k) return [];
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = this.live.get(key);
    if (hit && Date.now() - hit.at < GOOGLE_MIN_INTERVAL_MS) return hit.stations;
    try {
      const stations = await fetchGoogle(k, lat, lon, 2, this.fetchFn);
      this.live.set(key, { at: Date.now(), stations });
      return stations;
    } catch (e) {
      console.warn('[chargers] Google (trip check):', (e as Error).message);
      this.live.set(key, { at: Date.now(), stations: hit?.stations ?? [] });
      return hit?.stations ?? [];
    }
  }

  /** The Google layer, refreshed at most every GOOGLE_MIN_INTERVAL_MS; [] without a key. */
  private async googleLayer(lat: number, lon: number, radius: number, s: FinderSettings): Promise<Station[]> {
    const k = s.keys.googlePlaces;
    if (!k) { this.google = null; this.googleErr = null; return []; }
    if (Date.now() - this.googleTriedAt >= GOOGLE_MIN_INTERVAL_MS) {
      this.googleTriedAt = Date.now();
      this.googleInflight ??= fetchGoogle(k, lat, lon, radius, this.fetchFn)
        .then((stations) => { this.google = { at: Date.now(), stations }; this.googleErr = null; })
        .catch((e) => { this.googleErr = (e as Error)?.message ?? String(e); console.warn('[chargers] Google:', this.googleErr); })
        .finally(() => { this.googleInflight = null; });
    }
    if (this.googleInflight) await this.googleInflight;
    return this.google && Date.now() - this.google.at <= GOOGLE_KEEP_MS ? this.google.stations : [];
  }

  /** Public sessions with a cost, newest first, for the "you paid" line. */
  private paidSessions(): PaidSession[] {
    try {
      const rows = this.db.prepare(`SELECT id, started_at, network, station_name, lat, lon, kwh, cost FROM charge_sessions
        WHERE place = 'public' AND cost IS NOT NULL AND cost > 0 ORDER BY started_at DESC LIMIT 1000`).all() as
        { id: number; started_at: string; network: string | null; station_name: string | null; lat: number | null; lon: number | null; kwh: number | null; cost: number }[];
      return rows.map((r) => ({ id: r.id, startedAt: r.started_at, network: r.network, stationName: r.station_name, lat: r.lat, lon: r.lon, kwh: r.kwh, cost: r.cost }));
    } catch { return []; }
  }

  /** Nearest station seen in any cached result, for labelling a detected charge. No network call. */
  nearestKnown(lat: number, lon: number, withinM = 250): Station | null {
    let best: Station | null = null, bestD = Infinity;
    const scan = (st: Station[]) => { for (const x of st) { const d = metersBetween({ lat, lon }, x); if (d < bestD && d <= withinM) { best = x; bestD = d; } } };
    for (const e of this.mem.values()) scan(e.stations);
    if (!best) {
      const rows = this.db.prepare('SELECT body FROM charger_cache WHERE fetched_at > ?').all(Date.now() - STALE_OK_MS) as { body: string }[];
      for (const r of rows) { try { scan(JSON.parse(r.body)); } catch {} }
    }
    return best;
  }

  private fromDb(key: string) {
    const row = this.db.prepare('SELECT fetched_at, body FROM charger_cache WHERE key = ?').get(key) as { fetched_at: number; body: string } | undefined;
    if (!row || Date.now() - row.fetched_at > STALE_OK_MS) return undefined;
    try { const e = { at: row.fetched_at, stations: JSON.parse(row.body) as Station[] }; this.mem.set(key, e); return e; } catch { return undefined; }
  }

  private fetchOnce(key: string, lat: number, lon: number, radius: number, s: FinderSettings): Promise<Station[]> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async () => {
      const jobs: [string, Promise<Station[]>][] = [];
      if (s.keys.afdc) jobs.push(['AFDC', fetchAfdc(s.keys.afdc, lat, lon, radius, this.fetchFn)]);
      if (s.keys.openChargeMap) jobs.push(['Open Charge Map', fetchOcm(s.keys.openChargeMap, lat, lon, radius, this.fetchFn)]);
      const res = await Promise.allSettled(jobs.map((j) => j[1]));
      const errs = res.map((r, i) => (r.status === 'rejected' ? `${jobs[i][0]}: ${(r.reason as Error)?.message ?? r.reason}` : null)).filter(Boolean) as string[];
      if (errs.length === jobs.length) throw new Error(errs.join('; '));
      if (errs.length) { this.lastErr.set(key, `Partial results. ${errs.join('; ')}`); console.warn('[chargers]', errs.join('; ')); }
      else this.lastErr.delete(key);
      const get = (name: string) => { const i = jobs.findIndex((j) => j[0] === name); return i >= 0 && res[i].status === 'fulfilled' ? (res[i] as PromiseFulfilledResult<Station[]>).value : []; };
      return mergeStations(get('AFDC'), get('Open Charge Map'));
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
