// Driving lockouts. Pure. Over `lockoutMph` (default 5) the cockpit pauses
// video, the web browser and long scrolling lists; it unlocks only after the
// truck has been at or under that speed for UNLOCK_MS (a red light shouldn't
// flash the browser back up). At BIG_TARGET_MPH and over, touch targets grow.
export const UNLOCK_MS = 5_000;
export const BIG_TARGET_MPH = 25;

export type LockState = { locked: boolean; slowSince: number | null };

export function lockStep(prev: LockState, speedMph: number | null, now: number, lockoutMph: number): LockState {
  // No speed (no GPS fix): keep whatever we had, so a tunnel doesn't unlock anything.
  if (speedMph === null) return prev;
  if (speedMph > lockoutMph) return { locked: true, slowSince: null };
  if (!prev.locked) return { locked: false, slowSince: null };
  const since = prev.slowSince ?? now;
  return now - since >= UNLOCK_MS ? { locked: false, slowSince: null } : { locked: true, slowSince: since };
}

export const bigTargets = (speedMph: number | null) => speedMph !== null && speedMph >= BIG_TARGET_MPH;

// Passenger mode: someone other than the driver is using the tablet, so the
// content lockouts (video, the browser, long lists, typing, parked-only apps)
// stay open while moving. It never touches what keeps the truck safe: `locked`
// still means "moving", so camp/pet mode still end and the light strip still
// goes off. It is not saved: it lasts until the brain next starts (the truck's
// next startup), or until someone turns it off.

/** Whether video, the browser and long lists pause: moving over the lockout speed with no passenger at the tablet. */
export const contentLocked = (locked: boolean, passenger: boolean) => locked && !passenger;
