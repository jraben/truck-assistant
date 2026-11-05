// Stop naming, first match wins, each within its own radius:
//   1. saved places (named by a driver)   2. Home Assistant zones
//   3. the places feed                    4. OSM reverse geocode (async, cached)
//   5. nothing: "Unnamed stop"
// Pure; the geocode step lives in geocode.ts.
import { metersBetween, type LatLon } from '../geo.ts';

export const DEFAULT_RADIUS_M = 120;

export type Area = LatLon & { name: string; radiusM?: number; placeId?: number };
export type NameSource = 'place' | 'zone' | 'feed' | 'geocode';
export type Naming = { name: string; source: NameSource; placeId: number | null };

/** The nearest area whose radius contains p, or null. */
export function nearestArea<T extends Area>(p: LatLon, areas: T[]): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const a of areas) {
    const d = metersBetween(p, a);
    if (d <= (a.radiusM ?? DEFAULT_RADIUS_M) && d < bestD) { best = a; bestD = d; }
  }
  return best;
}

export function resolveName(p: LatLon, tiers: { places: Area[]; zones: Area[]; feed: Area[] }): Naming | null {
  const place = nearestArea(p, tiers.places);
  if (place) return { name: place.name, source: 'place', placeId: place.placeId ?? null };
  const zone = nearestArea(p, tiers.zones);
  if (zone) return { name: zone.name, source: 'zone', placeId: null };
  const feed = nearestArea(p, tiers.feed);
  if (feed) return { name: feed.name, source: 'feed', placeId: null };
  return null;
}

/** A places feed answer -> areas. Tolerant: skips rows without a name and coordinates. */
export function parseFeed(body: unknown): Area[] {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { places?: unknown }).places) ? (body as { places: unknown[] }).places : [];
  const out: Area[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const lat = Number(x.lat ?? x.latitude), lon = Number(x.lon ?? x.lng ?? x.longitude);
    const name = typeof x.name === 'string' ? x.name.trim() : '';
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const radius = Number(x.radiusM ?? x.radius_m ?? x.radius);
    out.push({ name: name.slice(0, 80), lat, lon, radiusM: Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS_M });
  }
  return out;
}
