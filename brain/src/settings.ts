import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChargingPrefs, CompareVehicle, Driver, Layout, Settings, WifiNet } from './types.ts';
import { DEFAULT_LAYOUT } from './layout.ts';
import { defaultDrive, defaultDriverDrive, defaultTruck, DriveSettingsError, migrateDriveLayout, validateDrive, validateDriverDrive, validateTruck } from './drive/settings.ts';
import { defaultThemeSettings, migrateTheme, ThemeError, validateThemeSettings } from './themes.ts';

export const RELAY_IDS = ['relay_1', 'relay_2', 'relay_3', 'relay_4', 'relay_5', 'relay_6'] as const;

export { DEFAULT_LAYOUT } from './layout.ts';

export const GUEST_ID = 'guest';

export function defaultCharging(): ChargingPrefs {
  return {
    networks: ['Tesla', 'Electrify America'],
    avoidNetworks: [],
    minKw: 50,
    connector: 'NACS',
    maxDetourMi: 10,
    wantAmenities: ['restroom', 'food'],
    arriveMinSoc: 15,
  };
}

const initialsOf = (name: string) => name.trim().split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

/** A driver with default prefs. */
export function newDriver(id: string, name: string, opts: Partial<Pick<Driver, 'initials' | 'color' | 'tracker' | 'guest'>> = {}): Driver {
  return {
    id, name,
    initials: opts.initials ?? initialsOf(name),
    color: opts.color ?? '#4fc3d9',
    guest: opts.guest ?? false,
    tracker: opts.tracker ?? null,
    theme: defaultThemeSettings(),
    layout: structuredClone(DEFAULT_LAYOUT),
    charging: defaultCharging(),
    favouritePlaceIds: [],
    compareVehicle: null,
    hotspot: null,
    btTetherMac: null,
    drive: defaultDriverDrive(),
  };
}

export const customVehicle = (mpg: number): CompareVehicle => ({ id: null, label: 'Custom', mpgCity: mpg, mpgHighway: mpg, mpgCombined: mpg, fuel: 'regular' });

export const guestDriver = () => newDriver(GUEST_ID, 'Guest', { initials: 'G', color: '#8a99a5', guest: true });

/** The family, seeded only when settings have no drivers at all. */
export function seedDrivers(): Driver[] {
  return [
    newDriver('jeff', 'Jeff', { initials: 'J', color: '#4fc3d9', tracker: 'person.jeff' }),
    newDriver('sam', 'Sam', { initials: 'S', color: '#f2b33d', tracker: 'person.sam' }),
    newDriver('jordan', 'Jordan', { initials: 'JO', color: '#ff3fb4', tracker: 'person.jordan' }),
    guestDriver(),
  ];
}

export function defaultSettings(): Settings {
  return {
    truckId: 'slate',
    packKwh: 52.7,
    efficiencyMiPerKwh: 3.5,
    relays: {
      relay_1: 'Bed lights', relay_2: 'Light bar', relay_3: 'Rock lights',
      relay_4: 'Air compressor', relay_5: 'Bed fridge', relay_6: 'Inverter',
    },
    keys: {},
    homeAssistant: { bridge: true, url: null },
    homeRate: { flatPerKwh: null, tou: [], fixedPerSession: 0 },
    homeLocation: null,
    compareVehicle: customVehicle(22),
    gas: { source: 'manual', manualPrice: 3.5, haEntities: [], pick: 'cheapest' },
    placesFeed: { url: null },
    homeWifi: null,
    saveDataOnHotspot: true,
    truck: defaultTruck(),
    drive: defaultDrive(),
    drivers: seedDrivers(),
  };
}

const MASK = '•';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys come back as "••••abcd" so the page can show that one is set without revealing it. */
export function maskKey(k: string | undefined): string | undefined {
  if (!k) return undefined;
  return MASK.repeat(4) + k.slice(-4);
}

