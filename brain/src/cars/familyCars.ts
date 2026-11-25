// The family's cars (docs/plans/plan-family-cars.md): read from the Traccar server on the NAS,
// where each car's tracker (and the Slate itself, brain/src/traccar.ts) reports. TA only READS,
// with a read-only Traccar user, over the LAN: GET /api/devices and /api/positions.
// Each car's OBD extras arrive as position attributes (batt, fuel, coolant, mil, dtcs, pending).
import type { FamilyCarsSettings } from '../types.ts';

export type CarCode = { code: string; pending: boolean };
export type FamilyCar = {
  id: number;
  name: string;
  category: string | null;
  status: 'online' | 'offline' | 'unknown';
  lastSeen: string | null;          // ISO: the newest of the device's lastUpdate and its fix time
  lat: number | null; lon: number | null;
  speedMph: number | null;
  moving: boolean;
  ignition: boolean | null;
  batteryV: number | null;          // the 12V battery (OBD adapter's AT RV), when reported
  fuelPct: number | null;
  coolantF: number | null;
  checkEngine: boolean | null;      // the MIL, when reported
  codes: CarCode[];
  odometerMi: number | null;
  /** Plain-words problems worth a glance, worst first. */
  warnings: string[];
};
export type FamilyCarsReport = { configured: boolean; cars: FamilyCar[]; error: string | null; fetchedAt: string | null };

type Device = { id: number; name?: string; uniqueId?: string; status?: string; lastUpdate?: string | null; positionId?: number; category?: string | null; disabled?: boolean };
type Position = { id: number; deviceId: number; fixTime?: string; latitude?: number; longitude?: number; speed?: number; attributes?: Record<string, unknown> };

const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const bool = (v: unknown): boolean | null => v === true || v === 'true' || v === 1 || v === '1' ? true : v === false || v === 'false' || v === 0 || v === '0' ? false : null;
const codeList = (v: unknown): string[] => (typeof v === 'string' ? v.split(/[\s,;]+/) : Array.isArray(v) ? v.map(String) : [])
  .map((c) => c.trim().toUpperCase()).filter((c) => /^[PCBU][0-3][0-9A-F]{3}$/.test(c));

/** Parked battery below 12.2 V warns, below 11.9 V may not start (the plan's alert levels). */
export const BATT_WARN_V = 12.2, BATT_BAD_V = 11.9;
/** A car that hasn't reported for a day while away is worth a look. */
export const STALE_MS = 24 * 3600_000;

/** Devices + their latest positions → one summary per car. Pure (tested). */
export function summarize(devices: Device[], positions: Position[], now = Date.now()): FamilyCar[] {
  const byDevice = new Map<number, Position>();
  for (const p of positions) { const o = byDevice.get(p.deviceId); if (!o || (p.id ?? 0) > (o.id ?? 0)) byDevice.set(p.deviceId, p); }
  return devices.filter((d) => !d.disabled).map((d): FamilyCar => {
    const p = byDevice.get(d.id);
    const a = p?.attributes ?? {};
    const speedMph = num(p?.speed) === null ? null : Math.round(num(p!.speed)! * 1.15078);
    const ignition = bool(a.ignition);
    const batteryV = num(a.batt) ?? num(a.power) ?? num(a.battery) ?? num(a.aux12v);
    const fuelPct = num(a.fuel) ?? num(a.fuelLevel);
    const coolantC = num(a.coolantC);
    const coolantF = num(a.coolant) ?? (coolantC === null ? null : Math.round(coolantC * 9 / 5 + 32));
    const codes = [...codeList(a.dtcs).map((code) => ({ code, pending: false })), ...codeList(a.pending).map((code) => ({ code, pending: true }))];
    const mil = bool(a.mil);
    const odoM = num(a.totalDistance) ?? num(a.odometer);
    const times = [d.lastUpdate, p?.fixTime].filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
    const lastSeen = times.length ? new Date(Math.max(...times.map((t) => Date.parse(t)))).toISOString() : null;
    const moving = (speedMph ?? 0) >= 3;
    const warnings: string[] = [];
    if (mil || codes.some((c) => !c.pending)) warnings.push(codes.length ? `Check engine: ${codes.filter((c) => !c.pending).map((c) => c.code).join(', ') || 'light on'}` : 'Check engine light on');
    if (batteryV !== null && !moving && ignition !== true && batteryV < BATT_BAD_V) warnings.push(`Battery ${batteryV.toFixed(1)} V: may not start`);
    else if (batteryV !== null && !moving && ignition !== true && batteryV < BATT_WARN_V) warnings.push(`Battery low (${batteryV.toFixed(1)} V)`);
    if (coolantF !== null && coolantF >= 230) warnings.push(`Running hot (${Math.round(coolantF)}°F)`);
    if (lastSeen && now - Date.parse(lastSeen) > STALE_MS) warnings.push('No report for over a day');
    return {
      id: d.id, name: d.name?.trim() || d.uniqueId || `Car ${d.id}`, category: d.category ?? null,
      status: d.status === 'online' || d.status === 'offline' ? d.status : 'unknown',
      lastSeen, lat: num(p?.latitude), lon: num(p?.longitude), speedMph, moving, ignition,
      batteryV: batteryV === null ? null : Math.round(batteryV * 10) / 10, fuelPct: fuelPct === null ? null : Math.round(fuelPct),
      coolantF: coolantF === null ? null : Math.round(coolantF), checkEngine: mil, codes,
      odometerMi: odoM === null ? null : Math.round(odoM / 1609.344), warnings,
    };
  }).sort((x, y) => y.warnings.length - x.warnings.length || x.name.localeCompare(y.name));
}

/** Reads Traccar at most every 30 s; a failure is reported in words, never thrown at the page. */
export class FamilyCars {
  private cache: { at: number; report: FamilyCarsReport } | null = null;
  private cfg: () => FamilyCarsSettings;
  private fetchFn: typeof fetch;
  constructor(cfg: () => FamilyCarsSettings, fetchFn: typeof fetch = fetch) { this.cfg = cfg; this.fetchFn = fetchFn; }

  async report(force = false, now = Date.now()): Promise<FamilyCarsReport> {
    const c = this.cfg();
    if (!c.url || !c.user || !c.password) return { configured: false, cars: [], error: null, fetchedAt: null };
    if (!force && this.cache && now - this.cache.at < 30_000) return this.cache.report;
    const base = c.url.replace(/\/+$/, '');
    const auth = `Basic ${Buffer.from(`${c.user}:${c.password}`).toString('base64')}`;
    const get = async <T>(path: string): Promise<T> => {
      const r = await this.fetchFn(`${base}${path}`, { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (r.status === 401) throw new Error('Traccar refused the login (check the user and password in Settings › Family cars)');
      if (!r.ok) throw new Error(`Traccar answered ${r.status} for ${path}`);
      return r.json() as Promise<T>;
    };
    let report: FamilyCarsReport;
    try {
      const [devices, positions] = await Promise.all([get<Device[]>('/api/devices'), get<Position[]>('/api/positions')]);
      report = { configured: true, cars: summarize(devices, positions, now), error: null, fetchedAt: new Date(now).toISOString() };
    } catch (e) {
      const m = (e as Error).name === 'TimeoutError' ? `Traccar at ${base} didn't answer (is the truck on the home network or the VPN?)` : (e as Error).message;
      report = { configured: true, cars: this.cache?.report.cars ?? [], error: m, fetchedAt: this.cache?.report.fetchedAt ?? null };
    }
    this.cache = { at: now, report };
    return report;
  }
}
