// Weather (docs/drive-v2.md §4, §8). National Weather Service first
// (api.weather.gov: free, no key, US only, wants an identifying User-Agent),
// Open-Meteo as the fallback (free, no key, worldwide). Refresh every 15 min
// while online, or after moving 10 km; the last report is kept in SQLite and
// shown with its age when offline. Parsers are pure (tested on saved answers).
import type { Db } from '../db.ts';
import { haversineMi, type LatLon } from '../geo.ts';
import { sunTimes } from '../sun.ts';
import type { WeatherAlert, WeatherBrief, WeatherHour, WeatherIcon, WeatherReport } from './types.ts';

export const REFRESH_MS = 15 * 60_000;
export const MOVE_KM = 10;
export const STALE_MS = 45 * 60_000;
const FAIL_BACKOFF_MS = 2 * 60_000;
const NWS = 'https://api.weather.gov';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

const cToF = (c: number | null | undefined) => (typeof c === 'number' && Number.isFinite(c) ? Math.round((c * 9) / 5 + 32) : null);
const kmhToMph = (k: number | null | undefined) => (typeof k === 'number' && Number.isFinite(k) ? Math.round(k / 1.609344) : null);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number | null | undefined) => (typeof deg === 'number' && Number.isFinite(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : null);

/** "5 mph", "5 to 10 mph", "10 to 15 mph" -> the higher number. */
export function parseNwsWind(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const n = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!n.length) return null;
  const v = Math.max(...n);
  return /km\/h/i.test(s) ? Math.round(v / 1.609344) : Math.round(v);
}

/** NWS icon URL (".../icons/land/day/tsra,40?size=small") or forecast text -> our icon. */
export function nwsIcon(url: unknown, text: unknown): { icon: WeatherIcon; isDay: boolean } {
  const u = typeof url === 'string' ? url : '';
  const isDay = !/\/night\//.test(u);
  const code = /\/(?:day|night)\/([a-z_]+)/.exec(u)?.[1] ?? '';
  const map: Record<string, WeatherIcon> = {
    skc: 'clear', few: 'few', sct: 'partly', bkn: 'cloudy', ovc: 'cloudy',
    wind_skc: 'wind', wind_few: 'wind', wind_sct: 'wind', wind_bkn: 'wind', wind_ovc: 'wind',
    snow: 'snow', rain_snow: 'sleet', rain_sleet: 'sleet', snow_sleet: 'sleet', fzra: 'sleet', rain_fzra: 'sleet', snow_fzra: 'sleet', sleet: 'sleet',
    rain: 'rain', rain_showers: 'showers', rain_showers_hi: 'showers', tsra: 'storm', tsra_sct: 'storm', tsra_hi: 'storm',
    tornado: 'storm', hurricane: 'storm', tropical_storm: 'storm', dust: 'dust', smoke: 'smoke', haze: 'haze', hot: 'hot', cold: 'cold', blizzard: 'snow', fog: 'fog',
  };
  if (map[code]) return { icon: map[code], isDay };
  return { icon: textIcon(text), isDay };
}

export function textIcon(text: unknown): WeatherIcon {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  if (!t) return 'unknown';
  if (/thunder|t-storm|tstorm/.test(t)) return 'storm';
  if (/sleet|freezing|ice/.test(t)) return 'sleet';
  if (/snow|flurr/.test(t)) return 'snow';
  if (/shower/.test(t)) return 'showers';
  if (/rain|drizzle/.test(t)) return 'rain';
  if (/dust|sand/.test(t)) return 'dust';
  if (/smoke/.test(t)) return 'smoke';
  if (/haze/.test(t)) return 'haze';
  if (/fog|mist/.test(t)) return 'fog';
  if (/wind|breez|blust/.test(t)) return 'wind';
  if (/overcast|mostly cloudy|cloudy/.test(t) && !/partly/.test(t)) return 'cloudy';
  if (/partly|mostly sunny|mostly clear/.test(t)) return 'partly';
  if (/sunny|clear|fair/.test(t)) return 'clear';
  return 'unknown';
}