const KEY_NAMES = ['afdc', 'openChargeMap', 'placesFeed'] as const;

const maskWifi = (w: WifiNet | null): WifiNet | null => (w ? (w.password ? { ssid: w.ssid, password: maskKey(w.password) } : { ssid: w.ssid }) : null);

/** A driver as the API returns it: hotspot password masked. */
export const maskDriver = (d: Driver): Driver => ({ ...d, hotspot: maskWifi(d.hotspot) });

export function maskSettings(s: Settings): Settings {
  const keys: Settings['keys'] = {};
  for (const k of KEY_NAMES) if (s.keys[k]) keys[k] = maskKey(s.keys[k]);
  const homeAssistant = { ...s.homeAssistant };
  if (homeAssistant.token) homeAssistant.token = maskKey(homeAssistant.token); else delete homeAssistant.token;
  return { ...s, keys, homeAssistant, homeWifi: maskWifi(s.homeWifi), drivers: s.drivers.map(maskDriver) };
}

/** A Wi-Fi patch: a masked or missing password keeps the stored one (same network); "" clears it; null removes the network. */
function mergeWifi(base: WifiNet | null, patch: unknown): WifiNet | null {
  if (patch === null) return null;
  if (!isObj(patch)) return base;
  const ssid = typeof patch.ssid === 'string' ? patch.ssid : base?.ssid ?? '';
  const pw = patch.password;
  let password: string | undefined;
  if (pw === '' || pw === null) password = undefined;
  else if (typeof pw === 'string' && !pw.includes(MASK)) password = pw;
  else password = base && base.ssid === ssid ? base.password : undefined;
  return password ? { ssid, password } : { ssid };
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : structuredClone(patch);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : structuredClone(v);
  }
  return out;
}

export class SettingsError extends Error {}

/**
 * Old settings.json (before driver profiles) had theme, layout, charging and
 * gasPrice at the top. They move into the first driver (Jeff) and gas.manualPrice.
 * Pure: takes the parsed file, returns the new shape (unvalidated). Seeds the
 * family only when there are no drivers; always makes sure a Guest exists.
 */
export function migrateSettings(raw: unknown): Record<string, unknown> {
  const r: Record<string, unknown> = isObj(raw) ? structuredClone(raw) : {};
  if (typeof r.gasPrice === 'number' && !isObj(r.gas)) r.gas = { source: 'manual', manualPrice: r.gasPrice, haEntities: [], pick: 'cheapest' };
  delete r.gasPrice;
  if (typeof r.compareMpg === 'number' && !isObj(r.compareVehicle)) r.compareVehicle = customVehicle(r.compareMpg);
  delete r.compareMpg;
  const legacy: Record<string, unknown> = {};
  for (const k of ['theme', 'layout', 'charging'] as const) if (k in r) { legacy[k] = r[k]; delete r[k]; }
  if (!Array.isArray(r.drivers) || r.drivers.length === 0) {
    const drivers = seedDrivers();
    const jeff = drivers[0];
    if (legacy.theme !== undefined) jeff.theme = migrateTheme(legacy.theme) as Driver['theme'];
    if (isObj(legacy.layout) && Array.isArray(legacy.layout.views)) jeff.layout = legacy.layout as unknown as Layout;
    if (isObj(legacy.charging)) jeff.charging = deepMerge(jeff.charging, legacy.charging) as ChargingPrefs;
    r.drivers = drivers;
  } else if (!r.drivers.some((d) => isObj(d) && d.id === GUEST_ID)) {
    r.drivers = [...r.drivers, guestDriver()];
  }
  return r;
}

/** Was this file written before driver profiles? */
export const isPreDriverFile = (raw: unknown) => isObj(raw) && (!Array.isArray(raw.drivers) || 'gasPrice' in raw || 'compareMpg' in raw || 'theme' in raw || 'charging' in raw);

