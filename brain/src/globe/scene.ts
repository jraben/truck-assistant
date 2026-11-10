// God's Eye View scene bundles (.gevbundle.json): a road trip, planned or
// driven, as a scene you IMPORT into God's Eye (Scenes): the route as a GeoJSON
// data pack, the stops as points, and camera shots along the way. Format per
// God's Eye's docs/SCENE-DOCUMENT.md, DIRECTOR-DATA-PACKS.md and
// DIRECTOR-SHARING.md (scene document version 5, bundle version 1). Pure.
import { createHash } from 'node:crypto';
import { haversineMi } from '../geo.ts';

export type ScenePoint = { lat: number; lon: number; elevM?: number | null };
export type SceneStop = { id: string; name: string; lat: number; lon: number; elevM?: number | null; kind: 'start' | 'charge' | 'stop' | 'end'; note?: string | null };

/** God's Eye's limits: 2,000 features and 50,000 positions per GeoJSON pack. */
const MAX_POSITIONS = 5000;
/** The chase along a driven trip: one shot per this many miles (at most CHASE_MAX_SHOTS), each this many seconds. */
export const CHASE_MI_PER_SHOT = 0.6;
export const CHASE_MAX_SHOTS = 60;
export const CHASE_SEC_PER_SHOT = 3;
/** Camera behind the truck, above the ground, looking down the road. */
const CHASE_BACK_M = 650, CHASE_ALT_M = 380, CHASE_PITCH = -28;

const bearing = (a: ScenePoint, b: ScenePoint) => {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return Math.round(((Math.atan2(y, x) / r) + 360) % 360);
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'trip';
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Heights are above the WGS84 ellipsoid: lift the line a few metres so it isn't underground (no elevation known: 0 m + lift). */
const h = (p: ScenePoint, lift = 8) => Math.round((p.elevM ?? 0) + lift);

function thinTo(points: ScenePoint[], max: number): ScenePoint[] {
  if (points.length <= max) return points;
  const step = points.length / max, out: ScenePoint[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

export function routeGeoJson(route: ScenePoint[], stops: SceneStop[], title: string) {
  const line = thinTo(route, MAX_POSITIONS).map((p) => [r6(p.lon), r6(p.lat), h(p)]);
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'route', properties: { name: title }, geometry: { type: 'LineString', coordinates: line } },
      ...stops.slice(0, 1999).map((s) => ({ type: 'Feature', id: s.id, properties: { name: s.name, kind: s.kind, note: s.note ?? null }, geometry: { type: 'Point', coordinates: [r6(s.lon), r6(s.lat), h(s, 30)] } })),
    ],
  };
}

/**
 * The bundle: one scene, one GeoJSON pack, an overview shot and a shot at each
 * stop (looking along the way on). `driven` trips get a fly-along instead.
 */
