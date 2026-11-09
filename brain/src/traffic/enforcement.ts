// Speed and red-light camera locations from OpenStreetMap (Overpass), the
// same public source the speed limits come from. Police don't publish live
// cameras; enforcement camera locations are public. Mapped by volunteers, so
// coverage varies by town; the screen says where the data comes from.
import { OVERPASS_URLS } from '../drive/maxspeed.ts';

import type { EnforcementCam } from './types.ts';
export type { EnforcementCam } from './types.ts';

export function enforcementQuery(lat: number, lon: number, radiusM: number): string {
  const a = `around:${Math.round(radiusM)},${lat.toFixed(4)},${lon.toFixed(4)}`;
  return `[out:json][timeout:25];(node["highway"="speed_camera"](${a});node["enforcement"](${a});relation["type"="enforcement"](${a}););out center tags;`;
}

/** Overpass JSON → cameras. Relations use their "device" member's position when Overpass gives a center. */
export function parseEnforcement(body: unknown): EnforcementCam[] {
  const els = (body as { elements?: Record<string, unknown>[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out: EnforcementCam[] = [];
  for (const e of els) {
    const tags = (e.tags ?? {}) as Record<string, string>;
    const c = e.center as { lat?: number; lon?: number } | undefined;
    const lat = typeof e.lat === 'number' ? e.lat : c?.lat, lon = typeof e.lon === 'number' ? e.lon : c?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const what = `${tags.highway ?? ''} ${tags.enforcement ?? ''}`.toLowerCase();
    const kind = /traffic_signals|red/.test(what) ? 'red-light' : /speed|maxspeed|average_speed/.test(what) ? 'speed' : 'other';
    out.push({ key: `osm:${e.type}/${e.id}`, kind, lat, lon, maxspeed: tags.maxspeed ?? null, name: tags.name ?? tags.description ?? null });
  }
  return out;
}

export async function fetchEnforcement(lat: number, lon: number, radiusM: number, fetchFn: typeof fetch = fetch, ua = 'truck-assistant'): Promise<EnforcementCam[]> {
  let last: Error | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetchFn(url, { method: 'POST', body: new URLSearchParams({ data: enforcementQuery(lat, lon, radiusM) }), headers: { 'user-agent': ua }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
      return parseEnforcement(await res.json());
    } catch (e) { last = e as Error; }
  }
  throw last ?? new Error('Overpass unreachable');
}
