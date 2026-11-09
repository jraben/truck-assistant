// Hazards along a trip: NWS warnings at points on the route (dust storms,
// severe thunderstorms, flash floods), the forecast for the hour the truck will
// be at each point (Open-Meteo), and NASA FIRMS fire hotspots near the route
// (free key). Parsing and the "what matters" rules are pure; fetching is below.
import { haversineMi } from '../geo.ts';
import { locate, pointAt, type Route } from '../roadtrip/route.ts';

export type HazardKind = 'warning' | 'storm' | 'rain' | 'wind' | 'fog' | 'fire';
export type Hazard = { key: string; kind: HazardKind; severity: 'high' | 'medium'; title: string; detail: string | null; mi: number; at: string | null; lat: number; lon: number };

export type RoutePoint = { mi: number; lat: number; lon: number; at: number };

/** Points every `stepMi` from `fromMi` to the end, with when the truck gets there (drive time only). */
export function pointsAhead(route: Route, fromMi: number, now: number, stepMi = 40, max = 12): RoutePoint[] {
  const minPerMi = route.miles > 0 ? route.minutes / route.miles : 1;
  const out: RoutePoint[] = [];
  for (let mi = fromMi; mi <= route.miles && out.length < max; mi += stepMi) { const p = pointAt(route, mi); out.push({ mi, lat: p.lat, lon: p.lon, at: now + (mi - fromMi) * minPerMi * 60_000 }); }
  const end = route.points[route.points.length - 1];
  if (out.length < max && (out.at(-1)?.mi ?? -1) < route.miles - 5) out.push({ mi: route.miles, lat: end.lat, lon: end.lon, at: now + (route.miles - fromMi) * minPerMi * 60_000 });
  return out;
}

// ---- NWS alerts -----------------------------------------------------------------------

/** Warnings worth a driver's attention; advisories and statements below that are left out. */
const DRIVING_EVENTS = /dust storm|blowing dust|severe thunderstorm|tornado|flash flood|flood warning|winter storm|blizzard|ice storm|high wind|extreme wind|dense fog|fire weather|red flag|extreme heat|excessive heat/i;

export function parseAlerts(body: unknown, at: RoutePoint): Hazard[] {
  const feats = (body as { features?: { id?: string; properties?: Record<string, unknown> }[] } | null)?.features ?? [];
  const out: Hazard[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const event = String(p.event ?? '');
    if (!DRIVING_EVENTS.test(event)) continue;
    const ends = typeof p.ends === 'string' ? p.ends : typeof p.expires === 'string' ? p.expires : null;
    out.push({ key: `nws:${f.id ?? p.id ?? event}`, kind: 'warning', severity: /warning|tornado|dust storm/i.test(event) ? 'high' : 'medium', title: event, detail: typeof p.headline === 'string' ? p.headline : null, mi: Math.round(at.mi), at: ends, lat: at.lat, lon: at.lon });
  }
  return out;
}

// ---- Open-Meteo forecast at each point, for its hour -----------------------------------------

/** WMO weather codes: 95-99 thunderstorm, 61-67/80-82 rain, 71-77/85-86 snow, 45/48 fog. */
export function parseForecast(body: unknown, pts: RoutePoint[]): Hazard[] {
  const list = (Array.isArray(body) ? body : [body]) as { hourly?: { time?: string[]; weather_code?: number[]; precipitation_probability?: number[]; wind_gusts_10m?: number[]; visibility?: number[] } }[];
  const out: Hazard[] = [];
  list.forEach((loc, i) => {
    const p = pts[i], h = loc?.hourly;
    if (!p || !h?.time?.length) return;
    // The hour the truck is there (times are GMT with timezone=GMT).
    let k = 0, best = Infinity;
    h.time.forEach((t, j) => { const d = Math.abs(Date.parse(`${t}Z`) - p.at); if (d < best) { best = d; k = j; } });
    if (best > 3 * 3600_000) return;
    const code = h.weather_code?.[k] ?? null, prob = h.precipitation_probability?.[k] ?? null, gust = h.wind_gusts_10m?.[k] ?? null, vis = h.visibility?.[k] ?? null;
    const at = new Date(p.at).toISOString(), base = { mi: Math.round(p.mi), at, lat: p.lat, lon: p.lon };
    if (code !== null && code >= 95) out.push({ ...base, key: `wx:storm:${i}`, kind: 'storm', severity: 'high', title: 'Thunderstorms likely', detail: prob !== null ? `${prob}% chance of rain` : null });
    else if (code !== null && ((code >= 63 && code <= 67) || (code >= 81 && code <= 82) || (code >= 73 && code <= 77) || code === 86) && (prob ?? 100) >= 50) out.push({ ...base, key: `wx:rain:${i}`, kind: 'rain', severity: 'medium', title: code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82 ? 'Snow likely' : 'Heavy rain likely', detail: prob !== null ? `${prob}% chance` : null });
    if (gust !== null && gust >= 45) out.push({ ...base, key: `wx:wind:${i}`, kind: 'wind', severity: gust >= 60 ? 'high' : 'medium', title: `Gusts to ${Math.round(gust)} mph`, detail: 'Crosswinds; blowing dust in the desert' });
    if (vis !== null && vis < 1600) out.push({ ...base, key: `wx:fog:${i}`, kind: 'fog', severity: vis < 400 ? 'high' : 'medium', title: 'Low visibility', detail: `About ${(vis / 1609).toFixed(1)} mi` });
  });
  return out;
}