export function tripBundle(o: { title: string; route: ScenePoint[]; stops: SceneStop[]; attribution: string; flyAlong?: boolean; now?: Date }) {
  const id = slug(o.title);
  const geo = JSON.stringify(routeGeoJson(o.route, o.stops, o.title));
  const bytes = Buffer.from(geo, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = `${id}/route.geojson`;
  const pts = o.route;
  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const mid = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
  const spanMi = haversineMi({ lat: Math.min(...lats), lon: Math.min(...lons) }, { lat: Math.max(...lats), lon: Math.max(...lons) });
  const shots: Record<string, unknown>[] = [{
    id: 'overview', title: 'The whole trip', durationSec: 4, holdSec: 3, dataPackIds: ['route'],
    camera: { lat: r6(mid.lat - Math.max(0.05, spanMi / 69) * 0.6), lon: r6(mid.lon), alt: Math.round(Math.min(2_000_000, Math.max(8000, spanMi * 1609 * 1.1))), heading: 0, pitch: -55, roll: 0 },
  }];
  const at = (p: ScenePoint, next: ScenePoint | null, alt: number, pitch: number, title: string, sid: string, dur = 5, hold = 2) => {
    const head = next ? bearing(p, next) : 0;
    // Stand back along the way in so the camera looks toward where the road goes.
    const back = alt / 111_000 * 0.9;
    shots.push({ id: sid, title, durationSec: dur, holdSec: hold, dataPackIds: ['route'],
      camera: { lat: r6(p.lat - Math.cos(head * Math.PI / 180) * back), lon: r6(p.lon - Math.sin(head * Math.PI / 180) * back / Math.cos(p.lat * Math.PI / 180)), alt: Math.round((p.elevM ?? 0) + alt), heading: head, pitch, roll: 0 } });
  };
  if (o.flyAlong) {
    // A chase: God's Eye plays each shot from move.from to camera and never follows anything,
    // so the drive is a chain of short linear moves, each starting exactly where the last
    // ended (no ease in/out, no hold), the camera behind and above the truck looking along
    // the road. Points are evenly spaced by distance, so the pace is steady.
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineMi(pts[i - 1], pts[i]));
    const total = cum[cum.length - 1];
    const n = Math.min(CHASE_MAX_SHOTS, Math.max(4, Math.round(total / CHASE_MI_PER_SHOT) + 1));
    const atMi = (mi: number) => { let i = cum.findIndex((c) => c >= mi); if (i < 0) i = pts.length - 1; return i; };
    const look = Math.max(0.15, total / n); // heading over the next stretch, not the next GPS point
    let prev: Record<string, unknown> | null = null;
    for (let k = 0; k < n; k++) {
      const mi = (k / (n - 1)) * total;
      const p = pts[atMi(mi)], ahead = pts[atMi(Math.min(total, mi + look))];
      const head: number = p === ahead ? (prev?.heading as number | undefined) ?? 0 : bearing(p, ahead);
      const back = CHASE_BACK_M / 111_000;
      const camera: Record<string, number | string> = { lat: r6(p.lat - Math.cos(head * Math.PI / 180) * back), lon: r6(p.lon - Math.sin(head * Math.PI / 180) * back / Math.cos(p.lat * Math.PI / 180)), alt: Math.round((p.elevM ?? 0) + CHASE_ALT_M), heading: head, pitch: CHASE_PITCH, roll: 0, altitudeReference: 'ellipsoid' };
      shots.push({
        id: `fly-${k}`, title: k === 0 ? 'Start' : k === n - 1 ? 'Arrive' : `Along the way ${k}`, dataPackIds: ['route'], camera,
        // The first leg flies in from the overview; every later one starts where the last ended.
        ...(prev ? { durationSec: CHASE_SEC_PER_SHOT, holdSec: 0, move: { from: prev, easing: 'linear' } } : { durationSec: 4, holdSec: 1 }),
      });
      prev = camera;
    }
  } else {
    o.stops.forEach((s, i) => {
      const next = o.stops[i + 1] ?? null;
      at(s, next, 1500, -35, s.kind === 'charge' ? `Charge: ${s.name}` : s.name, `stop-${i}`, 5, 2);
    });
  }
  const now = (o.now ?? new Date()).toISOString();
  return {
    format: 'gev-scene-bundle',
    version: 1,
    project: {
      version: 5, createdAt: now, updatedAt: now,
      scenes: [{
        id, title: o.title.slice(0, 200),
        dataPacks: [{ id: 'route', version: 1, format: 'geojson', source: { adapter: 'scene-bundle', path }, attribution: { text: o.attribution, license: 'Route by OSRM / OpenStreetMap contributors (ODbL); stops from Truck Assistant' }, placement: { altitudeReference: 'ellipsoid' }, byteLength: bytes.length, sha256 }],
        shots,
      }],
    },
    assets: [{ path, mimeType: 'application/geo+json', base64: bytes.toString('base64'), sha256 }],
  };
}
