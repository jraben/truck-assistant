// Charger finder: fetch (AFDC + OCM), cache in SQLite, score per request.
// Offline-first: a stale cache beats an error.
import type { Db } from '../db.ts';
import { haversineMi, metersBetween } from '../geo.ts';
import type { Charger, ChargingPrefs, Settings } from '../types.ts';

/** Truck settings plus the active driver's charging prefs. */
export type FinderSettings = Pick<Settings, 'keys' | 'packKwh' | 'efficiencyMiPerKwh'> & { charging: ChargingPrefs };
import { rankChargers, type Station } from './score.ts';
import { fetchAfdc, fetchOcm, mergeStations, type FetchFn } from './sources.ts';

export const CACHE_TTL_MS = 30 * 60_000;
export const STALE_OK_MS = 14 * 24 * 3600_000;
/** Snap requests to a ~0.7 mi grid so a moving truck reuses one fetch. */
const GRID = 0.01;

export type FindResult = { chargers: Charger[]; message: string | null };

export class ChargerFinder {
  private mem = new Map<string, { at: number; stations: Station[] }>();
  private inflight = new Map<string, Promise<Station[]>>();
  private lastErr = new Map<string, string>();

  private db: Db;
  private fetchFn: FetchFn;

  constructor(db: Db, fetchFn: FetchFn = fetch) { this.db = db; this.fetchFn = fetchFn; }

  private radius(s: FinderSettings) { return Math.max(15, Math.ceil(s.charging.maxDetourMi * 2.5)); }

  async find(lat: number, lon: number, soc: number | null, s: FinderSettings): Promise<FindResult> {
    const haveKeys = !!(s.keys.afdc || s.keys.openChargeMap);
    const radius = this.radius(s);
    const key = `${(Math.round(lat / GRID) * GRID).toFixed(2)},${(Math.round(lon / GRID) * GRID).toFixed(2)},${radius}`;
    let entry = this.mem.get(key) ?? this.fromDb(key);
    let message: string | null = null;

    if (!haveKeys && !entry) {
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
    if (!entry) return { chargers: [], message };
    if (!haveKeys) message = 'No API keys set; showing saved results only.';
    const partial = this.lastErr.get(key);
    if (!message && partial) message = partial;
    return { chargers: rankChargers(entry.stations, { lat, lon }, soc, s, haversineMi), message };
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