function applyKeys(base: Settings['keys'], v: unknown): Settings['keys'] {
  if (!isObj(v)) throw new SettingsError('keys must be an object');
  const keys = { ...base };
  for (const [k, val] of Object.entries(v)) {
    if (!(KEY_NAMES as readonly string[]).includes(k)) continue;
    const key = k as (typeof KEY_NAMES)[number];
    if (val === null || val === '') delete keys[key];
    else if (typeof val === 'string' && !val.includes(MASK)) keys[key] = val.trim();
  }
  return keys;
}

/**
 * Partial merge for PUT /api/settings. Objects merge, arrays and scalars replace.
 * keys and homeAssistant.token: a masked value (contains the mask dot) means
 * "unchanged"; "" or null deletes it. drivers are edited through /api/drivers
 * and ignored here. Throws SettingsError (a 400) on anything invalid, leaving
 * the stored settings alone.
 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  if (!isObj(patch)) throw new SettingsError('body must be a JSON object');
  const p: Record<string, unknown> = { ...patch };
  for (const k of ['theme', 'layout', 'charging'] as const) {
    if (k in p) throw new SettingsError(`${k} is per driver now: PUT /api/drivers/<id>`);
  }
  if (typeof p.gasPrice === 'number') p.gas = { ...(isObj(p.gas) ? p.gas : {}), manualPrice: p.gasPrice };
  delete p.gasPrice;
  if (typeof p.compareMpg === 'number') p.compareVehicle = customVehicle(p.compareMpg);
  delete p.compareMpg;
  delete p.drivers;
  let keys = base.keys;
  if ('keys' in p) { keys = applyKeys(base.keys, p.keys); delete p.keys; }
  let token = base.homeAssistant.token;
  if (isObj(p.homeAssistant) && 'token' in p.homeAssistant) {
    const t = p.homeAssistant.token;
    if (t === null || t === '') token = undefined;
    else if (typeof t === 'string' && !t.includes(MASK)) token = t.trim();
    const ha = { ...p.homeAssistant };
    delete ha.token;
    p.homeAssistant = ha;
  }
  const next = deepMerge({ ...base, keys: undefined, drivers: undefined }, p) as Settings;
  next.keys = keys;
  next.drivers = structuredClone(base.drivers);
  if (token) next.homeAssistant.token = token; else delete next.homeAssistant.token;
  if ('homeWifi' in p) next.homeWifi = mergeWifi(base.homeWifi, p.homeWifi);
  return validate(next);
}

/** Partial merge for PUT /api/drivers/:id. id and guest never change; layout is replaced whole (null = default). */
export function mergeDriver(base: Driver, patch: unknown): Driver {
  if (!isObj(patch)) throw new SettingsError('body must be a JSON object');
  const p: Record<string, unknown> = { ...patch };
  delete p.id; delete p.guest;
  if ('theme' in p) p.theme = migrateTheme(p.theme);
  let layout: Layout = base.layout;
  if ('layout' in p) {
    layout = p.layout === null ? structuredClone(DEFAULT_LAYOUT) : (structuredClone(p.layout) as Layout);
    delete p.layout;
  }
  const hotspot = 'hotspot' in p ? mergeWifi(base.hotspot, p.hotspot) : base.hotspot;
  delete p.hotspot;
  const next = deepMerge({ ...base, layout: undefined, hotspot: undefined }, p) as Driver;
  next.layout = layout;
  next.hotspot = hotspot;
  return validateDriver(next, base.id);
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new SettingsError(`${name} must be a number from ${min} to ${max}`);
  return v;
}
function strList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new SettingsError(`${name} must be a list of strings`);
  return v.map((x: string) => x.trim()).filter(Boolean);
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const HEXC = /^#[0-9a-f]{6}$/i;