/** WMO weather code (Open-Meteo) -> icon + words. */
export function wmo(code: unknown): { icon: WeatherIcon; text: string } {
  const c = typeof code === 'number' ? code : -1;
  if (c === 0) return { icon: 'clear', text: 'Clear' };
  if (c === 1) return { icon: 'few', text: 'Mostly clear' };
  if (c === 2) return { icon: 'partly', text: 'Partly cloudy' };
  if (c === 3) return { icon: 'cloudy', text: 'Overcast' };
  if (c === 45 || c === 48) return { icon: 'fog', text: 'Fog' };
  if (c >= 51 && c <= 57) return { icon: 'rain', text: 'Drizzle' };
  if (c >= 61 && c <= 65) return { icon: 'rain', text: 'Rain' };
  if (c === 66 || c === 67) return { icon: 'sleet', text: 'Freezing rain' };
  if (c >= 71 && c <= 77) return { icon: 'snow', text: 'Snow' };
  if (c >= 80 && c <= 82) return { icon: 'showers', text: 'Showers' };
  if (c === 85 || c === 86) return { icon: 'snow', text: 'Snow showers' };
  if (c >= 95) return { icon: 'storm', text: 'Thunderstorm' };
  return { icon: 'unknown', text: '—' };
}

type Json = Record<string, any>;

export type NwsPoint = { forecast: string; forecastHourly: string; stations: string; city: string | null; state: string | null; timeZone: string | null };

export function parseNwsPoint(b: Json): NwsPoint | null {
  const p = b?.properties;
  if (!p?.forecast || !p?.forecastHourly) return null;
  const rl = p.relativeLocation?.properties ?? {};
  return { forecast: p.forecast, forecastHourly: p.forecastHourly, stations: p.observationStations, city: rl.city ?? null, state: rl.state ?? null, timeZone: p.timeZone ?? null };
}

const fToF = (t: unknown, unit: unknown) => (typeof t === 'number' ? (unit === 'C' ? cToF(t) : Math.round(t)) : null);

/** Next `hours` hourly periods from now. */
export function parseNwsHourly(b: Json, now: Date, hours = 12): WeatherHour[] {
  const periods: Json[] = b?.properties?.periods ?? [];
  return periods
    .filter((p) => Date.parse(p.endTime) > now.getTime())
    .slice(0, hours)
    .map((p) => {
      const ic = nwsIcon(p.icon, p.shortForecast);
      return { t: new Date(p.startTime).toISOString(), tempF: fToF(p.temperature, p.temperatureUnit), icon: ic.icon, condition: String(p.shortForecast ?? ''), popPct: p.probabilityOfPrecipitation?.value ?? null, windMph: parseNwsWind(p.windSpeed), isDay: p.isDaytime !== false };
    });
}

/** Today's high and low from the 12-hour forecast: the first daytime and the first night period. */
export function parseNwsHighLow(b: Json): { highF: number | null; lowF: number | null } {
  const periods: Json[] = b?.properties?.periods ?? [];
  const day = periods.slice(0, 3).find((p) => p.isDaytime);
  const night = periods.slice(0, 3).find((p) => !p.isDaytime);
  return { highF: day ? fToF(day.temperature, day.temperatureUnit) : null, lowF: night ? fToF(night.temperature, night.temperatureUnit) : null };
}

export function parseNwsObservation(b: Json): WeatherReport['current'] | null {
  const p = b?.properties;
  if (!p) return null;
  const ic = nwsIcon(p.icon, p.textDescription);
  return {
    tempF: cToF(p.temperature?.value), condition: String(p.textDescription ?? ''), icon: ic.icon, isDay: ic.isDay,
    windMph: kmhToMph(p.windSpeed?.value), windDir: compass(p.windDirection?.value), observedAt: p.timestamp ? new Date(p.timestamp).toISOString() : null,
  };
}

const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor'];

