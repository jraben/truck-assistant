// The gas vehicle to compare against, from fueleconomy.gov's free web service
// (no key). Shapes checked against the live service 2026-11-05:
//   /ws/rest/vehicle/menu/year | make?year= | model?year=&make= | options?year=&make=&model=
//     -> {"menuItem":[{"text":"…","value":"…"}]}, or {"menuItem":{…}} when there
//        is exactly one item, or null when there are none (XML-to-JSON quirks)
//   /ws/rest/vehicle/<id> -> {id, year, make, model, city08, highway08, comb08, fuelType1, …}
//     with every number as a string; fuelType1 e.g. "Regular Gasoline", "Premium Gasoline", "Diesel"
// Answers are cached in SQLite for good: model-year data doesn't change.
import type { Db } from '../db.ts';
import type { CompareVehicle, FuelGrade } from '../types.ts';

export const FE_BASE = 'https://www.fueleconomy.gov/ws/rest/vehicle';

export class VehicleError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type MenuItem = { text: string; value: string };
export type MenuLevel = 'year' | 'make' | 'model' | 'options';

export function menuItems(body: unknown): MenuItem[] {
  if (!body || typeof body !== 'object') return [];
  const m = (body as { menuItem?: unknown }).menuItem;
  const list = Array.isArray(m) ? m : m && typeof m === 'object' ? [m] : [];
  return list.filter((x): x is MenuItem => !!x && typeof (x as MenuItem).text === 'string' && (x as MenuItem).value !== undefined)
    .map((x) => ({ text: x.text, value: String(x.value) }));
}

export function fuelGrade(fuelType1: unknown): FuelGrade {
  const f = String(fuelType1 ?? '').toLowerCase();
  if (f.includes('diesel')) return 'diesel';
  if (f.includes('premium')) return 'premium';
  if (f.includes('midgrade')) return 'midgrade';
  return 'regular';
}

export function vehicleFrom(body: unknown): CompareVehicle {
  if (!body || typeof body !== 'object') throw new VehicleError(404, 'No such vehicle at fueleconomy.gov');
  const v = body as Record<string, unknown>;
  const n = (k: string) => Number(v[k]);
  const city = n('city08'), hwy = n('highway08'), comb = n('comb08'), id = n('id');
  if (!(city > 0) || !(hwy > 0) || !(comb > 0)) throw new VehicleError(422, 'fueleconomy.gov has no mpg for that vehicle (is it electric?)');
  return {
    id: Number.isInteger(id) && id > 0 ? id : null,
    label: [v.year, v.make, v.model].filter((x) => x !== undefined && x !== '').join(' ').slice(0, 80),
    mpgCity: city, mpgHighway: hwy, mpgCombined: comb,
    fuel: fuelGrade(v.fuelType1),
  };
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class VehicleLookup {
  private db: Db;
  private fetchFn: Fetch;
  constructor(db: Db, fetchFn: Fetch = fetch as unknown as Fetch) { this.db = db; this.fetchFn = fetchFn; }

  private async getJson(path: string): Promise<unknown> {
    const key = `fe:${path}`;
    const hit = this.db.prepare('SELECT body FROM http_cache WHERE key = ?').get(key) as { body: string } | undefined;
    if (hit) return JSON.parse(hit.body);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    let text: string;
    try {
      const res = await this.fetchFn(FE_BASE + path, { headers: { accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) throw new VehicleError(res.status === 404 ? 404 : 502, `fueleconomy.gov answered ${res.status}`);
      text = await res.text();
    } catch (e) {
      if (e instanceof VehicleError) throw e;
      throw new VehicleError(503, 'fueleconomy.gov not reachable (offline?). Type the mpg in as "Custom" instead.');
    } finally { clearTimeout(timer); }
    let body: unknown;
    try { body = text.trim() ? JSON.parse(text) : null; } catch { throw new VehicleError(502, 'fueleconomy.gov sent something that is not JSON'); }
    this.db.prepare('INSERT OR REPLACE INTO http_cache (key, fetched_at, body) VALUES (?, ?, ?)').run(key, new Date().toISOString(), JSON.stringify(body));
    return body;
  }

  async menu(level: MenuLevel, q: { year?: string; make?: string; model?: string }): Promise<MenuItem[]> {
    const need: Record<MenuLevel, (keyof typeof q)[]> = { year: [], make: ['year'], model: ['year', 'make'], options: ['year', 'make', 'model'] };
    for (const k of need[level]) if (!q[k]) throw new VehicleError(400, `${level} needs ${need[level].join(', ')}`);
    const qs = need[level].map((k) => `${k}=${encodeURIComponent(q[k]!)}`).join('&');
    return menuItems(await this.getJson(`/menu/${level}${qs ? `?${qs}` : ''}`));
  }

  async vehicle(id: number): Promise<CompareVehicle> {
    if (!Number.isInteger(id) || id <= 0) throw new VehicleError(400, 'vehicle id must be a whole number');
    return vehicleFrom(await this.getJson(`/${id}`));
  }
}
