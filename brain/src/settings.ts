import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Layout, Settings } from './types.ts';
import { DEFAULT_LAYOUT } from './layout.ts';
import { defaultThemeSettings, migrateTheme, ThemeError, validateThemeSettings } from './themes.ts';

export const RELAY_IDS = ['relay_1', 'relay_2', 'relay_3', 'relay_4', 'relay_5', 'relay_6'] as const;

export { DEFAULT_LAYOUT } from './layout.ts';

export function defaultSettings(): Settings {
  return {
    truckId: 'slate',
    packKwh: 52.7,
    efficiencyMiPerKwh: 3.5,
    relays: {
      relay_1: 'Bed lights', relay_2: 'Light bar', relay_3: 'Rock lights',
      relay_4: 'Air compressor', relay_5: 'Bed fridge', relay_6: 'Inverter',
    },
    charging: {
      networks: ['Tesla', 'Electrify America'],
      avoidNetworks: [],
      minKw: 50,
      connector: 'NACS',
      maxDetourMi: 10,
      wantAmenities: ['restroom', 'food'],
      arriveMinSoc: 15,
    },
    keys: {},
    homeAssistant: { bridge: true },
    homeRate: { flatPerKwh: null, tou: [], fixedPerSession: 0 },
    homeLocation: null,
    compareMpg: 22,
    gasPrice: 3.5,
    theme: defaultThemeSettings(),
    layout: structuredClone(DEFAULT_LAYOUT),
  };
}

const MASK = '•';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys come back as "••••abcd" so the page can show that one is set without revealing it. */
export function maskKey(k: string | undefined): string | undefined {
  if (!k) return undefined;
  return MASK.repeat(4) + k.slice(-4);
}

export function maskSettings(s: Settings): Settings {
  const keys: Settings['keys'] = {};
  if (s.keys.afdc) keys.afdc = maskKey(s.keys.afdc);
  if (s.keys.openChargeMap) keys.openChargeMap = maskKey(s.keys.openChargeMap);
  return { ...s, keys };
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
 * Partial merge for PUT /api/settings. Objects merge, arrays and scalars replace.
 * keys: a masked value (contains the mask dot) means "unchanged"; "" or null deletes the key.
 * layout: replaced whole, never merged; null resets it to the default.
 * Throws SettingsError (a 400) on anything invalid, leaving the stored settings alone.
 */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  if (!isObj(patch)) throw new SettingsError('body must be a JSON object');
  const p: Record<string, unknown> = { ...patch };
  if ('theme' in p) p.theme = migrateTheme(p.theme);
  const keys = { ...base.keys };
  if ('keys' in p) {
    if (!isObj(p.keys)) throw new SettingsError('keys must be an object');
    for (const [k, v] of Object.entries(p.keys)) {
      if (k !== 'afdc' && k !== 'openChargeMap') continue;
      if (v === null || v === '') delete keys[k];
      else if (typeof v === 'string' && !v.includes(MASK)) keys[k] = v.trim();
    }
    delete p.keys;
  }
  let layout: Layout = base.layout;
  if ('layout' in p) {
    layout = p.layout === null ? structuredClone(DEFAULT_LAYOUT) : (structuredClone(p.layout) as Layout);
    delete p.layout;
  }
  const next = deepMerge({ ...base, layout: undefined, keys: undefined }, p) as Settings;
  next.keys = keys;
  next.layout = layout;
  return validate(next);
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

export function validate(s: Settings): Settings {
  if (typeof s.truckId !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(s.truckId)) throw new SettingsError('truckId: letters, digits, - and _ only');
  num(s.packKwh, 'packKwh', 1, 500);
  num(s.efficiencyMiPerKwh, 'efficiencyMiPerKwh', 0.5, 10);
  if (!isObj(s.relays)) throw new SettingsError('relays must be an object');
  for (const id of RELAY_IDS) {
    const v = s.relays[id];
    s.relays[id] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : defaultSettings().relays[id];
  }
  const c = s.charging;
  if (!isObj(c)) throw new SettingsError('charging must be an object');
  c.networks = strList(c.networks, 'charging.networks');
  c.avoidNetworks = strList(c.avoidNetworks, 'charging.avoidNetworks');
  c.wantAmenities = strList(c.wantAmenities, 'charging.wantAmenities').map((a) => a.toLowerCase());
  num(c.minKw, 'charging.minKw', 0, 1000);
  num(c.maxDetourMi, 'charging.maxDetourMi', 0.5, 500);
  num(c.arriveMinSoc, 'charging.arriveMinSoc', 0, 100);
  if (!['NACS', 'CCS', 'J1772', 'any'].includes(c.connector)) throw new SettingsError('charging.connector must be NACS, CCS, J1772 or any');
  if (!isObj(s.homeAssistant) || typeof s.homeAssistant.bridge !== 'boolean') throw new SettingsError('homeAssistant.bridge must be true or false');
  const ent = s.homeAssistant.homeChargerEnergyEntity as string | null | undefined;
  if (ent && !/^[a-z_]+\.[a-z0-9_]+$/.test(String(ent))) throw new SettingsError('homeAssistant.homeChargerEnergyEntity must look like sensor.wall_charger_session_energy');
  if (!ent) delete s.homeAssistant.homeChargerEnergyEntity;
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
  num(s.compareMpg, 'compareMpg', 1, 200);
  num(s.gasPrice, 'gasPrice', 0, 50);
  try { s.theme = validateThemeSettings(s.theme); } catch (e) { if (e instanceof ThemeError) throw new SettingsError(e.message); throw e; }
  if (!isObj(s.layout) || !Array.isArray(s.layout.views)) throw new SettingsError('layout must be {views: [...]}');
  for (const v of s.layout.views) {
    if (!isObj(v) || typeof v.id !== 'string' || typeof v.label !== 'string' || !Array.isArray(v.widgets)) throw new SettingsError('each layout view needs id, label and widgets');
    for (const w of v.widgets) {
      if (!isObj(w) || typeof w.type !== 'string') throw new SettingsError(`layout ${v.id}: widget type missing`);
      for (const k of ['col', 'row', 'w', 'h'] as const) if (!Number.isInteger(w[k]) || w[k] < 1 || w[k] > 24) throw new SettingsError(`layout ${v.id}/${w.type}: ${k} must be a whole number 1-24`);
    }
  }
  return s;
}

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
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      this.s = mergeSettings(defaultSettings(), { ...raw, layout: raw.layout ?? null });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[settings] ${this.file} unreadable, using defaults: ${(e as Error).message}`);
      this.write();
    }
  }

  get(): Settings { return this.s; }

  update(patch: unknown): Settings {
    const prev = this.s;
    this.s = mergeSettings(structuredClone(prev), patch);
    this.write();
    for (const l of this.listeners) { try { l(this.s, prev); } catch (e) { console.error('[settings] listener', e); } }
    return this.s;
  }

  onChange(l: Listener) { this.listeners.push(l); }

  private write() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
