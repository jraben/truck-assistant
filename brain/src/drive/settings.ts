// Defaults and validation for the Track A settings blocks: Settings.truck,
// Settings.drive and Driver.drive. Pure. Called from ../settings.ts.
import type { Layout } from '../types.ts';
import { SPEEDO_STYLES, type DriverDrive, type DriveSettings, type TruckLook } from './types.ts';

export class DriveSettingsError extends Error {}

const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Slate's colour names (wrap, wheel decals, interior inserts, key fob caps).
 * Slate publishes no hex values, so every one is an approximation picked off
 * renders and photos (`approx: true`); the names are Slate's.
 */
export const WRAP_COLORS: { name: string; hex: string; approx: boolean }[] = [
  { name: 'Toolbox Red', hex: '#b5272d', approx: true },
  { name: 'Clean Slate', hex: '#e4e5e0', approx: true },
  { name: 'Tar Pit', hex: '#1c1d1f', approx: true },
  { name: 'Sterling Slate', hex: '#9da2a7', approx: true },
  { name: 'Slate Gray', hex: '#7d8287', approx: true },
  { name: 'Cardinal', hex: '#8a1c2b', approx: true },
  { name: 'Gold Rush', hex: '#d39b2a', approx: true },
  { name: 'Blue Bayou', hex: '#2f6f9f', approx: true },
  { name: 'Mint', hex: '#93d3b6', approx: true },
  { name: 'Emerald', hex: '#24785a', approx: true },
  { name: 'Synthwave', hex: '#ff3fb4', approx: true },
];
export const colorByName = (name: string) => WRAP_COLORS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

/** The accessories on the author's build (slate.auto share ABC123, 2026-11-05), as Slate names them. */
export const BUILD_ACCESSORIES = [
  'Bed Light Kit', 'The Five Switch | Upgrade Version', 'One-Key System | 2-Pack', 'PACKOUT System Mounting Plate | Large',
  'MOLLE Paneling Kit', 'Tailgate Lock Kit', 'Front Left + Right Integrated Speakers', 'Front Center Integrated Speaker',
  '17" Single Color Wheel Decals (Clean Slate / Satin)', 'Full Wrap (Toolbox Red / Satin)', 'Roof Partial Wrap (Clean Slate / Satin)',
  'Synthwave Front Lamp Plates', 'Truck Bed Organizer Slide Out Mat', 'MOLLE Pouch | Black | Large', '2" Rear Hitch Receiver Kit',
  'Classic Level 2 Wall Charger | Black', 'Door Armrest (Cardinal)', 'NEXUS Flip-Up Hard Tonneau Cover', 'Slate Telematics Module',
  'Key Fob End Cap (Sterling Slate)', 'Hands Free Bluetooth Controller', 'Tablet Mount', 'CCS to NACS Adapter',
];

const SHARE_CODE = /^[A-Za-z0-9]{4,16}$/;
/**
 * A Slate build link: https://www.slate.auto/share/<code>, or the configurator's
 * https://www.slate.auto/store?…shortcode=<code>. Returns the trimmed link and
 * its code, or null. Pure.
 */
export function parseSlateShareUrl(v: unknown): { url: string; code: string } | null {
  if (typeof v !== 'string' || v.length > 500) return null;
  let u: URL;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || (u.hostname !== 'www.slate.auto' && u.hostname !== 'slate.auto') || u.port || u.username || u.password) return null;
  const share = /^\/share\/([^/]+)\/?$/.exec(u.pathname);
  const code = share ? share[1] : /^\/store\/?$/.test(u.pathname) ? u.searchParams.get('shortcode') : null;
  if (!code || !SHARE_CODE.test(code)) return null;
  return { url: u.toString(), code };
}

const PHOTO_FILE = /^vehicle-photo\.(jpg|png|webp)$/;

/** The author's Slate as built (slate.auto share ABC123): editable in /settings, Truck. */
export function defaultTruck(): TruckLook {
  return {
    colors: { body: '#b5272d', roof: '#e4e5e0', logo: 'none', wheelDecal: '#e4e5e0', lampPlates: 'synthwave', trim: '#232427' },
    finish: 'satin',
    roofWrap: true,
    wheels: { inches: 17, style: 'steel' },
    accessories: { tonneau: 'nexus-flip', hitch: true, bedLights: true },
    interior: { bolster: 'none', armrest: 'Cardinal' },
    slateShareUrl: null,
    accessoryList: [...BUILD_ACCESSORIES],
    photo: null,
  };
}

export function defaultDrive(): DriveSettings {
  return {
    highwayMph: 45,
    efficiency: { cityMiPerKwh: 4.0, highwayMiPerKwh: 3.2, alpha: 0.2 },
    tilt: { warnDeg: 20, dangerDeg: 30 },
    heat: { throttleC: 75, warnC: 80, shutdownC: 85, parkedSunF: 110 },
    brightness: { auto: true, manualPct: 80, minPct: 10, maxPct: 100, nightMaxPct: 45 },
    speedLimits: true,
    lockoutMph: 5,
  };
}

