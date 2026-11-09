// 511 feeds: cameras and events (crashes, closures, roadwork) in one shape.
// Field names as the AZ511/511WI endpoint pages give them (2026-11-08);
// anything missing is null, never guessed.
import type { State511 } from './states.ts';

import type { TrafficCamera, TrafficEvent } from './types.ts';
export type { TrafficCamera, TrafficEvent } from './types.ts';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** Unix time in seconds (the docs' samples) or milliseconds (told apart by size). */
const time = (v: unknown) => { const n = num(v); return n === null || n <= 0 ? null : new Date(n < 1e11 ? n * 1000 : n).toISOString(); };
const get = (o: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (o[k] !== undefined) return o[k]; return undefined; };

export function parseCameras(body: unknown, state: string): TrafficCamera[] {
  if (!Array.isArray(body)) return [];
  const out: TrafficCamera[] = [];
  for (const r of body as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const lat = num(get(r, 'Latitude', 'latitude')), lon = num(get(r, 'Longitude', 'longitude'));
    const id = get(r, 'Id', 'ID', 'id');
    if (lat === null || lon === null || id === undefined || (lat === 0 && lon === 0)) continue;
    const rawViews = get(r, 'Views', 'views');
    const views = (Array.isArray(rawViews) ? rawViews : rawViews && typeof rawViews === 'object' ? [rawViews] : []) as Record<string, unknown>[];
    const ok = views
      .filter((v) => v && str(get(v, 'Url', 'url')) && !/disabled/i.test(String(get(v, 'Status', 'status') ?? '')))
      .map((v) => ({ url: str(get(v, 'Url', 'url'))!, description: str(get(v, 'Description', 'description')) }));
    if (!ok.length) continue;
    out.push({ key: `${state}:${String(id)}`, state, roadway: str(get(r, 'Roadway', 'roadway')), direction: str(get(r, 'Direction', 'direction')), location: str(get(r, 'Location', 'location')), lat, lon, views: ok });
  }
  return out;
}

function eventType(t: string | null, sub: string | null, full: boolean): TrafficEvent['type'] {
  const s = `${t ?? ''} ${sub ?? ''}`.toLowerCase();
  if (/accident|incident|crash|collision|disabled vehicle/.test(s)) return 'crash';
  if (full || /closure/.test(s)) return 'closure';
  if (/roadwork|construction|work zone|maintenance/.test(s)) return 'roadwork';
  return 'other';
}

export function parseEvents(body: unknown, state: string): TrafficEvent[] {
  if (!Array.isArray(body)) return [];
  const out: TrafficEvent[] = [];
  for (const r of body as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const lat = num(get(r, 'Latitude', 'latitude')), lon = num(get(r, 'Longitude', 'longitude'));
    const id = get(r, 'ID', 'Id', 'id');
    if (lat === null || lon === null || id === undefined) continue;
    const t = str(get(r, 'EventType', 'eventType')), sub = str(get(r, 'EventSubType', 'eventSubType'));
    const full = get(r, 'IsFullClosure', 'isFullClosure') === true;
    out.push({
      key: `${state}:${String(id)}`, state, type: eventType(t, sub, full), subType: sub,
      roadway: str(get(r, 'RoadwayName', 'Roadway')), direction: str(get(r, 'DirectionOfTravel', 'Direction')),
      description: str(get(r, 'Description', 'description')), lat, lon, fullClosure: full,
      lanes: str(get(r, 'LanesAffected')), startsAt: time(get(r, 'StartDate')), endsAt: time(get(r, 'PlannedEndDate')), updatedAt: time(get(r, 'LastUpdated')),
    });
  }
  return out;
}

export class FeedError extends Error {}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try { res = await fetchFn(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } }); }
  catch (e) { throw new FeedError(`not reachable (${(e as Error).message})`); }
  if (res.status === 401 || res.status === 403) throw new FeedError('refused the developer key (check it on the settings page)');
  if (res.status === 429) throw new FeedError('rate-limited (ten calls a minute); will retry');
  if (!res.ok) throw new FeedError(`answered ${res.status}`);
  try { return await res.json(); } catch { throw new FeedError('sent something that is not JSON (the API may differ for this state)'); }
}

export async function fetchCameras(s: State511, key: string, fetchFn: typeof fetch = fetch): Promise<TrafficCamera[]> {
  return parseCameras(await getJson(`${s.base}/api/v2/get/cameras?key=${encodeURIComponent(key)}&format=json`, fetchFn), s.id);
}

export async function fetchEvents(s: State511, key: string, fetchFn: typeof fetch = fetch): Promise<TrafficEvent[]> {
  return parseEvents(await getJson(`${s.base}/api/v2/get/event?key=${encodeURIComponent(key)}&format=json`, fetchFn), s.id);
}