export function validateCharging(c: unknown, where = 'charging'): ChargingPrefs {
  if (!isObj(c)) throw new SettingsError(`${where} must be an object`);
  const x = c as unknown as ChargingPrefs;
  x.networks = strList(x.networks, `${where}.networks`);
  x.avoidNetworks = strList(x.avoidNetworks, `${where}.avoidNetworks`);
  x.wantAmenities = strList(x.wantAmenities, `${where}.wantAmenities`).map((a) => a.toLowerCase());
  num(x.minKw, `${where}.minKw`, 0, 1000);
  num(x.maxDetourMi, `${where}.maxDetourMi`, 0.5, 500);
  num(x.arriveMinSoc, `${where}.arriveMinSoc`, 0, 100);
  if (!['NACS', 'CCS', 'J1772', 'any'].includes(x.connector)) throw new SettingsError(`${where}.connector must be NACS, CCS, J1772 or any`);
  return x;
}

export function validateLayout(l: unknown, where = 'layout'): Layout {
  if (!isObj(l) || !Array.isArray(l.views)) throw new SettingsError(`${where} must be {views: [...]}`);
  for (const v of l.views as Layout['views']) {
    if (!isObj(v) || typeof v.id !== 'string' || typeof v.label !== 'string' || !Array.isArray(v.widgets)) throw new SettingsError(`each ${where} view needs id, label and widgets`);
    for (const w of v.widgets) {
      if (!isObj(w) || typeof w.type !== 'string') throw new SettingsError(`${where} ${v.id}: widget type missing`);
      for (const k of ['col', 'row', 'w', 'h'] as const) if (!Number.isInteger(w[k]) || w[k] < 1 || w[k] > 24) throw new SettingsError(`${where} ${v.id}/${w.type}: ${k} must be a whole number 1-24`);
    }
  }
  return l as unknown as Layout;
}

export function validateVehicle(v: unknown, where = 'compareVehicle'): CompareVehicle {
  if (!isObj(v)) throw new SettingsError(`${where} must be {id, label, mpgCity, mpgHighway, mpgCombined, fuel}`);
  const id = v.id === null || v.id === undefined ? null : v.id;
  if (id !== null && (!Number.isInteger(id) || (id as number) <= 0)) throw new SettingsError(`${where}.id must be a fueleconomy.gov vehicle id or null`);
  const label = typeof v.label === 'string' && v.label.trim() ? v.label.trim().slice(0, 80) : 'Custom';
  const mpgCity = num(v.mpgCity, `${where}.mpgCity`, 1, 200), mpgHighway = num(v.mpgHighway, `${where}.mpgHighway`, 1, 200), mpgCombined = num(v.mpgCombined, `${where}.mpgCombined`, 1, 200);
  if (!['regular', 'midgrade', 'premium', 'diesel'].includes(v.fuel as string)) throw new SettingsError(`${where}.fuel must be regular, midgrade, premium or diesel`);
  return { id: id as number | null, label, mpgCity, mpgHighway, mpgCombined, fuel: v.fuel as CompareVehicle['fuel'] };
}

/** Wi-Fi network: SSID 1-32 bytes; WPA password 8-63 characters, or none (open network). */
export function validateWifi(w: unknown, where: string): WifiNet | null {
  if (w === null || w === undefined) return null;
  if (!isObj(w)) throw new SettingsError(`${where} must be {ssid, password} or null`);
  const ssid = typeof w.ssid === 'string' ? w.ssid.trim() : '';
  if (!ssid) return null;
  if (Buffer.byteLength(ssid) > 32) throw new SettingsError(`${where}.ssid is longer than 32 bytes`);
  if (w.password !== undefined && w.password !== null && w.password !== '') {
    if (typeof w.password !== 'string' || w.password.length < 8 || w.password.length > 63) throw new SettingsError(`${where}.password must be 8 to 63 characters (WPA)`);
    return { ssid, password: w.password };
  }
  return { ssid };
}

