// Alert labels, units and defaults. Pure (no Node APIs) so the settings page imports it too.
import type { AlertKind } from './types.ts';

/** What each alert's threshold means, its default, and its range. The UI shows `unit`. */
export const ALERT_META: Record<AlertKind, { label: string; unit: string | null; threshold: number | null; min?: number; max?: number; holdSec: number; cooldownMin: number }> = {
  cabinHot: { label: 'Cabin too hot (pet/kid check)', unit: '°F', threshold: 95, min: 60, max: 160, holdSec: 60, cooldownMin: 30 },
  low12v: { label: '12V battery low', unit: 'V', threshold: 12.0, min: 10, max: 13, holdSec: 120, cooldownMin: 240 },
  motionParked: { label: 'Motion or vibration while parked', unit: null, threshold: null, holdSec: 0, cooldownMin: 15 },
  theft: { label: 'Moved with no driver phone nearby', unit: 'm', threshold: 200, min: 50, max: 5000, holdSec: 0, cooldownMin: 30 },
  geofence: { label: 'Left a geofence at an unusual hour', unit: null, threshold: null, holdSec: 30, cooldownMin: 60 },
  chargeStopped: { label: 'Charging stopped early', unit: 'min', threshold: 10, min: 2, max: 120, holdSec: 0, cooldownMin: 60 },
  chargeDone: { label: 'Charging finished', unit: null, threshold: null, holdSec: 0, cooldownMin: 60 },
  unplugged: { label: 'Unplugged', unit: null, threshold: null, holdSec: 0, cooldownMin: 10 },
  tirePressure: { label: 'Tire pressure low', unit: 'psi', threshold: 30, min: 10, max: 80, holdSec: 60, cooldownMin: 240 },
  truckboxOffline: { label: 'Truck box offline', unit: 'min', threshold: 120, min: 5, max: 1440, holdSec: 0, cooldownMin: 720 },
};
export const ALERT_KINDS = Object.keys(ALERT_META) as AlertKind[];
