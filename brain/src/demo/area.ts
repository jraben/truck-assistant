// DEMO=1: the top bar's location chip. A neighbourhood or a freeway and
// direction ("Arcadia, Phoenix", "Loop 202 W near Downtown Tempe"), never a
// reverse-geocoded street address.
import { metersBetween, type LatLon } from '../geo.ts';
import { DEMO_AREAS, DEMO_FREEWAYS } from './world.ts';

/** On a freeway: within this of its line and at least this fast. */
const FREEWAY_M = 700;
const FREEWAY_MPH = 40;
/** Further than this from every neighbourhood: just the metro. */
const AREA_MAX_M = 9000;

const cardinal = (deg: number) => ['N', 'E', 'S', 'W'][Math.round((((deg % 360) + 360) % 360) / 90) % 4];

/** Metres from p to segment a-b (flat-earth, fine at city scale). */
function toSegmentM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = a.lon * k, ay = a.lat, bx = b.lon * k, by = b.lat, px = p.lon * k, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return metersBetween(p, { lat: ay + t * dy, lon: (ax + t * dx) / k });
}

function nearestArea(p: LatLon): { name: string; m: number } | null {
  let best: { name: string; m: number } | null = null;
  for (const a of DEMO_AREAS) {
    const m = metersBetween(p, a);
    if (!best || m < best.m) best = { name: a.name, m };
  }
  return best;
}

/** The chip's words for a position. Pure. */
export function demoArea(pos: LatLon | null, speedMph: number | null, headingDeg: number | null): string | null {
  if (!pos) return null;
  const near = nearestArea(pos);
  if ((speedMph ?? 0) >= FREEWAY_MPH) {
    for (const f of DEMO_FREEWAYS) {
      for (let i = 0; i + 1 < f.path.length; i++) {
        if (toSegmentM(pos, f.path[i], f.path[i + 1]) <= FREEWAY_M) {
          const dir = headingDeg === null ? '' : ` ${cardinal(headingDeg)}`;
          const by = near && near.m <= AREA_MAX_M ? ` near ${near.name.replace(/, Phoenix$/, '')}` : '';
          return `${f.name}${dir}${by}`;
        }
      }
    }
  }
  if (near && near.m <= AREA_MAX_M) return near.name;
  return pos.lat > 33.2 && pos.lat < 33.8 && pos.lon > -112.5 && pos.lon < -111.5 ? 'Phoenix, AZ' : 'Arizona';
}