export function validateDriver(d: unknown, idHint: string | number = '?'): Driver {
  if (!isObj(d)) throw new SettingsError(`driver ${idHint} must be an object`);
  const x = d as unknown as Driver;
  const where = `driver ${typeof x.id === 'string' ? x.id : idHint}`;
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(x.id)) throw new SettingsError(`${where}: id must be lowercase letters, digits and -`);
  if (typeof x.name !== 'string' || !x.name.trim()) throw new SettingsError(`${where}: name is required`);
  x.name = x.name.trim().slice(0, 30);
  x.initials = typeof x.initials === 'string' && x.initials.trim() ? x.initials.trim().slice(0, 3).toUpperCase() : initialsOf(x.name);
  if (typeof x.color !== 'string' || !HEXC.test(x.color)) throw new SettingsError(`${where}: color must be #rrggbb`);
  x.color = x.color.toLowerCase();
  x.guest = x.id === GUEST_ID;
  if (x.tracker === undefined || x.tracker === '') x.tracker = null;
  if (x.tracker !== null && (typeof x.tracker !== 'string' || !/^(person|device_tracker)\.[a-z0-9_]+$/.test(x.tracker))) throw new SettingsError(`${where}: tracker must look like person.jeff or device_tracker.jeffs_iphone`);
  try { x.theme = validateThemeSettings(x.theme); } catch (e) { if (e instanceof ThemeError) throw new SettingsError(`${where}: ${e.message}`); throw e; }
  x.layout = migrateDriveLayout(validateLayout(x.layout, `${where} layout`));
  x.charging = validateCharging(x.charging, `${where} charging`);
  if (!Array.isArray(x.favouritePlaceIds) || x.favouritePlaceIds.some((n) => !Number.isInteger(n))) x.favouritePlaceIds = [];
  if (x.guest) x.favouritePlaceIds = [];
  x.compareVehicle = x.compareVehicle === undefined || x.compareVehicle === null ? null : validateVehicle(x.compareVehicle, `${where} compareVehicle`);
  x.hotspot = validateWifi(x.hotspot, `${where} hotspot`);
  if (x.btTetherMac === undefined || x.btTetherMac === '') x.btTetherMac = null;
  if (x.btTetherMac !== null) {
    if (typeof x.btTetherMac !== 'string' || !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(x.btTetherMac.trim())) throw new SettingsError(`${where}: btTetherMac must look like AA:BB:CC:DD:EE:FF`);
    x.btTetherMac = x.btTetherMac.trim().replace(/-/g, ':').toUpperCase();
  }
  try { x.drive = validateDriverDrive(x.drive, `${where} drive`); } catch (e) { if (e instanceof DriveSettingsError) throw new SettingsError(e.message); throw e; }
  return x;
}