/** NWS alerts GeoJSON -> alerts, polygons flipped to [lat, lon]. Expired ones dropped. */
export function parseNwsAlerts(b: Json, now = new Date()): WeatherAlert[] {
  const feats: Json[] = b?.features ?? [];
  const out: WeatherAlert[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const expires = p.ends ?? p.expires ?? null;
    if (expires && Date.parse(expires) < now.getTime()) continue;
    const g = f.geometry;
    let polygon: WeatherAlert['polygon'] = null;
    if (g?.type === 'Polygon') polygon = (g.coordinates as number[][][]).map((ring) => ring.map(([lon, lat]) => [lat, lon] as [number, number]));
    else if (g?.type === 'MultiPolygon') polygon = (g.coordinates as number[][][][]).flatMap((poly) => poly.map((ring) => ring.map(([lon, lat]) => [lat, lon] as [number, number])));
    out.push({
      id: String(p.id ?? f.id ?? out.length), event: String(p.event ?? 'Alert'), headline: p.headline ?? null,
      severity: SEVERITIES.includes(p.severity) ? p.severity : 'Unknown',
      onset: p.onset ?? p.effective ?? null, expires,
      polygon,
    });
  }
  const rank = (s: string) => { const i = SEVERITIES.indexOf(s); return i < 0 ? 9 : i; };
  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** Open-Meteo forecast (temperature_unit=fahrenheit, wind_speed_unit=mph, timezone=auto) -> report fields. */
export function parseOpenMeteo(b: Json, now: Date, hours = 12): Pick<WeatherReport, 'current' | 'today' | 'hourly'> | null {
  if (!b?.current) return null;
  const off = Number(b.utc_offset_seconds ?? 0) * 1000;
  // Open-Meteo times are local wall-clock without an offset: "2026-11-05T13:30".
  const toIso = (s: string) => new Date(Date.parse(`${s}Z`) - off).toISOString();
  const cur = b.current;
  const cw = wmo(cur.weather_code);
  const h = b.hourly ?? {};
  const hourly: WeatherHour[] = [];
  const times: string[] = h.time ?? [];
  for (let i = 0; i < times.length && hourly.length < hours; i++) {
    const t = toIso(times[i]);
    if (Date.parse(t) + 3600_000 <= now.getTime()) continue;
    const w = wmo(h.weather_code?.[i]);
    const hr = new Date(Date.parse(t) + off).getUTCHours();
    hourly.push({ t, tempF: typeof h.temperature_2m?.[i] === 'number' ? Math.round(h.temperature_2m[i]) : null, icon: w.icon, condition: w.text, popPct: h.precipitation_probability?.[i] ?? null, windMph: typeof h.wind_speed_10m?.[i] === 'number' ? Math.round(h.wind_speed_10m[i]) : null, isDay: hr >= 6 && hr < 18 });
  }
  const d = b.daily ?? {};
  return {
    current: { tempF: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null, condition: cw.text, icon: cw.icon, isDay: cur.is_day !== 0, windMph: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null, windDir: compass(cur.wind_direction_10m), observedAt: cur.time ? toIso(cur.time) : null },
    today: { highF: typeof d.temperature_2m_max?.[0] === 'number' ? Math.round(d.temperature_2m_max[0]) : null, lowF: typeof d.temperature_2m_min?.[0] === 'number' ? Math.round(d.temperature_2m_min[0]) : null },
    hourly,
  };
}

/** The strip's one line, from a full report. */
export function briefOf(r: WeatherReport, now = Date.now()): WeatherBrief {
  return {
    place: r.place, tempF: r.current.tempF, icon: r.current.icon, condition: r.current.condition, isDay: r.current.isDay,
    highF: r.today.highF, lowF: r.today.lowF, windMph: r.current.windMph, windDir: r.current.windDir,
    fetchedAt: r.fetchedAt, stale: now - Date.parse(r.fetchedAt) > STALE_MS,
    alerts: r.alerts.filter((a) => !a.expires || Date.parse(a.expires) > now).map((a) => ({ event: a.event, severity: a.severity, expires: a.expires })),
  };
}

/** Should we fetch again? Pure: online, and 15 min old or 10 km away (or nothing yet). */
export function needsRefresh(last: { at: number; lat: number; lon: number } | null, pos: LatLon, now: number, online: boolean): boolean {
  if (!online) return false;
  if (!last) return true;
  if (now - last.at >= REFRESH_MS) return true;
  return haversineMi(last, pos) * 1.609344 >= MOVE_KM;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class WeatherService {
  report: WeatherReport | null = null;
  error: string | null = null;
  private db: Db;
  private ua: string;
  private fetchFn: Fetch;
  private busy = false;
  private failUntil = 0;

  constructor(db: Db, version: string, fetchFn: Fetch = fetch as unknown as Fetch) {
    this.db = db; this.ua = `slate-cockpit/${version}`; this.fetchFn = fetchFn;
    try {
      const row = db.prepare("SELECT body FROM http_cache WHERE key = 'weather:last'").get() as { body: string } | undefined;
      if (row) this.report = JSON.parse(row.body) as WeatherReport;
    } catch { /* no cache yet */ }
  }

  private async get(url: string, ms = 8000): Promise<Json> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await this.fetchFn(url, { headers: { 'user-agent': this.ua, accept: 'application/geo+json, application/json' }, signal: ctl.signal });
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      return (await res.json()) as Json;
    } finally { clearTimeout(t); }
  }

  /** NWS gridpoint lookups barely change: cached per ~1 km cell for a week. */
  private async point(lat: number, lon: number): Promise<NwsPoint | null> {
    const key = `nws:points:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const row = this.db.prepare('SELECT body, fetched_at FROM http_cache WHERE key = ?').get(key) as { body: string; fetched_at: string } | undefined;
    if (row && Date.now() - Date.parse(row.fetched_at) < 7 * 86_400_000) return JSON.parse(row.body) as NwsPoint | null;
    const p = parseNwsPoint(await this.get(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`));
    this.db.prepare('INSERT OR REPLACE INTO http_cache (key, fetched_at, body) VALUES (?, ?, ?)').run(key, new Date().toISOString(), JSON.stringify(p));
    return p;
  }

  private async fromNws(lat: number, lon: number, now: Date): Promise<Omit<WeatherReport, 'place' | 'sun' | 'fetchedAt' | 'lat' | 'lon'> & { town: string | null }> {
    const pt = await this.point(lat, lon);
    if (!pt) throw new Error('NWS has no forecast for this point (outside the US?)');
    const [daily, hourly, alerts] = await Promise.all([
      this.get(pt.forecast), this.get(pt.forecastHourly),
      this.get(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`).catch(() => null),
    ]);
    const hours = parseNwsHourly(hourly, now);
    let current: WeatherReport['current'] | null = null;
    try {
      const st = await this.get(pt.stations);
      const id = st?.features?.[0]?.properties?.stationIdentifier;
      if (id) current = parseNwsObservation(await this.get(`${NWS}/stations/${id}/observations/latest`));
    } catch { /* fall back to the first hourly period */ }
    const h0 = hours[0];
    if (!current || current.tempF === null) {
      current = { tempF: h0?.tempF ?? null, condition: current?.condition || h0?.condition || '', icon: current?.icon && current.icon !== 'unknown' ? current.icon : h0?.icon ?? 'unknown', isDay: h0?.isDay ?? true, windMph: current?.windMph ?? h0?.windMph ?? null, windDir: current?.windDir ?? null, observedAt: current?.observedAt ?? null };
    }
    if (current.icon === 'unknown' && h0) current.icon = h0.icon;
    if (!current.condition && h0) current.condition = h0.condition;
    return { source: 'nws', current, today: parseNwsHighLow(daily), hourly: hours, alerts: alerts ? parseNwsAlerts(alerts, now) : [], town: pt.city ? `${pt.city}${pt.state ? `, ${pt.state}` : ''}` : null };
  }

  private async fromOpenMeteo(lat: number, lon: number, now: Date) {
    const q = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2`;
    const r = parseOpenMeteo(await this.get(`${OPEN_METEO}?${q}`), now);
    if (!r) throw new Error('Open-Meteo answer had no current weather');
    return { source: 'open-meteo' as const, ...r, alerts: [] as WeatherAlert[], town: null };
  }

  /** Fetch now (NWS, else Open-Meteo). `placeName` names the spot from the stops chain; else NWS's nearest town. */
  async refresh(pos: LatLon, placeName: (p: LatLon) => string | null, now = new Date()): Promise<boolean> {
    if (this.busy || Date.now() < this.failUntil) return false;
    this.busy = true;
    try {
      let r;
      try { r = await this.fromNws(pos.lat, pos.lon, now); }
      catch (e) {
        try { r = await this.fromOpenMeteo(pos.lat, pos.lon, now); }
        catch (e2) { throw new Error(`NWS: ${(e as Error).message}; Open-Meteo: ${(e2 as Error).message}`); }
      }
      const sun = sunTimes(now, pos.lat, pos.lon);
      const { town, ...rest } = r;
      this.report = { ...rest, fetchedAt: now.toISOString(), lat: pos.lat, lon: pos.lon, place: placeName(pos) ?? town ?? this.report?.place ?? null, sun: { rise: sun?.rise.toISOString() ?? null, set: sun?.set.toISOString() ?? null } };
      this.error = null;
      this.db.prepare("INSERT OR REPLACE INTO http_cache (key, fetched_at, body) VALUES ('weather:last', ?, ?)").run(now.toISOString(), JSON.stringify(this.report));
      return true;
    } catch (e) {
      this.error = (e as Error).name === 'AbortError' ? 'Weather lookup timed out' : (e as Error).message;
      this.failUntil = Date.now() + FAIL_BACKOFF_MS;
      return false;
    } finally { this.busy = false; }
  }

  lastFetch() { return this.report ? { at: Date.parse(this.report.fetchedAt), lat: this.report.lat, lon: this.report.lon } : null; }
}
