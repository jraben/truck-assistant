// Offline maps: tile maths. Pure. Web Mercator "slippy map" tiles, z/x/y with y down.

/** [west, south, east, north] in degrees. */
export type Bbox = [number, number, number, number];

/** Protomaps' daily builds stop at z15; past that the cockpit over-zooms. */
export const MAX_ZOOM = 15;
/** One area may not ask for more than this (a whole state at z15 would be millions). */
export const MAX_AREA_TILES = 400_000;
const MAX_LAT = 85.0511287798;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function lonToX(lon: number, z: number): number {
  const n = 2 ** z;
  return clamp(Math.floor(((lon + 180) / 360) * n), 0, n - 1);
}
export function latToY(lat: number, z: number): number {
  const n = 2 ** z;
  const r = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
  return clamp(Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n), 0, n - 1);
}

/** The tiles covering a bbox at one zoom, inclusive. */
export function tileRange(b: Bbox, z: number): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: lonToX(b[0], z), x1: lonToX(b[2], z), y0: latToY(b[3], z), y1: latToY(b[1], z) };
}

export function countTiles(b: Bbox, maxZoom: number, minZoom = 0): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) { const r = tileRange(b, z); n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  return n;
}

/** A square bbox `radiusMi` either side of a point. */
export function bboxAround(lat: number, lon: number, radiusMi: number): Bbox {
  const dLat = radiusMi / 69.0;
  const dLon = radiusMi / (69.17 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [clamp(lon - dLon, -180, 180), clamp(lat - dLat, -MAX_LAT, MAX_LAT), clamp(lon + dLon, -180, 180), clamp(lat + dLat, -MAX_LAT, MAX_LAT)];
}

/** A bbox from untrusted input, or an error message. Antimeridian-crossing boxes are refused. */
export function parseBbox(v: unknown): Bbox | string {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'bbox must be [west, south, east, north]';
  const [w, s, e, n] = v as number[];
  if (w < -180 || e > 180 || s < -90 || n > 90) return 'bbox is outside the world';
  if (w >= e || s >= n) return 'bbox must have west < east and south < north';
  return [w, Math.max(s, -MAX_LAT), e, Math.min(n, MAX_LAT)];
}

/** Does bbox `a` cover tile z/x/y entirely-or-partly (i.e. would downloading `a` at z have fetched it)? */
export function bboxHasTile(a: Bbox, z: number, x: number, y: number): boolean {
  const r = tileRange(a, z);
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}