export const defaultDriverDrive = (): DriverDrive => ({ speedo: 'auto', overLimitWarn: false, overLimitMph: 5 });

function num(v: unknown, name: string, min: number, max: number, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new DriveSettingsError(`${name} must be a number from ${min} to ${max}`);
  return v;
}
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
function hex(v: unknown, name: string, dflt: string, extra: string[] = []): string {
  if (v === undefined) return dflt;
  if (typeof v === 'string' && (HEX.test(v) || extra.includes(v))) return v.toLowerCase();
  throw new DriveSettingsError(`${name} must be #rrggbb${extra.length ? ` or ${extra.join(', ')}` : ''}`);
}

function colorName(v: unknown, name: string, dflt: string): string {
  if (v === undefined) return dflt;
  if (v === 'none') return 'none';
  const c = typeof v === 'string' ? colorByName(v) : undefined;
  if (!c) throw new DriveSettingsError(`${name} must be none or one of Slate's colour names (${WRAP_COLORS.map((x) => x.name).join(', ')})`);
  return c.name;
}

/** A stored photo record, or null for anything that isn't one (never throws: a bad record must not reset the settings file). */
function photoOf(v: unknown): TruckLook['photo'] {
  if (!isObj(v) || typeof v.file !== 'string' || !PHOTO_FILE.test(v.file) || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt))) return null;
  return { file: v.file, updatedAt: v.updatedAt, source: v.source === 'url' ? 'url' : 'upload' };
}

export function validateTruck(v: unknown): TruckLook {
  const d = defaultTruck();
  if (v === undefined || v === null) return d;
  if (!isObj(v)) throw new DriveSettingsError('truck must be an object');
  const c = isObj(v.colors) ? v.colors : {};
  const a = isObj(v.accessories) ? v.accessories : {};
  const i = isObj(v.interior) ? v.interior : {};
  const finish = v.finish === undefined ? d.finish : v.finish;
  if (finish !== 'satin' && finish !== 'gloss' && finish !== 'matte') throw new DriveSettingsError('truck.finish must be satin, gloss or matte');
  const tonneau = a.tonneau === undefined ? d.accessories.tonneau : a.tonneau;
  if (tonneau !== 'none' && tonneau !== 'nexus-flip') throw new DriveSettingsError('truck.accessories.tonneau must be none or nexus-flip');
  let slateShareUrl: string | null = null;
  if (v.slateShareUrl !== undefined && v.slateShareUrl !== null && v.slateShareUrl !== '') {
    const p = parseSlateShareUrl(v.slateShareUrl);
    if (!p) throw new DriveSettingsError('truck.slateShareUrl must be a Slate build link: https://www.slate.auto/share/<code>');
    slateShareUrl = p.url;
  }
  let accessoryList = d.accessoryList;
  if (v.accessoryList !== undefined) {
    if (!Array.isArray(v.accessoryList) || v.accessoryList.some((x) => typeof x !== 'string')) throw new DriveSettingsError('truck.accessoryList must be a list of names');
    accessoryList = (v.accessoryList as string[]).map((x) => x.trim().slice(0, 80)).filter(Boolean);
    if (accessoryList.length > 60) throw new DriveSettingsError('truck.accessoryList: at most 60 items');
  }
  return {
    colors: {
      body: hex(c.body, 'truck.colors.body', d.colors.body),
      roof: hex(c.roof, 'truck.colors.roof', d.colors.roof),
      logo: hex(c.logo, 'truck.colors.logo', d.colors.logo, ['none']),
      wheelDecal: hex(c.wheelDecal, 'truck.colors.wheelDecal', d.colors.wheelDecal),
      lampPlates: hex(c.lampPlates, 'truck.colors.lampPlates', d.colors.lampPlates, ['synthwave']),
      trim: hex(c.trim, 'truck.colors.trim', d.colors.trim),
    },
    finish,
    roofWrap: bool(v.roofWrap, d.roofWrap),
    wheels: { inches: 17, style: 'steel' },
    accessories: { tonneau, hitch: bool(a.hitch, d.accessories.hitch), bedLights: bool(a.bedLights, d.accessories.bedLights) },
    interior: { bolster: colorName(i.bolster, 'truck.interior.bolster', d.interior.bolster), armrest: colorName(i.armrest, 'truck.interior.armrest', d.interior.armrest) },
    slateShareUrl,
    accessoryList,
    photo: photoOf(v.photo),
  };
}

