// Pure Drive-screen rules (tested in ui/test/drive.test.ts).
import type { DriverDrive } from '../../../brain/src/drive/types.ts';
import type { State } from '../../../brain/src/types.ts';

export type CardId = 'np' | 'since' | 'trip' | 'tilt' | 'goal';

/**
 * Which context cards, in order (at most 3): tilt first when it warns; moving =
 * media, trip, since charge; parked = since charge, tilt, media, then the
 * truck-payoff goal (`goal`: there is one to show). The goal never shows while
 * moving and never pushes out a card that was there before.
 */
export function pickCards(s: State | null, playing: boolean, goal = false): CardId[] {
  const moving = !!s?.drive?.lockout.locked;
  const lvl = s?.drive?.tilt.level;
  const out: CardId[] = [];
  if (lvl === 'warn' || lvl === 'danger') out.push('tilt');
  const rest: CardId[] = moving ? ['np', 'trip', 'since', 'tilt'] : ['since', 'tilt', 'np', 'trip', 'goal'];
  for (const c of rest) {
    if (out.includes(c)) continue;
    if (c === 'np' && !playing) continue;
    if (c === 'trip' && !s?.trip) continue;
    if (c === 'goal' && !goal) continue;
    out.push(c);
  }
  return out.slice(0, 3);
}

/** Over the limit by more than the driver's tolerance, with their warning on. */
export function overLimit(mph: number | null, limit: number | null, dd: DriverDrive): boolean {
  return dd.overLimitWarn && mph !== null && limit !== null && mph > limit + dd.overLimitMph;
}

/** The tilt card shows the owner's photo while parked (under 1 mph) and level enough; moving or steep, the live drawing returns. */
export function showTruckPhoto(s: State | null, hasPhoto: boolean): boolean {
  if (!hasPhoto) return false;
  const mph = s?.speedMph ?? 0;
  const lvl = s?.drive?.tilt.level ?? null;
  return mph < 1 && !s?.drive?.lockout.locked && lvl !== 'warn' && lvl !== 'danger';
}
