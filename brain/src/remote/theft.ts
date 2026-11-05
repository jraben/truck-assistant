// Theft: "moved without a driver". Pure.
//
// When the truck parks (ignition off) the brain remembers where. If it later
// shows up more than `radiusM` (default 200 m) from there:
//   - a driver's phone is at the truck (Home Assistant presence, the same test
//     as the driver suggestion: within 150 m, heard in the last 10 minutes)
//     -> someone is driving it: re-arm at the new spot, no alert;
//   - no driver phone at the truck -> alert;
//   - Home Assistant isn't set up, so presence is unknown -> alert only when
//     the ignition is off (towed / carried off), never for an ordinary drive.
// The always-on watch (tier 1) runs the ignition-off half on its own while the
// Pi sleeps (firmware/watch), because the Pi can't ask HA anything then.
import { metersBetween, type LatLon } from '../geo.ts';

export type TheftInput = {
  park: LatLon | null;              // where it was parked; null = not armed
  pos: LatLon | null;               // where it is now (GPS fix or the watch's)
  ignition: boolean | null;
  driversNear: string[] | null;     // names whose phone is at the truck; null = presence unknown (no HA)
  radiusM: number;
};

export type TheftVerdict =
  | { kind: 'ok'; movedM: number }
  | { kind: 'drive'; movedM: number; drivers: string[] }   // a driver is with it: re-arm here
  | { kind: 'theft'; movedM: number; why: string };

export function theftCheck(i: TheftInput): TheftVerdict {
  if (!i.park || !i.pos) return { kind: 'ok', movedM: 0 };
  const movedM = metersBetween(i.park, i.pos);
  if (movedM <= i.radiusM) return { kind: 'ok', movedM };
  if (i.driversNear === null) {
    return i.ignition === true ? { kind: 'ok', movedM } : { kind: 'theft', movedM, why: 'with the ignition off (no presence check: Home Assistant is not connected)' };
  }
  if (i.driversNear.length) return { kind: 'drive', movedM, drivers: i.driversNear };
  return { kind: 'theft', movedM, why: i.ignition === true ? 'with the ignition on and no driver phone nearby' : 'with no driver phone nearby' };
}
