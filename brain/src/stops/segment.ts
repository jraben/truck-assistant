// Batch: a list of timed positions -> stops and the trips between them. Used
// for phone history; the live truck runs the same StopDetector sample by sample.
import { haversineMi, type LatLon } from '../geo.ts';
import { StopDetector, type StopSample } from './detector.ts';

export type SegStop = { arrivedAt: number; departedAt: number | null; lat: number; lon: number; reason: 'ignition' | 'dwell' };
export type SegTrip = {
  startedAt: number; endedAt: number;
  points: (LatLon & { t: number; speedMph: number | null })[];
  miles: number;                     // straight lines between the points
  fromStop: number | null; toStop: number | null;   // indexes into stops
};
export type Segmented = { stops: SegStop[]; trips: SegTrip[] };

/** Trips shorter than this (straight-line) are GPS wander, not a drive. */
export const MIN_TRIP_MI = 0.1;

/** endAt: the end of the range the samples cover (a dwell at the very end counts up to it). */
export function segment(samples: StopSample[], endAt?: number): Segmented {
  const pts = [...samples].sort((a, b) => a.t - b.t).filter((p, i, a) => i === 0 || p.t !== a[i - 1].t);
  const det = new StopDetector();
  const stops: SegStop[] = [];
  for (const p of pts) {
    for (const e of det.update(p)) {
      if (e.type === 'arrive') stops.push({ arrivedAt: e.at, departedAt: null, lat: e.lat, lon: e.lon, reason: e.reason });
      else {
        const s = stops[stops.length - 1];
        if (e.short) stops.pop(); else s.departedAt = e.at;
      }
    }
  }
  // A dwell still building when the data ends counts if the range ran on long enough after it
  // (the phone said nothing more because it didn't move).
  const pend = det.pending();
  if (!det.stop && pend && endAt !== undefined && endAt - pend.t >= det.minDwellMs) {
    stops.push({ arrivedAt: pend.t, departedAt: null, lat: pend.lat, lon: pend.lon, reason: 'dwell' });
  }

  const trips: SegTrip[] = [];
  const legs: { from: number | null; to: number | null; start: number; end: number }[] = [];
  const first = pts[0]?.t, end = pts[pts.length - 1]?.t;
  if (first === undefined || end === undefined) return { stops, trips };
  let cursor = first, fromIdx: number | null = null;
  stops.forEach((s, i) => {
    legs.push({ from: fromIdx, to: i, start: cursor, end: s.arrivedAt });
    fromIdx = i;
    cursor = s.departedAt ?? Infinity;
  });
  if (cursor < end) legs.push({ from: fromIdx, to: null, start: cursor, end });

  for (const leg of legs) {
    if (!(leg.end > leg.start)) continue;
    const inner = pts.filter((p) => p.t > leg.start && p.t < leg.end).map((p) => ({ lat: p.lat, lon: p.lon, t: p.t, speedMph: p.speedMph }));
    const a = leg.from !== null ? { lat: stops[leg.from].lat, lon: stops[leg.from].lon, t: leg.start, speedMph: null } : null;
    const b = leg.to !== null ? { lat: stops[leg.to].lat, lon: stops[leg.to].lon, t: leg.end, speedMph: null } : null;
    const route = [...(a ? [a] : []), ...inner, ...(b ? [b] : [])];
    if (route.length < 2) continue;
    let miles = 0;
    for (let i = 1; i < route.length; i++) miles += haversineMi(route[i - 1], route[i]);
    if (miles < MIN_TRIP_MI) continue;
    trips.push({ startedAt: route[0].t, endedAt: route[route.length - 1].t, points: route, miles: Math.round(miles * 1000) / 1000, fromStop: leg.from, toStop: leg.to });
  }
  return { stops, trips };
}
