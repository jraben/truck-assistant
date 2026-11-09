// The charging coach: while plugged in on a trip, how long is left, when to go,
// and whether this stall is short-changing you. Pure.
import { kwAt, minutesToCharge, milesPerMinute, type Curve } from './curve.ts';
import type { SampleRow } from './types.ts';

/** A stall is called slow below this share of what the truck should take... */
export const SLOW_SHARE = 0.6;
/** ...on the last two readings, below this charge level (above it the taper is the pack, not the stall). */
const SLOW_BELOW_SOC = 78;
/** Readings older than this are not "now". */
const FRESH_MS = 6 * 60_000;

export type CoachInput = {
  soc: number | null;
  samples: SampleRow[];
  stationKw: number | null;
  curve: Curve;
  packKwh: number;
  effMiPerKwh: number;
  /** The planned departure charge, or null when not on a planned stop. */
  targetSoc: number | null;
  /** The next leg, to say what the charge is for. */
  next: { name: string; needSoc: number } | null;
  now: number;
};

export type CoachState = 'charging' | 'go' | 'slow' | 'learning';
export type Coach = {
  state: CoachState;
  soc: number | null;
  targetSoc: number | null;
  minutesLeft: number | null;
  kwNow: number | null;
  kwExpected: number | null;
  /** Miles each further 10 minutes adds at the current charge level. */
  milesPer10Min: number | null;
  message: string;
  detail: string | null;
};

const r0 = (n: number) => Math.round(n);

export function coach(c: CoachInput): Coach {
  const fresh = c.samples.filter((s) => c.now - Date.parse(s.at) <= FRESH_MS);
  const last2 = fresh.slice(-2);
  const kwNow = last2.length ? last2.reduce((a, s) => a + s.kw, 0) / last2.length : null;
  const soc = c.soc;
  const kwExpected = soc === null ? null : kwAt(c.curve, soc, c.stationKw);
  const mp10 = soc === null ? null : milesPerMinute(c.curve, soc, c.effMiPerKwh, c.stationKw) * 10;
  const base = { soc, targetSoc: c.targetSoc, kwNow: kwNow === null ? null : r0(kwNow), kwExpected: kwExpected === null ? null : r0(kwExpected), milesPer10Min: mp10 === null ? null : r0(mp10) };

  if (soc === null) return { ...base, state: 'learning', minutesLeft: null, message: 'Charge level unknown', detail: 'Set the charge level so the coach can count down.' };

  const slow = last2.length === 2 && soc < SLOW_BELOW_SOC && kwExpected !== null
    && last2.every((s) => s.kw < SLOW_SHARE * kwAt(c.curve, (s.socFrom + s.socTo) / 2, c.stationKw));
  if (slow) {
    return {
      ...base, state: 'slow', minutesLeft: c.targetSoc === null ? null : r0(minutesToCharge(c.curve, c.packKwh, soc, c.targetSoc, null, (kwNow ?? 1) / (kwExpected || 1))),
      message: `This stall is slow: ${r0(kwNow!)} kW, the truck should take about ${r0(kwExpected!)}`,
      detail: 'Try another stall if one is free. It will be remembered for next time.',
    };
  }

  if (c.targetSoc === null) {
    return { ...base, state: kwNow === null ? 'learning' : 'charging', minutesLeft: null,
      message: kwNow === null ? 'Charging' : `Charging at ${r0(kwNow)} kW`,
      detail: soc >= 80 ? `Past 80% it slows down: each 10 more minutes adds about ${r0(mp10!)} mi.` : null };
  }

  if (soc >= c.targetSoc) {
    return { ...base, state: 'go', minutesLeft: 0,
      message: c.next ? `GO: enough for ${c.next.name}` : 'GO: you have enough',
      detail: `Staying longer adds only about ${r0(mp10!)} mi per 10 minutes${soc >= 80 ? ' (past 80% the truck charges slowly)' : ''}.` };
  }
  const left = minutesToCharge(c.curve, c.packKwh, soc, c.targetSoc, c.stationKw);
  return { ...base, state: 'charging', minutesLeft: Number.isFinite(left) ? Math.max(1, r0(left)) : null,
    message: `Charge to ${r0(c.targetSoc)}%${Number.isFinite(left) ? `, about ${Math.max(1, r0(left))} min left` : ''}`,
    detail: c.next ? `That reaches ${c.next.name} with your margin to spare.` : null };
}
