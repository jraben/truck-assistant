// Defaults and validation for the Track A settings blocks: Settings.truck,
// Settings.drive and Driver.drive. Pure. Called from ../settings.ts.
import type { Layout } from '../types.ts';
import { SPEEDO_STYLES, type DriverDrive, type DriveSettings, type TruckLook } from './types.ts';

export class DriveSettingsError extends Error {}

const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Slate's wrap colours, as near as a screen can show them (names from Slate's configurator). */
export const WRAP_COLORS: { name: string; hex: string }[] = [
  { name: 'Toolbox Red', hex: '#b5272d' },
  { name: 'Clean Slate', hex: '#e4e5e0' },
  { name: 'Tar Pit', hex: '#1c1d1f' },
  { name: 'Slate Gray', hex: '#7d8287' },
  { name: 'Gold Rush', hex: '#d39b2a' },
  { name: 'Blue Bayou', hex: '#2f6f9f' },
  { name: 'Mint Emerald', hex: '#5fbf97' },
  { name: 'Synthwave', hex: '#ff3fb4' },
];

/** Jeff's truck as configured (docs/drive-v2.md §2). */
export function defaultTruck(): TruckLook {
  return {
    colors: { body: '#b5272d', roof: '#e4e5e0', logo: '#1c1d1f', wheelDecal: '#e4e5e0', lampPlates: 'synthwave', trim: '#5e6368' },
    finish: 'satin',
    roofWrap: true,
    wheels: { inches: 17, style: 'steel' },
    accessories: { tonneau: 'nexus-flip', hitch: true, bedLights: true },
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

export function validateTruck(v: unknown): TruckLook {
  const d = defaultTruck();
  if (v === undefined || v === null) return d;
  if (!isObj(v)) throw new DriveSettingsError('truck must be an object');
  const c = isObj(v.colors) ? v.colors : {};
  const a = isObj(v.accessories) ? v.accessories : {};
  const finish = v.finish === undefined ? d.finish : v.finish;
  if (finish !== 'satin' && finish !== 'gloss' && finish !== 'matte') throw new DriveSettingsError('truck.finish must be satin, gloss or matte');
  const tonneau = a.tonneau === undefined ? d.accessories.tonneau : a.tonneau;
  if (tonneau !== 'none' && tonneau !== 'nexus-flip') throw new DriveSettingsError('truck.accessories.tonneau must be none or nexus-flip');
  return {
    colors: {
      body: hex(c.body, 'truck.colors.body', d.colors.body),
      roof: hex(c.roof, 'truck.colors.roof', d.colors.roof),
      logo: hex(c.logo, 'truck.colors.logo', d.colors.logo),
      wheelDecal: hex(c.wheelDecal, 'truck.colors.wheelDecal', d.colors.wheelDecal),
      lampPlates: hex(c.lampPlates, 'truck.colors.lampPlates', d.colors.lampPlates, ['synthwave']),
      trim: hex(c.trim, 'truck.colors.trim', d.colors.trim),
    },
    finish,
    roofWrap: bool(v.roofWrap, d.roofWrap),
    wheels: { inches: 17, style: 'steel' },
    accessories: { tonneau, hitch: bool(a.hitch, d.accessories.hitch), bedLights: bool(a.bedLights, d.accessories.bedLights) },
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

/** The Drive view's widgets before Track A (the old default). */
const LEGACY_DRIVE = JSON.stringify(['speed', 'soc', 'nowPlaying', 'nextCharger', 'trip', 'cabin', 'aux12v', 'tilt']);
export const DRIVE_VIEW = { id: 'drive', label: 'Drive', widgets: [{ type: 'drive', col: 1, row: 1, w: 12, h: 2 }] };

/** A layout whose Drive view is still the old default gets the new Drive screen; a customised one is left alone. */
export function migrateDriveLayout(l: Layout): Layout {
  const i = l.views.findIndex((v) => v.id === 'drive');
  if (i < 0 || JSON.stringify(l.views[i].widgets.map((w) => w.type)) !== LEGACY_DRIVE) return l;
  const views = l.views.slice();
  views[i] = { ...structuredClone(DRIVE_VIEW), label: l.views[i].label };
  return { ...l, views };
}