export function validateDrive(v: unknown): DriveSettings {
  const d = defaultDrive();
  if (v === undefined || v === null) return d;
  if (!isObj(v)) throw new DriveSettingsError('drive must be an object');
  const e = isObj(v.efficiency) ? v.efficiency : {}, t = isObj(v.tilt) ? v.tilt : {}, h = isObj(v.heat) ? v.heat : {}, b = isObj(v.brightness) ? v.brightness : {};
  const out: DriveSettings = {
    highwayMph: num(v.highwayMph, 'drive.highwayMph', 20, 80, d.highwayMph),
    efficiency: {
      cityMiPerKwh: num(e.cityMiPerKwh, 'drive.efficiency.cityMiPerKwh', 0.5, 10, d.efficiency.cityMiPerKwh),
      highwayMiPerKwh: num(e.highwayMiPerKwh, 'drive.efficiency.highwayMiPerKwh', 0.5, 10, d.efficiency.highwayMiPerKwh),
      alpha: num(e.alpha, 'drive.efficiency.alpha', 0.01, 1, d.efficiency.alpha),
    },
    tilt: { warnDeg: num(t.warnDeg, 'drive.tilt.warnDeg', 1, 60, d.tilt.warnDeg), dangerDeg: num(t.dangerDeg, 'drive.tilt.dangerDeg', 1, 80, d.tilt.dangerDeg) },
    heat: {
      throttleC: num(h.throttleC, 'drive.heat.throttleC', 40, 100, d.heat.throttleC),
      warnC: num(h.warnC, 'drive.heat.warnC', 40, 100, d.heat.warnC),
      shutdownC: num(h.shutdownC, 'drive.heat.shutdownC', 50, 110, d.heat.shutdownC),
      parkedSunF: num(h.parkedSunF, 'drive.heat.parkedSunF', 70, 180, d.heat.parkedSunF),
    },
    brightness: {
      auto: bool(b.auto, d.brightness.auto),
      manualPct: num(b.manualPct, 'drive.brightness.manualPct', 1, 100, d.brightness.manualPct),
      minPct: num(b.minPct, 'drive.brightness.minPct', 1, 100, d.brightness.minPct),
      maxPct: num(b.maxPct, 'drive.brightness.maxPct', 1, 100, d.brightness.maxPct),
      nightMaxPct: num(b.nightMaxPct, 'drive.brightness.nightMaxPct', 1, 100, d.brightness.nightMaxPct),
    },
    speedLimits: bool(v.speedLimits, d.speedLimits),
    lockoutMph: num(v.lockoutMph, 'drive.lockoutMph', 1, 30, d.lockoutMph),
  };
  if (out.tilt.dangerDeg < out.tilt.warnDeg) throw new DriveSettingsError('drive.tilt.dangerDeg must be at least warnDeg');
  if (!(out.heat.throttleC <= out.heat.warnC && out.heat.warnC < out.heat.shutdownC)) throw new DriveSettingsError('drive.heat: throttle ≤ warn < shutdown');
  if (out.brightness.minPct > out.brightness.maxPct) throw new DriveSettingsError('drive.brightness.minPct must be at most maxPct');
  return out;
}

export function validateDriverDrive(v: unknown, where = 'drive'): DriverDrive {
  const d = defaultDriverDrive();
  if (v === undefined || v === null) return d;
  if (!isObj(v)) throw new DriveSettingsError(`${where} must be an object`);
  const speedo = v.speedo === undefined ? d.speedo : v.speedo;
  if (speedo !== 'auto' && !(SPEEDO_STYLES as readonly unknown[]).includes(speedo)) throw new DriveSettingsError(`${where}.speedo must be auto or one of ${SPEEDO_STYLES.join(', ')}`);
  return {
    speedo: speedo as DriverDrive['speedo'],
    overLimitWarn: bool(v.overLimitWarn, d.overLimitWarn),
    overLimitMph: num(v.overLimitMph, `${where}.overLimitMph`, 0, 25, d.overLimitMph),
  };
}

/** The Drive view's widgets before Track A: the first default, then the one with Now playing. */
const LEGACY_DRIVE = [
  ['speed', 'soc', 'nextCharger', 'trip', 'cabin', 'aux12v', 'tilt'],
  ['speed', 'soc', 'nowPlaying', 'nextCharger', 'trip', 'cabin', 'aux12v', 'tilt'],
].map((t) => JSON.stringify(t));
export const DRIVE_VIEW = { id: 'drive', label: 'Drive', widgets: [{ type: 'drive', col: 1, row: 1, w: 12, h: 2 }] };

/** A layout whose Drive view is still an old default gets the new Drive screen; a customised one is left alone. */
export function migrateDriveLayout(l: Layout): Layout {
  const i = l.views.findIndex((v) => v.id === 'drive');
  if (i < 0 || !LEGACY_DRIVE.includes(JSON.stringify(l.views[i].widgets.map((w) => w.type)))) return l;
  const views = l.views.slice();
  views[i] = { ...structuredClone(DRIVE_VIEW), label: l.views[i].label };
  return { ...l, views };
}
