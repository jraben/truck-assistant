// Camp mode's sky: when the ISS passes over (from CelesTrak's published orbit,
// propagated here with SGP4), and what the plane overhead is (adsb.fi's open
// data around the truck, with its route from adsbdb). Both free and keyless.
import { degreesToRadians, ecfToLookAngles, eciToEcf, gstime, jday, propagate, shadowFraction, sunPos, twoline2satrec, type SatRec } from 'satellite.js';
import { haversineMi } from '../geo.ts';
import { parseRoute, type Airport } from '../pickup/flight.ts';

export const ISS_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
export const NEAR_URL = (lat: number, lon: number, nm: number) => `https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nm}`;

export type Pass = { start: string; peak: string; end: string; maxElevationDeg: number; startDir: string; endDir: string; visible: boolean };
export type Overhead = { callsign: string | null; type: string | null; registration: string | null; altFt: number | null; distMi: number; bearing: string; origin: Airport | null; destination: Airport | null };

const AU_KM = 149_597_870.7;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dir = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** "ISS (ZARYA)\n1 25544U ...\n2 25544 ..." → the two element lines. */
export function parseTle(text: string): [string, string] | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const l1 = lines.find((l) => l.startsWith('1 ')), l2 = lines.find((l) => l.startsWith('2 '));
  return l1 && l2 ? [l1, l2] : null;
}

function look(sat: SatRec, t: Date, obs: { longitude: number; latitude: number; height: number }) {
  const pv = propagate(sat, t);
  if (!pv || typeof pv.position !== 'object') return null;
  const gmst = gstime(t);
  const la = ecfToLookAngles(obs, eciToEcf(pv.position, gmst));
  return { elDeg: (la.elevation * 180) / Math.PI, azDeg: (la.azimuth * 180) / Math.PI, eci: pv.position, gmst };
}

/**
 * Passes above `minEl` degrees in the next `hours`, 20-second steps. Visible
 * means the station is in sunlight while the sky at the truck is dark (sun
 * more than 6° below the horizon): that's when it shows as a bright moving star.
 */
export function issPasses(tle: [string, string], lat: number, lon: number, from: Date, hours = 24, minEl = 10): Pass[] {
  const sat = twoline2satrec(tle[0], tle[1]);
  const obs = { longitude: degreesToRadians(lon), latitude: degreesToRadians(lat), height: 0.4 };
  const passes: Pass[] = [];
  let cur: { start: Date; peak: Date; max: number; startAz: number; endAz: number; vis: boolean; end: Date } | null = null;
  for (let t = from.getTime(); t <= from.getTime() + hours * 3600_000; t += 20_000) {
    const d = new Date(t);
    const l = look(sat, d, obs);
    if (!l) continue;
    if (l.elDeg >= minEl) {
      const sun = sunPos(jday(d));
      const lit = shadowFraction(sun.rsun, l.eci) < 0.5;
      const sunEcf = eciToEcf({ x: sun.rsun.x * AU_KM, y: sun.rsun.y * AU_KM, z: sun.rsun.z * AU_KM }, l.gmst);
      const dark = (ecfToLookAngles(obs, sunEcf).elevation * 180) / Math.PI < -6;
      if (!cur) cur = { start: d, peak: d, max: l.elDeg, startAz: l.azDeg, endAz: l.azDeg, vis: false, end: d };
      if (l.elDeg > cur.max) { cur.max = l.elDeg; cur.peak = d; }
      cur.end = d; cur.endAz = l.azDeg; cur.vis ||= lit && dark;
    } else if (cur) {
      passes.push({ start: cur.start.toISOString(), peak: cur.peak.toISOString(), end: cur.end.toISOString(), maxElevationDeg: Math.round(cur.max), startDir: dir(cur.startAz), endDir: dir(cur.endAz), visible: cur.vis });
      cur = null;
    }
  }
  return passes;
}

/** The nearest aircraft to the truck from an adsb.fi answer (readsb fields), or null. */
export function nearestAircraft(body: unknown, here: { lat: number; lon: number }): (Omit<Overhead, 'origin' | 'destination'> & { callsignRaw: string | null }) | null {
  const ac = (body as { ac?: Record<string, unknown>[] } | null)?.ac;
  if (!Array.isArray(ac)) return null;
  let best: Record<string, unknown> | null = null, bestD = Infinity;
  for (const a of ac) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || a.alt_baro === 'ground') continue;
    const d = haversineMi(here, { lat: a.lat, lon: a.lon });
    if (d < bestD) { best = a; bestD = d; }
  }
  if (!best) return null;
  const cs = typeof best.flight === 'string' ? best.flight.trim() || null : null;
  const r = degreesToRadians;
  const y = Math.sin(r((best.lon as number) - here.lon)) * Math.cos(r(best.lat as number));
  const x = Math.cos(r(here.lat)) * Math.sin(r(best.lat as number)) - Math.sin(r(here.lat)) * Math.cos(r(best.lat as number)) * Math.cos(r((best.lon as number) - here.lon));
  return { callsign: cs, callsignRaw: cs, type: (best.t as string) ?? null, registration: (best.r as string) ?? null, altFt: typeof best.alt_baro === 'number' ? best.alt_baro : null, distMi: Math.round(bestD * 10) / 10, bearing: dir((Math.atan2(y, x) * 180) / Math.PI) };
}

export class SkyService {
  private tle: { at: number; lines: [string, string] } | null = null;
  private f: typeof fetch;
  constructor(fetchFn: typeof fetch = fetch) { this.f = fetchFn; }

  private cache: { at: number; key: string; passes: Pass[] } | null = null;

  /** Passes for the next day; the 24-hour sweep takes a few seconds, so it's kept 10 minutes per ~7-mile area. */
  async passes(lat: number, lon: number, now = new Date()): Promise<Pass[]> {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    if (this.cache && this.cache.key === key && now.getTime() - this.cache.at < 600_000) return this.cache.passes.filter((p) => Date.parse(p.end) > now.getTime());
    if (!this.tle || now.getTime() - this.tle.at > 24 * 3600_000) {
      const r = await this.f(ISS_TLE_URL, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`CelesTrak answered ${r.status}`);
      const lines = parseTle(await r.text());
      if (!lines) throw new Error('CelesTrak sent no orbit for the ISS');
      this.tle = { at: now.getTime(), lines };
    }
    const passes = issPasses(this.tle.lines, lat, lon, now);
    this.cache = { at: now.getTime(), key, passes };
    return passes;
  }

  async overhead(lat: number, lon: number): Promise<Overhead | null> {
    const r = await this.f(NEAR_URL(lat, lon, 15), { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`adsb.fi answered ${r.status}`);
    const n = nearestAircraft(await r.json(), { lat, lon });
    if (!n) return null;
    let route = { origin: null as Airport | null, destination: null as Airport | null };
    if (n.callsignRaw) {
      try { const rr = await this.f(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(n.callsignRaw)}`, { signal: AbortSignal.timeout(10_000) }); if (rr.ok) route = parseRoute(await rr.json()); } catch { /* route unknown */ }
    }
    const { callsignRaw: _c, ...rest } = n;
    return { ...rest, origin: route.origin, destination: route.destination };
  }
}
