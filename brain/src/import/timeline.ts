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
//
// Miles: Google's own `distanceMeters` on a drive is badly short for anything
// long (a 2-hour I-10 run exported as 5.5 mi; no drive over ~30 mi in five
// months). The exports also carry the phone's GPS path (`timelinePath`, about a
// fix a minute while moving) and the places stayed at (`visit`), so a drive is
// measured along those fixes, from the place left to the place reached, and
// Google's figure is kept only when it is the larger.
import type { Db } from '../db.ts';
import type { TripStore } from '../trips.ts';

type LL = { lat: number; lon: number };
export type TimelineDrive = { startedAt: number; endedAt: number; miles: number; start: LL; end: LL; path: (LL & { t: number })[] };
/** A fix from the GPS path or a place stayed at. */
type Fix = LL & { t: number };

const DRIVE_TYPES = new Set(['IN_PASSENGER_VEHICLE', 'IN_VEHICLE', 'DRIVING', 'IN_CAR', 'IN_TAXI', 'MOTORCYCLING', 'IN_ROAD_VEHICLE']);
/** Without Google's distance, a straight line start to end, longer for roads. */
const ROAD_FACTOR = 1.25;
const M_PER_MI = 1609.344;
/** Fixes further apart than this are joined by a straight line × ROAD_FACTOR; closer ones are the road. */
const DENSE_GAP_MS = 3 * 60_000;
/** A hop faster than this over more than DENSE_GAP_MS is a bad fix, not driving. */
const JUMP_MPH = 150;
/** No drive is credited more than this average speed. */
const MAX_AVG_MPH = 80;

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
  return { startedAt: s, endedAt: e, miles, start: a, end: b, path: [] };
}

/** Miles along time-ordered fixes: dense stretches as driven, gaps × ROAD_FACTOR, bad jumps skipped. */
export function pathMiles(fixes: Fix[]): number {
  let mi = 0;
  for (let i = 1; i < fixes.length; i++) {
    const dt = fixes[i].t - fixes[i - 1].t, h = haversineMi(fixes[i - 1], fixes[i]);
    if (dt > DENSE_GAP_MS && h / (dt / 3_600_000) > JUMP_MPH) continue;
    mi += dt > DENSE_GAP_MS ? h * ROAD_FACTOR : h;
  }
  return mi;
}

/** Each drive measured along the fixes from just before it starts to just after it ends. */
function measure(drives: TimelineDrive[], fixes: Fix[]): void {
  fixes.sort((x, y) => x.t - y.t);
  const ts = fixes.map((f) => f.t);
  const lower = (t: number) => { let lo = 0, hi = ts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid] < t) lo = mid + 1; else hi = mid; } return lo; };
  for (const d of drives) {
    const route = fixes.slice(lower(d.startedAt - 60_000), lower(d.endedAt + 60_001));
    if (route.length >= 2) {
      const cap = ((d.endedAt - d.startedAt) / 3_600_000) * MAX_AVG_MPH;
      d.miles = Math.max(d.miles, Math.min(pathMiles(route), cap));
      d.path = route;
    }
  }
}

/** Every drive in an export, oldest first, duplicates dropped. Throws if it isn't a Timeline export at all. */
export function parseTimeline(json: unknown): TimelineDrive[] {
  const out: TimelineDrive[] = [];
  const fixes: Fix[] = [];
  let recognised = false;
  const segs = isObj(json) && Array.isArray(json.semanticSegments) ? json.semanticSegments : Array.isArray(json) ? json : null;
  if (segs) {
    recognised = true;
    for (const x of segs) {
      if (!isObj(x)) continue;
      const t0 = Date.parse(String(x.startTime)), t1 = Date.parse(String(x.endTime));
      // GPS path: iOS gives minutes after startTime, Android a time per point.
      if (Array.isArray(x.timelinePath)) {
        for (const p of x.timelinePath) {
          if (!isObj(p)) continue;
          const at = parseLatLng(p.point);
          const t = p.time !== undefined ? Date.parse(String(p.time)) : t0 + Number(p.durationMinutesOffsetFromStartTime) * 60_000;
          if (at && Number.isFinite(t)) fixes.push({ ...at, t });
        }
      }
      // A place stayed at: where the phone was from its start to its end.
      if (isObj(x.visit) && isObj(x.visit.topCandidate)) {
        const at = parseLatLng(x.visit.topCandidate.placeLocation);
        if (at && Number.isFinite(t0) && Number.isFinite(t1)) fixes.push({ ...at, t: t0 }, { ...at, t: t1 });
      }
      if (!isObj(x.activity)) continue;
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
  if (fixes.length) measure(out, fixes);
  out.sort((x, y) => x.startedAt - y.startedAt);
  return out
    .filter((d, i) => i === 0 || d.startedAt !== out[i - 1].startedAt)
    .filter((d) => d.miles >= 0.1 && d.miles <= 1500)
    .map((d) => ({ ...d, miles: Math.round(d.miles * 100) / 100 }));
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
      // The GPS path when there is one (the map draws it), else just the two ends.
      const pts = d.path.length >= 2 ? d.path.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, speedMph: null })) : [{ t: d.startedAt, ...d.start, speedMph: mph }, { t: d.endedAt, ...d.end, speedMph: mph }];
      trips.insertPhone({ driverId, startedAt: d.startedAt, endedAt: d.endedAt, miles: d.miles, startStopId: null, endStopId: null, points: pts, kind: 'timeline' });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { trips: drives.length, miles: Math.round(drives.reduce((s, d) => s + d.miles, 0) * 10) / 10, from: from.toISOString(), to: new Date(drives[drives.length - 1].endedAt).toISOString() };
}
