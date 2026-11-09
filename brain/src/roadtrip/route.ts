// A road route for trip planning: geometry and duration from an OSRM server,
// elevation from Open-Meteo, and the geometry helpers the planner needs
// (miles along the route, where a charger sits on it, how far off it is).
//
// Navigation itself stays in Waze; this route only has to be good enough to
// say how much energy each leg takes and which chargers are on the way.
import { haversineMi } from '../geo.ts';

/** OSRM's public demo server. Light personal use only; ROUTER_URL points at your own. */
export const DEFAULT_ROUTER = 'https://router.project-osrm.org';
export const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const TIMEOUT_MS = 15_000;

export type LatLon = { lat: number; lon: number };
/** A route point with its distance from the start and its elevation (m, null if unknown). */
export type RoutePoint = LatLon & { mi: number; elevM: number | null };
export type Route = {
  points: RoutePoint[];
  miles: number;
  /** The router's driving time, minutes. */
  minutes: number;
  /** Where the route came from: the router, or a straight line when none answered. */
  source: 'osrm' | 'straight';
  elevation: boolean;
};

type FetchFn = typeof fetch;

/** Thin the polyline to about one point per `stepMi`, keeping the ends. */
export function thin(points: LatLon[], stepMi: number): LatLon[] {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length - 1; i++) {
    acc += haversineMi(points[i - 1], points[i]);
    if (acc >= stepMi) { out.push(points[i]); acc = 0; }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function withMiles(points: LatLon[]): RoutePoint[] {
  let mi = 0;
  return points.map((p, i) => {
    if (i > 0) mi += haversineMi(points[i - 1], p);
    return { lat: p.lat, lon: p.lon, mi, elevM: null };
  });
}

/** Road route from the router, or (offline) a straight line padded by 25% for roads and labelled as such. */
export async function fetchRoute(from: LatLon, to: LatLon, opts: { router?: string; fetchFn?: FetchFn } = {}): Promise<Route> {
  const f = opts.fetchFn ?? fetch;
  const base = (opts.router ?? DEFAULT_ROUTER).replace(/\/$/, '');
  const url = `${base}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try {
    const r = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'truck-assistant (DIY dash)' } });
    if (!r.ok) throw new Error(`router answered ${r.status}`);
    const j = await r.json() as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const route = j.routes?.[0];
    if (j.code !== 'Ok' || !route) throw new Error(`router: ${j.code ?? 'no route'}`);
    const pts = thin(route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })), 1);
    const withMi = withMiles(pts);
    // Scale the summed polyline to the router's own distance (thinning cuts corners).
    const routerMi = route.distance / 1609.344;
    const k = withMi.at(-1)!.mi > 0 ? routerMi / withMi.at(-1)!.mi : 1;
    for (const p of withMi) p.mi *= k;
    return { points: withMi, miles: routerMi, minutes: route.duration / 60, source: 'osrm', elevation: false };
  } catch (e) {
    const miles = haversineMi(from, to) * 1.25;
    const n = Math.max(2, Math.ceil(miles / 5));
    const pts = Array.from({ length: n + 1 }, (_, i) => ({ lat: from.lat + (to.lat - from.lat) * (i / n), lon: from.lon + (to.lon - from.lon) * (i / n) }));
    const withMi = withMiles(pts).map((p) => ({ ...p, mi: p.mi * 1.25 }));
    console.warn(`[roadtrip] no road route (${(e as Error).message}); planning on a straight line`);
    return { points: withMi, miles, minutes: (miles / 60) * 60, source: 'straight', elevation: false };
  }
}

/**
 * Add elevations (Open-Meteo, 100 points a call). One point every 2 miles, or
 * fewer on a long route (at most ~300: Open-Meteo counts each point as a call
 * and answers 429 past its free per-minute limit). A failure leaves them null.
 */
export async function addElevation(route: Route, fetchFn: FetchFn = fetch): Promise<Route> {
  const idx: number[] = [];
  let last = -Infinity;
  const step = Math.max(2, route.miles / 300);
  route.points.forEach((p, i) => { if (p.mi - last >= step || i === route.points.length - 1) { idx.push(i); last = p.mi; } });
  try {
    for (let b = 0; b < idx.length; b += 100) {
      const chunk = idx.slice(b, b + 100);
      const u = new URL(ELEVATION_URL);
      u.searchParams.set('latitude', chunk.map((i) => route.points[i].lat.toFixed(5)).join(','));
      u.searchParams.set('longitude', chunk.map((i) => route.points[i].lon.toFixed(5)).join(','));
      if (b > 0) await new Promise((res) => setTimeout(res, 1000));   // pace the calls
      let r = await fetchFn(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 5000)); r = await fetchFn(u, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
      if (!r.ok) throw new Error(`elevation answered ${r.status}`);
      const j = await r.json() as { elevation?: number[] };
      if (!Array.isArray(j.elevation) || j.elevation.length !== chunk.length) throw new Error('elevation: wrong shape');
      chunk.forEach((i, k) => { route.points[i].elevM = Number.isFinite(j.elevation![k]) ? j.elevation![k] : null; });
    }
    // Fill the points between samples by distance.
    let prev = -1;
    for (const i of idx) {
      if (prev >= 0) {
        const a = route.points[prev], b = route.points[i];
        for (let k = prev + 1; k < i; k++) {
          const p = route.points[k];
          p.elevM = a.elevM !== null && b.elevM !== null && b.mi > a.mi ? a.elevM + (b.elevM - a.elevM) * ((p.mi - a.mi) / (b.mi - a.mi)) : null;
        }
      }
      prev = i;
    }
    route.elevation = route.points.every((p) => p.elevM !== null);
  } catch (e) {
    console.warn(`[roadtrip] no elevation (${(e as Error).message}); climbs not counted`);
    for (const p of route.points) p.elevM = null;
    route.elevation = false;
  }
  return route;
}

/** Where a point sits on the route: miles along it, and how far off it (straight line). */
export function locate(route: Route, p: LatLon): { mi: number; offMi: number; index: number } {
  let best = { mi: 0, offMi: Infinity, index: 0 };
  const pts = route.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // Project in a local flat frame (miles); fine at highway scale.
    const kx = Math.cos((a.lat * Math.PI) / 180) * 69.17, ky = 69.05;
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky;
    const px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const dx = px - t * bx, dy = py - t * by;
    const off = Math.sqrt(dx * dx + dy * dy);
    if (off < best.offMi) best = { mi: a.mi + t * (b.mi - a.mi), offMi: off, index: i };
  }
  return best;
}

/** The point at a given mile (linear between points). */
export function pointAt(route: Route, mi: number): RoutePoint {
  const pts = route.points;
  if (mi <= 0) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].mi >= mi) {
      const a = pts[i - 1], b = pts[i];
      const t = b.mi > a.mi ? (mi - a.mi) / (b.mi - a.mi) : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, mi, elevM: a.elevM !== null && b.elevM !== null ? a.elevM + (b.elevM - a.elevM) * t : null };
    }
  }
  return pts[pts.length - 1];
}

/** Total climb and descent (m) between two miles. */
export function climb(route: Route, fromMi: number, toMi: number): { up: number; down: number } {
  let up = 0, down = 0;
  let prev: number | null = pointAt(route, fromMi).elevM;
  for (const p of route.points) {
    if (p.mi <= fromMi || p.mi >= toMi) continue;
    if (prev !== null && p.elevM !== null) { const d = p.elevM - prev; if (d > 0) up += d; else down -= d; }
    prev = p.elevM;
  }
  const end = pointAt(route, toMi).elevM;
  if (prev !== null && end !== null) { const d = end - prev; if (d > 0) up += d; else down -= d; }
  return { up, down };
}

/** Sample points every `stepMi` along the route, for charger searches. */
export function samplePoints(route: Route, stepMi: number): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (let mi = 0; mi < route.miles; mi += stepMi) out.push(pointAt(route, mi));
  out.push(route.points[route.points.length - 1]);
  return out;
}

/**
 * A route through stops: each leg fetched on its own and joined into one, with
 * the mile where each leg ends (the stops, then the destination).
 */
export async function fetchRouteVia(points: LatLon[], opts: { router?: string; fetchFn?: FetchFn } = {}): Promise<{ route: Route; legEnds: number[] }> {
  if (points.length < 2) throw new Error('a route needs a start and an end');
  const legs: Route[] = [];
  for (let i = 0; i < points.length - 1; i++) legs.push(await fetchRoute(points[i], points[i + 1], opts));
  const out: RoutePoint[] = [];
  const legEnds: number[] = [];
  let offset = 0, minutes = 0;
  legs.forEach((l, i) => {
    for (const [k, p] of l.points.entries()) if (!(i > 0 && k === 0)) out.push({ ...p, mi: p.mi + offset });
    offset += l.miles; minutes += l.minutes;
    legEnds.push(offset);
  });
  return { route: { points: out, miles: offset, minutes, source: legs.every((l) => l.source === 'osrm') ? 'osrm' : 'straight', elevation: false }, legEnds };
}
