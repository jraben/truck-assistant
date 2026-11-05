// Station data: NREL AFDC and Open Charge Map, mapped to one Station shape,
// then merged so a site listed by both shows once.
import { metersBetween } from '../geo.ts';
import type { Station } from './score.ts';

export const AFDC_URL = 'https://developer.nrel.gov/api/alt-fuel-stations/v1/nearest.json';
export const OCM_URL = 'https://api.openchargemap.io/v3/poi';
const TIMEOUT_MS = 10_000;

/** AFDC and OCM spell connectors their own way; normalise to NACS / CCS / J1772 / CHAdeMO. */
export function normalizeConnector(raw: string): string | null {
  const s = raw.toUpperCase();
  if (s.includes('J3400') || s.includes('NACS') || s.includes('TESLA')) return 'NACS';
  if (s.includes('COMBO') || s.includes('CCS')) return 'CCS';
  if (s.includes('CHADEMO')) return 'CHAdeMO';
  if (s.includes('J1772') || s.includes('TYPE 1')) return 'J1772';
  return null;
}

/** AFDC facility_type -> the amenity words the settings page uses. Nothing more is inferred. */
const FACILITY_AMENITIES: Record<string, string[]> = {
  RESTAURANT: ['food', 'restroom'], CONVENIENCE_STORE: ['food', 'restroom'], GROCERY: ['food', 'restroom'],
  GAS_STATION: ['food', 'restroom'], TRUCK_STOP: ['food', 'restroom'], TRAVEL_CENTER: ['food', 'restroom'],
  HOTEL: ['restroom'], INN: ['restroom'], SHOPPING_CENTER: ['food', 'restroom'], SHOPPING_MALL: ['food', 'restroom'],
  COFFEE_SHOP: ['food', 'coffee', 'restroom'], PARKING_GARAGE: ['shade'], PARKING_LOT: [], CAR_DEALER: ['restroom'],
  LIBRARY: ['restroom'], REST_STOP: ['restroom'], PHARMACY: ['restroom'], STANDALONE_STATION: [],
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export type FetchFn = typeof fetch;

export async function fetchAfdc(key: string, lat: number, lon: number, radiusMi: number, f: FetchFn = fetch): Promise<Station[]> {
  const u = new URL(AFDC_URL);
  u.search = new URLSearchParams({
    api_key: key, latitude: String(lat), longitude: String(lon), radius: String(radiusMi),
    fuel_type: 'ELEC', status: 'E', access: 'public', limit: '60',
  }).toString();
  const res = await f(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`AFDC answered ${res.status}${res.status === 403 || res.status === 401 ? ' (check the API key)' : ''}`);
  const body = (await res.json()) as { fuel_stations?: Record<string, unknown>[] };
  return (body.fuel_stations ?? []).map(afdcStation).filter((s): s is Station => s !== null);
}

export function afdcStation(r: Record<string, unknown>): Station | null {
  const lat = Number(r.latitude), lon = Number(r.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const connectors = uniq(((r.ev_connector_types as string[] | null) ?? []).map(normalizeConnector).filter((c): c is string => !!c));
  const dc = Number(r.ev_dc_fast_num ?? 0) || 0;
  const l2 = Number(r.ev_level2_evse_num ?? 0) || 0;
  const facility = typeof r.facility_type === 'string' ? r.facility_type : '';
  return {
    id: `afdc:${r.id}`, source: 'afdc',
    name: String(r.station_name ?? 'Charger'),
    network: typeof r.ev_network === 'string' && r.ev_network !== 'Non-Networked' ? r.ev_network : null,
    lat, lon, maxKw: null, connectors,
    amenities: FACILITY_AMENITIES[facility] ?? [],
    price: typeof r.ev_pricing === 'string' && r.ev_pricing.trim() ? r.ev_pricing.trim() : null,
    level2Only: dc === 0 && l2 > 0,
  };
}

export async function fetchOcm(key: string, lat: number, lon: number, radiusMi: number, f: FetchFn = fetch): Promise<Station[]> {
  const u = new URL(OCM_URL);
  u.search = new URLSearchParams({
    output: 'json', latitude: String(lat), longitude: String(lon), distance: String(radiusMi), distanceunit: 'Miles',
    maxresults: '60', compact: 'false', verbose: 'false', key,
  }).toString();
  const res = await f(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json', 'x-api-key': key } });
  if (!res.ok) throw new Error(`Open Charge Map answered ${res.status}${res.status === 403 || res.status === 401 ? ' (check the API key)' : ''}`);
  const body = (await res.json()) as Record<string, unknown>[];
  return (Array.isArray(body) ? body : []).map(ocmStation).filter((s): s is Station => s !== null);
}

export function ocmStation(r: Record<string, any>): Station | null {
  const a = r.AddressInfo ?? {};
  const lat = Number(a.Latitude), lon = Number(a.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const conns: Record<string, any>[] = Array.isArray(r.Connections) ? r.Connections : [];
  const kws = conns.map((c) => Number(c.PowerKW)).filter((k) => Number.isFinite(k) && k > 0);
  const connectors = uniq(conns.map((c) => normalizeConnector(String(c.ConnectionType?.Title ?? c.ConnectionType?.FormalName ?? ''))).filter((c): c is string => !!c));
  const op = r.OperatorInfo?.Title;
  const level2Only = conns.length > 0 && conns.every((c) => Number(c.LevelID ?? c.Level?.ID) === 2) && kws.length === 0;
  return {
    id: `ocm:${r.ID}`, source: 'ocm',
    name: String(a.Title ?? 'Charger'),
    network: typeof op === 'string' && !/unknown|business owner/i.test(op) ? op : null,
    lat, lon,
    maxKw: kws.length ? Math.max(...kws) : null,
    connectors, amenities: [],
    price: typeof r.UsageCost === 'string' && r.UsageCost.trim() ? r.UsageCost.trim() : null,
    level2Only,
  };
}

/** Same site in both feeds: within this many metres. */
export const DEDUPE_M = 120;

/**
 * Merge AFDC and OCM. A pair within DEDUPE_M is one site: AFDC keeps the id and
 * name (DOE-maintained), OCM fills in kW, connectors union, price from either.
 */
export function mergeStations(afdc: Station[], ocm: Station[]): Station[] {
  const out = afdc.map((s) => ({ ...s }));
  for (const o of ocm) {
    const twin = out.find((s) => s.source === 'afdc' && metersBetween(s, o) <= DEDUPE_M);
    if (!twin) { out.push({ ...o }); continue; }
    twin.maxKw = Math.max(twin.maxKw ?? 0, o.maxKw ?? 0) || null;
    twin.connectors = uniq([...twin.connectors, ...o.connectors]);
    twin.amenities = uniq([...twin.amenities, ...o.amenities]);
    twin.price ??= o.price;
    twin.network ??= o.network;
    if (o.maxKw !== null) twin.level2Only = false;
  }
  // Also collapse duplicates inside one feed (multi-listing of one site).
  const res: Station[] = [];
  for (const s of out) {
    const dup = res.find((r) => r.source === s.source && metersBetween(r, s) <= 15 && r.name === s.name);
    if (dup) { dup.connectors = uniq([...dup.connectors, ...s.connectors]); dup.maxKw = Math.max(dup.maxKw ?? 0, s.maxKw ?? 0) || null; }
    else res.push(s);
  }
  return res;
}
