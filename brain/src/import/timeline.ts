// Google Maps Timeline export -> phone trips (source 'phone') for a driver, so
// months of real driving can be searched and simulated (weekSim.ts). Pure
// parsing; `storeTimeline` writes. Three export shapes are read:
//  - Android on-device export, Timeline.json: { semanticSegments: [{ startTime,
//    endTime, activity: { start: { latLng: "33.4°, -112.0°" }, end, distanceMeters,
//    topCandidate: { type: "IN_PASSENGER_VEHICLE" } } }, ...] }
//  - iOS export: [{ startTime, endTime, activity: { start: "geo:33.4,-112.0", end,
//    distanceMeters: "1234", topCandidate: { type: "in passenger vehicle" } } }, ...]
//  - Takeout Semantic Location History (one file per month): { timelineObjects:
//    [{ activitySegment: { startLocation: { latitudeE7, longitudeE7 }, endLocation,
//    duration: { startTimestamp, endTimestamp }, distance, activityType } }] }
// Only drives are kept (car, passenger vehicle, taxi, motorcycle), not walks,
// buses, trains or flights.
import type { Db } from '../db.ts';
import type { TripStore } from '../trips.ts';

export type TimelineDrive = { startedAt: number; endedAt: number; miles: number; start: { lat: number; lon: number }; end: { lat: number; lon: number } };

const DRIVE_TYPES = new Set(['IN_PASSENGER_VEHICLE', 'IN_VEHICLE', 'DRIVING', 'IN_CAR', 'IN_TAXI', 'MOTORCYCLING', 'IN_ROAD_VEHICLE']);
/** Without Google's distance, a straight line start to end, longer for roads. */
const ROAD_FACTOR = 1.25;
const M_PER_MI = 1609.344;

export class TimelineError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const normType = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : '');

/** "33.4567°, -112.0123°", "geo:33.4567,-112.0123", or {latitudeE7, longitudeE7}. */
export function parseLatLng(v: unknown): { lat: number; lon: number } | null {
  if (isObj(v)) {
    if (typeof v.latLng === 'string') return parseLatLng(v.latLng);
    const la = Number(v.latitudeE7), lo = Number(v.longitudeE7);
    if (Number.isFinite(la) && Number.isFinite(lo)) return { lat: la / 1e7, lon: lo / 1e7 };
    return null;
  }
  if (typeof v !== 'string') return null;
  const m = /(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/.exec(v.replace(/^geo:/, ''));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function haversineMi(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

function drive(type: unknown, start: unknown, end: unknown, t0: unknown, t1: unknown, meters: unknown): TimelineDrive | null {
  if (!DRIVE_TYPES.has(normType(type))) return null;
  const a = parseLatLng(start), b = parseLatLng(end);
  const s = Date.parse(String(t0)), e = Date.parse(String(t1));
  if (!a || !b || !Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const m = Number(meters);
  const miles = Number.isFinite(m) && m > 0 ? m / M_PER_MI : haversineMi(a, b) * ROAD_FACTOR;
  if (miles < 0.1 || miles > 1500) return null;
  return { startedAt: s, endedAt: e, miles: Math.round(miles * 100) / 100, start: a, end: b };
}

/** Every drive in an export, oldest first, duplicates dropped. Throws if it isn't a Timeline export at all. */
export function parseTimeline(json: unknown): TimelineDrive[] {
  const out: TimelineDrive[] = [];
  let recognised = false;
  const segs = isObj(json) && Array.isArray(json.semanticSegments) ? json.semanticSegments : Array.isArray(json) ? json : null;
  if (segs) {
    recognised = true;
    for (const x of segs) {
      if (!isObj(x) || !isObj(x.activity)) continue;
      const act = x.activity, top = isObj(act.topCandidate) ? act.topCandidate : {};
      const d = drive(top.type, act.start, act.end, x.startTime, x.endTime, act.distanceMeters);
      if (d) out.push(d);
    }
  }
  if (isObj(json) && Array.isArray(json.timelineObjects)) {
    recognised = true;
    for (const x of json.timelineObjects) {
      if (!isObj(x) || !isObj(x.activitySegment)) continue;
      const a = x.activitySegment, dur = isObj(a.duration) ? a.duration : {};
      const d = drive(a.activityType, a.startLocation, a.endLocation, dur.startTimestamp ?? dur.startTimestampMs, dur.endTimestamp ?? dur.endTimestampMs, a.distance);
      if (d) out.push(d);
    }
  }
  if (!recognised) throw new TimelineError('Not a Google Maps Timeline export: expected Timeline.json (semanticSegments), the iPhone export, or Takeout Semantic Location History (timelineObjects).');
  out.sort((x, y) => x.startedAt - y.startedAt);
  return out.filter((d, i) => i === 0 || d.startedAt !== out[i - 1].startedAt);
}

/** Write the drives as the driver's phone trips, replacing that driver's phone trips over the same span. */
export function storeTimeline(trips: TripStore, db: Db, driverId: string, drives: TimelineDrive[]): { trips: number; miles: number; from: string | null; to: string | null } {
  if (!drives.length) return { trips: 0, miles: 0, from: null, to: null };
  const from = new Date(drives[0].startedAt), to = new Date(drives[drives.length - 1].startedAt + 1);
  db.exec('BEGIN');
  try {
    trips.deletePhone(driverId, from.toISOString(), to.toISOString());
    for (const d of drives) {
      const mph = d.miles / Math.max((d.endedAt - d.startedAt) / 3_600_000, 1 / 60);
      trips.insertPhone({ driverId, startedAt: d.startedAt, endedAt: d.endedAt, miles: d.miles, startStopId: null, endStopId: null,
        points: [{ t: d.startedAt, ...d.start, speedMph: mph }, { t: d.endedAt, ...d.end, speedMph: mph }] });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { trips: drives.length, miles: Math.round(drives.reduce((s, d) => s + d.miles, 0) * 10) / 10, from: from.toISOString(), to: new Date(drives[drives.length - 1].endedAt).toISOString() };
}
