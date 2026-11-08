// Pure Drive-screen rules (tested in ui/test/drive.test.ts).
import type { DriverDrive } from '../../../brain/src/drive/types.ts';
import type { State } from '../../../brain/src/types.ts';

export type CardId = 'np' | 'since' | 'trip' | 'tilt' | 'goal';

/**
 * Which context cards, in order (at most 2; the truck in the middle already
 * shows the tilt): tilt first only when it warns; moving = media, trip, since
 * charge; parked = since charge, media, trip, then the truck-payoff goal
 * (`goal`: there is one to show). The goal never shows while moving.
 */
export function pickCards(s: State | null, playing: boolean, goal = false): CardId[] {
  const moving = !!s?.drive?.lockout.locked;
  const lvl = s?.drive?.tilt.level;
  const out: CardId[] = [];
  if (lvl === 'warn' || lvl === 'danger') out.push('tilt');
  const rest: CardId[] = moving ? ['np', 'trip', 'since'] : ['since', 'np', 'trip', 'goal'];
  for (const c of rest) {
    if (c === 'np' && !playing) continue;
    if (c === 'trip' && !s?.trip) continue;
    if (c === 'goal' && !goal) continue;
    out.push(c);
  }
  return out.slice(0, 2);
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

// ---- drive power (the power ring) -------------------------------------------------------
// Until the CAN bus reports the motor's real kW, the power ring shows an estimate
// worked out from speed and how fast it is changing: rolling resistance, air drag and
// the force to speed up, at the wheels, then to the battery. Labelled an estimate.
const MASS_KG = 1750;          // the truck plus a driver
const CRR = 0.012, CDA = 1.0, AIR = 1.2, G = 9.81;
const DRIVE_EFF = 0.88, REGEN_EFF = 0.65;
export const RING_OUT_KW = 150, RING_REGEN_KW = 60;

/** Battery kW: positive = power out, negative = regen. Pure (tested). */
export function estimateDriveKw(mph: number, accelMps2: number): number {
  const v = Math.max(0, mph) * 0.44704;
  if (v < 0.3 && accelMps2 <= 0) return 0;
  const f = (v > 0.3 ? CRR * MASS_KG * G : 0) + 0.5 * AIR * CDA * v * v + MASS_KG * accelMps2;
  const wheelKw = (f * v) / 1000;
  const kw = wheelKw >= 0 ? wheelKw / DRIVE_EFF : wheelKw * REGEN_EFF;
  return Math.max(-RING_REGEN_KW, Math.min(RING_OUT_KW, kw));
}

/**
 * The scene inside the power ring, one per preset theme; a theme of the owner's
 * own gets the road. Pure (tested).
 */
export const RING_MOTIFS = ['night', 'day', 'toolbox', 'synthwave', 'forest', 'tarpit', 'radar', 'sketch', 'atomic', 'road'] as const;
export type RingMotif = (typeof RING_MOTIFS)[number];
export function ringMotif(themeId: string | undefined): RingMotif {
  switch (themeId) {
    case 'night': return 'night';
    case 'day': return 'day';
    case 'toolbox-red': return 'toolbox';
    case 'synthwave': return 'synthwave';
    case 'mint-emerald': return 'forest';
    case 'tar-pit': return 'tarpit';
    case 'wopr': return 'radar';
    case 'clean-slate': return 'sketch';
    case 'bel-air': return 'atomic';
    default: return 'road';
  }
}

/** Seconds per loop for the scenes that move with the truck (road, grid, gears); null = stopped. Stepped so a small speed change doesn't restart the loop. Pure. */
export function motionSeconds(mph: number | null): number | null {
  if (mph === null || mph < 2) return null;
  const step = Math.max(5, Math.round(mph / 5) * 5);
  return Math.max(0.35, Math.min(4, Math.round((90 / step) * 10) / 10));
}
