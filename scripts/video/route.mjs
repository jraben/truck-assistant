// Shared by the God's Eye video scripts: the chase scene exported from a trip
// (Trips → God's Eye → chase), its route line, and where the truck is on that
// line in each globe frame. Positions are "miles along the route", so the globe
// and the dash recording can be lined up by place rather than by time.
import { readFileSync } from 'node:fs';

export const FPS = 30, LEG_S = 3, LEGS = 10, FRAMES = FPS * LEG_S * LEGS; // 30 s: ten 3 s legs between the chase shots
export const BACK_M = 650; // the chase camera sits about this far behind the truck

const R = Math.PI / 180;
const mi = (a, b) => Math.hypot((b.lon - a.lon) * R * Math.cos(((a.lat + b.lat) / 2) * R), (b.lat - a.lat) * R) * 3958.8;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpHead = (a, b, t) => { const d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; };

export function loadScene(path) {
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  const shots = bundle.project.scenes[0].shots.filter((s) => s.id.startsWith('fly-')).slice(0, LEGS + 1).map((s) => s.camera);
  if (shots.length < LEGS + 1) throw new Error(`${path}: needs ${LEGS + 1} fly-* shots, has ${shots.length}`);
  const asset = bundle.assets.find((a) => a.path.endsWith('route.geojson'));
  if (!asset) throw new Error(`${path}: no route.geojson asset`);
  const route = JSON.parse(Buffer.from(asset.base64, 'base64').toString('utf8')).features[0].geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + mi(route[i - 1], route[i]));
  return { bundle, shots, route, cum };
}

/** A snapper that only moves forward along the route: the nearest point to `q` from where it was last time. */
export function snapper({ route, cum }) {
  let seg = 0;
  return (q) => {
    const kx = Math.cos(q.lat * R);
    let best = null;
    for (let i = seg; i < Math.min(route.length - 1, seg + 40); i++) {
      const a = route[i], b = route[i + 1];
      const ax = a.lon * kx, ay = a.lat, dx = b.lon * kx - ax, dy = b.lat - ay, L = dx * dx + dy * dy;
      const t = L > 0 ? Math.max(0, Math.min(1, ((q.lon * kx - ax) * dx + (q.lat - ay) * dy) / L)) : 0;
      const d = (q.lon * kx - ax - dx * t) ** 2 + (q.lat - ay - dy * t) ** 2;
      if (!best || d < best.d) best = { d, i, t, lat: ay + dy * t, lon: (ax + dx * t) / kx };
    }
    seg = best.i;
    return { lat: best.lat, lon: best.lon, miles: cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.t };
  };
}

/** The camera for globe frame `f`: linear between the chase shots. */
export function cameraAt(shots, f) {
  const pos = f / (FPS * LEG_S), k = Math.min(LEGS - 1, Math.floor(pos)), t = Math.min(1, pos - k);
  const a = shots[k], b = shots[k + 1];
  return { lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t), alt: lerp(a.alt, b.alt, t), heading: lerpHead(a.heading, b.heading, t), pitch: lerp(a.pitch, b.pitch, t) };
}

/** The spot BACK_M ahead of the camera along its heading (the truck, before snapping to the route). */
export function aheadOf(cam) {
  const fwd = BACK_M / 111000;
  return { lat: cam.lat + Math.cos(cam.heading * R) * fwd, lon: cam.lon + Math.sin(cam.heading * R) * fwd / Math.cos(cam.lat * R) };
}

/** Miles along the route of the truck in every globe frame. */
export function globeMiles(scene) {
  const snap = snapper(scene);
  return Array.from({ length: FRAMES }, (_, f) => snap(aheadOf(cameraAt(scene.shots, f))).miles);
}
