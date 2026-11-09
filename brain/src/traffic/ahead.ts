// What is ahead of the truck: along the road-trip route when there is one
// (miles along it), otherwise in the direction it's heading (straight line).
// Pure.
import { haversineMi } from '../geo.ts';
import { locate, type Route } from '../roadtrip/route.ts';

export type Where = { lat: number; lon: number };
import type { Ahead } from './types.ts';
export type { Ahead } from './types.ts';

/** Bearing from a to b, degrees 0-360. */
export function bearing(a: Where, b: Where): number {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
const angle = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export type AheadOpts = {
  here: Where;
  /** Degrees, or null when parked / unknown. */
  heading: number | null;
  /** The active trip's route and where the truck is on it. */
  route: { route: Route; mi: number } | null;
  /** How far ahead to look, and how far off the route (or the heading line) counts. */
  maxMi: number;
  offMi: number;
  /** With no heading: anything this close, any direction. */
  nearMi?: number;
  /** Half-width of the cone ahead when following the heading. */
  coneDeg?: number;
};

export function ahead<T extends Where>(items: T[], o: AheadOpts): Ahead<T>[] {
  const out: Ahead<T>[] = [];
  for (const it of items) {
    if (o.route) {
      const at = locate(o.route.route, it);
      const d = at.mi - o.route.mi;
      if (at.offMi <= o.offMi && d > -0.2 && d <= o.maxMi) { out.push({ ...it, distMi: Math.max(0, Math.round(d * 10) / 10), onRoute: true }); continue; }
    }
    const d = haversineMi(o.here, it);
    if (o.heading === null) {
      if (d <= (o.nearMi ?? 10)) out.push({ ...it, distMi: Math.round(d * 10) / 10, onRoute: false });
      continue;
    }
    if (d > o.maxMi) continue;
    // In the cone ahead, and close to the straight line forward (a parallel road 5 miles over isn't ahead).
    const off = angle(bearing(o.here, it), o.heading);
    const sideways = d * Math.sin((Math.min(off, 90) * Math.PI) / 180);
    if (d < 0.3 || (off <= (o.coneDeg ?? 30) && sideways <= Math.max(o.offMi, 1.5))) out.push({ ...it, distMi: Math.round(d * 10) / 10, onRoute: false });
  }
  return out.sort((a, b) => a.distMi - b.distMi);
}
