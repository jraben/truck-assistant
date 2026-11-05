export type LatLon = { lat: number; lon: number };

const R_MI = 3958.7613;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMi(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const metersBetween = (a: LatLon, b: LatLon) => haversineMi(a, b) * 1609.344;

/** Initial bearing a -> b in degrees 0..360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Perpendicular distance (m) of p from segment a-b, on a local flat projection. */
function segDistM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos(toRad(p.lat)) * 111_320;
  const ax = a.lon * k, ay = a.lat * 110_540, bx = b.lon * k, by = b.lat * 110_540, px = p.lon * k, py = p.lat * 110_540;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker simplification with a tolerance in metres. Keeps first and last. */
export function simplify<T extends LatLon>(pts: T[], tolM: number): T[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistM(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tolM) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
