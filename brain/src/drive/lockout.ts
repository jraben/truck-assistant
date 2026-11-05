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