export function forecastUrl(pts: RoutePoint[]): string {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', pts.map((p) => p.lat.toFixed(3)).join(','));
  u.searchParams.set('longitude', pts.map((p) => p.lon.toFixed(3)).join(','));
  u.searchParams.set('hourly', 'weather_code,precipitation_probability,wind_gusts_10m,visibility');
  u.searchParams.set('wind_speed_unit', 'mph');
  u.searchParams.set('timezone', 'GMT');
  u.searchParams.set('forecast_days', '3');
  return u.toString();
}

// ---- NASA FIRMS fire hotspots ------------------------------------------------------------

export type Hotspot = { lat: number; lon: number; at: string | null; frp: number | null };

/** FIRMS area CSV. Columns are found by name (they differ a little by sensor), so a renamed one is skipped, not misread. */
export function parseFirms(csv: string): Hotspot[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const la = col('latitude'), lo = col('longitude'), d = col('acq_date'), t = col('acq_time'), frp = col('frp');
  if (la < 0 || lo < 0) return [];
  return lines.slice(1).map((l) => l.split(',')).map((c) => {
    const time = t >= 0 ? c[t]?.padStart(4, '0') : null;
    return { lat: Number(c[la]), lon: Number(c[lo]), at: d >= 0 && c[d] ? `${c[d]}T${time ? `${time.slice(0, 2)}:${time.slice(2)}` : '00:00'}:00Z` : null, frp: frp >= 0 && c[frp] ? Number(c[frp]) : null };
  }).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
}

export function firmsUrl(key: string, route: Route, fromMi: number): string {
  const pts = route.points.filter((p) => p.mi >= fromMi);
  const pad = 0.2;
  const w = Math.min(...pts.map((p) => p.lon)) - pad, e = Math.max(...pts.map((p) => p.lon)) + pad;
  const s = Math.min(...pts.map((p) => p.lat)) - pad, n = Math.max(...pts.map((p) => p.lat)) + pad;
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${w.toFixed(2)},${s.toFixed(2)},${e.toFixed(2)},${n.toFixed(2)}/1`;
}

/** Hotspots within `nearMi` of the route ahead, grouped into fires (hotspots within ~3 miles of each other). */
export function firesNearRoute(spots: Hotspot[], route: Route, fromMi: number, nearMi = 10): Hazard[] {
  const near = spots.map((h) => ({ h, at: locate(route, h) })).filter((x) => x.at.offMi <= nearMi && x.at.mi >= fromMi - 1);
  const groups: { lat: number; lon: number; mi: number; off: number; n: number; at: string | null }[] = [];
  for (const x of near) {
    const g = groups.find((g) => haversineMi(g, x.h) <= 3);
    if (g) { g.n++; if (x.at.offMi < g.off) { g.off = x.at.offMi; g.mi = x.at.mi; } if ((x.h.at ?? '') > (g.at ?? '')) g.at = x.h.at; }
    else groups.push({ lat: x.h.lat, lon: x.h.lon, mi: x.at.mi, off: x.at.offMi, n: 1, at: x.h.at });
  }
  return groups.map((g, i) => ({ key: `fire:${i}:${g.lat.toFixed(2)},${g.lon.toFixed(2)}`, kind: 'fire' as const, severity: g.off <= 3 ? 'high' as const : 'medium' as const,
    title: `Fire ${g.off < 1 ? 'beside the route' : `${Math.round(g.off)} mi off the route`}`, detail: `${g.n} satellite hotspot${g.n === 1 ? '' : 's'} (NASA FIRMS)`, mi: Math.round(g.mi), at: g.at, lat: g.lat, lon: g.lon }))
    .sort((a, b) => a.mi - b.mi);
}