export function validate(s: Settings): Settings {
  if (typeof s.truckId !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(s.truckId)) throw new SettingsError('truckId: letters, digits, - and _ only');
  num(s.packKwh, 'packKwh', 1, 500);
  num(s.efficiencyMiPerKwh, 'efficiencyMiPerKwh', 0.5, 10);
  if (!isObj(s.relays)) throw new SettingsError('relays must be an object');
  for (const id of RELAY_IDS) {
    const v = s.relays[id];
    s.relays[id] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : defaultSettings().relays[id];
  }
  const ha = s.homeAssistant;
  if (!isObj(ha) || typeof ha.bridge !== 'boolean') throw new SettingsError('homeAssistant.bridge must be true or false');
  const ent = ha.homeChargerEnergyEntity as string | null | undefined;
  if (ent && !ENTITY.test(String(ent))) throw new SettingsError('homeAssistant.homeChargerEnergyEntity must look like sensor.wall_charger_session_energy');
  if (!ent) delete ha.homeChargerEnergyEntity;
  if (ha.url === undefined || ha.url === '') ha.url = null;
  if (ha.url !== null) {
    if (typeof ha.url !== 'string' || !/^https?:\/\/[^\s/]+/i.test(ha.url.trim())) throw new SettingsError('homeAssistant.url must start with http:// or https:// (e.g. http://homeassistant.local:8123)');
    ha.url = ha.url.trim().replace(/\/+$/, '');
  }
  if (ha.token !== undefined && (typeof ha.token !== 'string' || !ha.token)) delete ha.token;
  const r = s.homeRate;
  if (!isObj(r)) throw new SettingsError('homeRate must be an object');
  if (r.flatPerKwh !== null) num(r.flatPerKwh, 'homeRate.flatPerKwh', 0, 5);
  num(r.fixedPerSession, 'homeRate.fixedPerSession', 0, 100);
  if (!Array.isArray(r.tou)) throw new SettingsError('homeRate.tou must be a list');
  r.tou.forEach((t, i) => {
    if (!isObj(t) || typeof t.name !== 'string') throw new SettingsError(`homeRate.tou[${i}].name must be text`);
    if (!HHMM.test(t.start) || !HHMM.test(t.end)) throw new SettingsError(`homeRate.tou[${i}] start and end must be HH:MM, 24-hour`);
    if (!Array.isArray(t.days) || t.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new SettingsError(`homeRate.tou[${i}].days must be 0 (Sun) to 6 (Sat)`);
    num(t.perKwh, `homeRate.tou[${i}].perKwh`, 0, 5);
  });
  if (s.homeLocation !== null && s.homeLocation !== undefined) {
    if (!isObj(s.homeLocation)) throw new SettingsError('homeLocation must be {lat, lon} or null');
    num(s.homeLocation.lat, 'homeLocation.lat', -90, 90);
    num(s.homeLocation.lon, 'homeLocation.lon', -180, 180);
    s.homeLocation = { lat: s.homeLocation.lat, lon: s.homeLocation.lon };
  } else s.homeLocation = null;
  s.compareVehicle = validateVehicle(s.compareVehicle, 'compareVehicle');
  const g = s.gas;
  if (!isObj(g)) throw new SettingsError('gas must be an object');
  if (g.source !== 'manual' && g.source !== 'ha') throw new SettingsError('gas.source must be manual or ha');
  num(g.manualPrice, 'gas.manualPrice', 0, 50);
  g.haEntities = strList(g.haEntities, 'gas.haEntities');
  for (const e of g.haEntities) if (!ENTITY.test(e)) throw new SettingsError(`gas.haEntities: "${e}" must look like sensor.shell_regular_gas`);
  if (g.pick !== 'cheapest' && g.pick !== 'average') throw new SettingsError('gas.pick must be cheapest or average');
  s.homeWifi = validateWifi(s.homeWifi, 'homeWifi');
  if (typeof s.saveDataOnHotspot !== 'boolean') s.saveDataOnHotspot = true;
  if (!isObj(s.placesFeed)) s.placesFeed = { url: null };
  const fu = s.placesFeed.url as unknown;
  if (fu === undefined || fu === '' || fu === null) s.placesFeed.url = null;
  else if (typeof fu !== 'string' || !/^https?:\/\/\S+$/i.test(fu.trim())) throw new SettingsError('placesFeed.url must start with http:// or https://');
  else s.placesFeed.url = fu.trim();
  try { s.truck = validateTruck(s.truck); s.drive = validateDrive(s.drive); } catch (e) { if (e instanceof DriveSettingsError) throw new SettingsError(e.message); throw e; }
  if (!Array.isArray(s.drivers)) throw new SettingsError('drivers must be a list');
  s.drivers = s.drivers.map((d, i) => validateDriver(d, i));
  if (new Set(s.drivers.map((d) => d.id)).size !== s.drivers.length) throw new SettingsError('two drivers have the same id');
  if (!s.drivers.some((d) => d.guest)) s.drivers.push(guestDriver());
  return s;
}

/** Defaults + a migrated file, validated. Pure (for tests and the store). */
export function loadSettings(migrated: Record<string, unknown>): Settings {
  const base = defaultSettings();
  const merged = deepMerge({ ...base, drivers: undefined }, { ...migrated, drivers: undefined }) as Settings;
  const raw = Array.isArray(migrated.drivers) ? migrated.drivers : base.drivers;
  merged.drivers = raw.map((d) => {
    if (!isObj(d)) return d as unknown as Driver;
    const def = newDriver(String(d.id ?? 'x'), String(d.name ?? 'Driver'));
    const out = deepMerge({ ...def, layout: undefined }, { ...d, layout: undefined }) as Driver;
    out.layout = isObj(d.layout) ? (structuredClone(d.layout) as unknown as Layout) : def.layout;
    if (d.theme !== undefined) out.theme = migrateTheme(d.theme) as Driver['theme'];
    return out;
  });
  return validate(merged);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'driver';

type Listener = (s: Settings, prev: Settings) => void;

/** settings.json in DATA_DIR. Written atomically (temp + rename) so a power cut can't leave half a file. */
export class SettingsStore {
  private file: string;
  private s: Settings;
  private listeners: Listener[] = [];

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'settings.json');
    this.s = defaultSettings();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[settings] ${this.file} unreadable, using defaults: ${(e as Error).message}`);
      this.write();
      return;
    }
    try {
      this.s = loadSettings(migrateSettings(raw));
      if (isPreDriverFile(raw)) {
        writeFileSync(this.file + '.pre-drivers.bak', JSON.stringify(raw, null, 2), { mode: 0o600 });
        console.log('[settings] moved settings.json to driver profiles (old copy kept as settings.json.pre-drivers.bak)');
        this.write();
      }
    } catch (e) {
      console.warn(`[settings] ${this.file} invalid, using defaults: ${(e as Error).message}`);
    }
  }

  get(): Settings { return this.s; }

  update(patch: unknown): Settings {
    return this.commit(mergeSettings(structuredClone(this.s), patch));
  }

  driver(id: string | null | undefined): Driver | undefined { return id ? this.s.drivers.find((d) => d.id === id) : undefined; }

  addDriver(input: unknown): Driver {
    if (!isObj(input)) throw new SettingsError('body must be a JSON object');
    if (typeof input.name !== 'string' || !input.name.trim()) throw new SettingsError('name is required');
    const taken = new Set(this.s.drivers.map((d) => d.id));
    let id = slug(input.name), n = 2;
    while (taken.has(id)) id = `${slug(input.name)}-${n++}`;
    const d = mergeDriver(newDriver(id, input.name.trim()), { initials: input.initials, color: input.color ?? '#4fc3d9', tracker: input.tracker ?? null });
    const named = this.s.drivers.filter((x) => !x.guest), guests = this.s.drivers.filter((x) => x.guest);
    this.commit({ ...structuredClone(this.s), drivers: structuredClone([...named, d, ...guests]) });
    return d;
  }

  updateDriver(id: string, patch: unknown): Driver | null {
    const cur = this.driver(id);
    if (!cur) return null;
    const d = mergeDriver(structuredClone(cur), patch);
    this.commit({ ...structuredClone(this.s), drivers: this.s.drivers.map((x) => (x.id === id ? d : structuredClone(x))) });
    return this.driver(id)!;
  }

  deleteDriver(id: string): boolean {
    const cur = this.driver(id);
    if (!cur) return false;
    if (cur.guest) throw new SettingsError('the Guest profile is built in and stays');
    if (this.s.drivers.filter((d) => !d.guest).length <= 1) throw new SettingsError('keep at least one named driver');
    this.commit({ ...structuredClone(this.s), drivers: structuredClone(this.s.drivers.filter((x) => x.id !== id)) });
    return true;
  }

  onChange(l: Listener) { this.listeners.push(l); }

  private commit(next: Settings): Settings {
    const prev = this.s;
    this.s = validate(next);
    this.write();
    for (const l of this.listeners) { try { l(this.s, prev); } catch (e) { console.error('[settings] listener', e); } }
    return this.s;
  }

  private write() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
