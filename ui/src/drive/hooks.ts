// Track A helpers for any view: the drive state, the truck's look, the
// speedometer style, and the driving lockout other tracks can honour.
import { defaultDriverDrive, defaultTruck } from '../../../brain/src/drive/settings.ts';
import type { DriverDrive, SpeedoStyle, TruckLook } from '../../../brain/src/drive/types.ts';
import { activeDriver, settingsStore, stateStore, useStore, type Driver, type Settings, type State } from '../lib/brain.ts';
import { allThemes } from '../lib/theme.ts';

export const truckOf = (s: Settings | null): TruckLook => (s as (Settings & { truck?: TruckLook }) | null)?.truck ?? defaultTruck();
export const driverDrive = (d: Driver | null): DriverDrive => (d as (Driver & { drive?: DriverDrive }) | null)?.drive ?? defaultDriverDrive();

/** The style to draw: the driver's pick, or with "auto" the shown theme's pairing, else digital. */
export function speedoStyle(d: Driver | null): SpeedoStyle {
  const pick = driverDrive(d).speedo;
  if (pick !== 'auto') return pick;
  const id = document.documentElement.dataset.theme;
  const t = d ? allThemes(d.theme).find((x) => x.id === id) : undefined;
  return t?.speedo ?? 'digital';
}

/** Over the limit by more than the driver's tolerance, with their warning on. */
export function overLimit(mph: number | null, limit: number | null, dd: DriverDrive): boolean {
  return dd.overLimitWarn && mph !== null && limit !== null && mph > limit + dd.overLimitMph;
}

/** Moving over the lockout speed: video, the browser and long scrolling lists pause. */
export function useLockout(): { locked: boolean; bigTargets: boolean } {
  const s = useStore(stateStore);
  return s?.drive?.lockout ?? { locked: false, bigTargets: false };
}

export function useActiveDriver(): { s: State | null; settings: Settings | null; driver: Driver | null } {
  const s = useStore(stateStore);
  const settings = useStore(settingsStore);
  return { s, settings, driver: activeDriver(settings, s) };
}
