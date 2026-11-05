// Home charging price from Settings.homeRate. Pure; local time of the Pi.
import type { Settings, TouPeriod } from '../types.ts';

/** Assumed wall-to-pack efficiency when kWh is inferred from a SoC rise. */
export const CHARGE_EFFICIENCY = 0.9;

export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Does `period` cover local time `at`? Days are 0 = Sunday .. 6 = Saturday.
 * A period that crosses midnight (start > end, e.g. 21:00-06:00) belongs to the
 * day it STARTS on: Monday 21:00-06:00 covers Monday night and early Tuesday.
 * start == end means all day.
 */
export function periodCovers(period: TouPeriod, at: Date): boolean {
  const t = at.getHours() * 60 + at.getMinutes();
  const day = at.getDay();
  const s = minutesOf(period.start), e = minutesOf(period.end);
  if (s === e) return period.days.includes(day);
  if (s < e) return period.days.includes(day) && t >= s && t < e;
  const prevDay = (day + 6) % 7;
  return (t >= s && period.days.includes(day)) || (t < e && period.days.includes(prevDay));
}

/** $/kWh at `at`: the first TOU period that covers it, else the flat rate, else null. */
export function homeRateAt(rate: Settings['homeRate'], at: Date): { perKwh: number; period: string } | null {
  for (const p of rate.tou) if (periodCovers(p, at)) return { perKwh: p.perKwh, period: p.name };
  if (rate.flatPerKwh !== null && rate.flatPerKwh !== undefined) return { perKwh: rate.flatPerKwh, period: 'flat' };
  return null;
}

/** Price a home session by its start time. Null when kWh or a rate is unknown. */
export function priceHomeSession(kwh: number | null, startedAt: Date, rate: Settings['homeRate']): number | null {
  if (kwh === null || !Number.isFinite(kwh) || kwh < 0) return null;
  const r = homeRateAt(rate, startedAt);
  if (!r) return null;
  return round2(kwh * r.perKwh + (rate.fixedPerSession || 0));
}

/** kWh from the wall for a SoC rise: pack share / charging efficiency. */
export function kwhFromSoc(startSoc: number | null, endSoc: number | null, packKwh: number, eff = CHARGE_EFFICIENCY): number | null {
  if (startSoc === null || endSoc === null || endSoc <= startSoc || !(packKwh > 0)) return null;
  return round2((((endSoc - startSoc) / 100) * packKwh) / eff);
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
