// Charging during an on-peak (alert) period: which period, how much the
// demand charge could add, the warning words, and the pre-peak heads-up
// window. Pure; local time of the Pi.
//
// Jeff's plan (APS "Time-of-Use 4pm-7pm Weekdays with Demand Charge") bills
// the single highest hour of use in the on-peak window at $/kW for the whole
// month, so one on-peak hour at the wall charger's ~7.2 kW is ~$141. That,
// not the energy rate, is what the alert is for.
import type { ChargeSession, Settings, TouPeriod } from '../types.ts';
import { minutesOf, periodCovers } from './pricing.ts';

/** Above this the wall charger is charging. */
export const CHARGING_W = 500;
/** The heads-up window before an alert period starts. */
export const HEADS_UP_MIN = 30;

type Rate = Settings['homeRate'];

/** The off-peak price a period is compared to: the flat rate, else the cheapest period. */
export function offPeakRate(rate: Pick<Rate, 'flatPerKwh' | 'tou'>): number | null {
  if (rate.flatPerKwh !== null && rate.flatPerKwh !== undefined) return rate.flatPerKwh;
  return rate.tou.length ? Math.min(...rate.tou.map((t) => t.perKwh)) : null;
}

/** alertOnCharging's default: on for a period priced above the flat / off-peak rate. */
export function defaultAlertOn(p: Pick<TouPeriod, 'perKwh'>, rate: Pick<Rate, 'flatPerKwh' | 'tou'>): boolean {
  const off = offPeakRate(rate);
  return off !== null && p.perKwh > off;
}

/** The alert period covering `at`, or null. */
export function alertPeriodAt(rate: Pick<Rate, 'tou'>, at: Date): TouPeriod | null {
  return rate.tou.find((p) => p.alertOnCharging && periodCovers(p, at)) ?? null;
}

/** An alert period starting within the next HEADS_UP_MIN minutes, on a day it applies (e.g. 15:30-16:00 Mon-Fri for a 4pm start). */
export function headsUpPeriod(rate: Pick<Rate, 'tou'>, at: Date, leadMin = HEADS_UP_MIN): TouPeriod | null {
  const t = at.getHours() * 60 + at.getMinutes();
  for (const p of rate.tou) {
    if (!p.alertOnCharging || alertPeriodAt({ tou: [p] }, at)) continue;
    const s = minutesOf(p.start);
    const until = s - t;
    if (until > 0 && until <= leadMin && p.days.includes(at.getDay())) return p;
  }
  return null;
}

/** What one on-peak hour at `kw` adds in demand charges, whole dollars; null when either is unknown. */
export function demandEstimate(kw: number | null, demandPerKw: number | null): number | null {
  if (kw === null || demandPerKw === null || !(kw > 0) || !(demandPerKw > 0)) return null;
  return Math.round(kw * demandPerKw);
}

/** "4pm", "7:30pm", "noon". */
export function clock(hhmm: string): string {
  const m = minutesOf(hhmm) % 1440, h = Math.floor(m / 60), mm = m % 60;
  if (m === 720) return 'noon';
  if (m === 0) return 'midnight';
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}
const span = (p: TouPeriod) => `${clock(p.start).replace(/(am|pm)$/, minutesOf(p.start) < 720 === minutesOf(p.end) < 720 ? '' : '$1')}–${clock(p.end)}`;

/** "APS on-peak 4-7pm" -> "APS on-peak": the times are said separately. */
export const periodLabel = (p: Pick<TouPeriod, 'name'>) => p.name.replace(/\s*\(?\d{1,2}(:\d\d)?\s*(am|pm)?\s*[-–]\s*\d{1,2}(:\d\d)?\s*(am|pm)\)?\s*$/i, '').trim() || p.name;

/** The alert wording. The $ sentence only when the live power and the demand rate are both known. */
export function peakMessage(p: TouPeriod, kw: number | null, demandPerKw: number | null): { title: string; message: string } {
  const est = demandEstimate(kw, demandPerKw);
  const money = est === null ? '' : ` One hour at ${kw!.toFixed(1)} kW can add about $${est} in demand charges this month.`;
  return {
    title: `Charging during ${periodLabel(p)}`,
    message: `Truck is charging at home during ${periodLabel(p)} (${span(p)}).${money} Stop or delay charging until ${clock(p.end)}.`,
  };
}

export function headsUpMessage(p: TouPeriod): { title: string; message: string } {
  return { title: `${periodLabel(p)} starts at ${clock(p.start)}`, message: `On-peak starts at ${clock(p.start)} — set the charger to start after ${clock(p.end)}.` };
}

/** Did a session's [start, end] touch an alert period? Checked minute by minute (a session is hours, not days). */
export function sessionOnPeak(s: Pick<ChargeSession, 'startedAt' | 'endedAt'>, rate: Pick<Rate, 'tou'>): TouPeriod | null {
  if (!rate.tou.some((p) => p.alertOnCharging)) return null;
  const a = Date.parse(s.startedAt), b = Math.min(Date.parse(s.endedAt ?? s.startedAt), a + 48 * 3600_000);
  if (!Number.isFinite(a)) return null;
  for (let t = a; t <= Math.max(a, b); t += 60_000) { const p = alertPeriodAt(rate, new Date(t)); if (p) return p; }
  return null;
}

/** The kW a session drew: its recorded max, else kWh over its length (null when unknown). */
export function sessionKw(s: Pick<ChargeSession, 'startedAt' | 'endedAt' | 'kwh' | 'maxKw' | 'place'>): number | null {
  if (s.maxKw !== null && s.maxKw > 0 && s.place === 'home') return s.maxKw;
  const h = s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 3600_000 : NaN;
  if (s.kwh === null || !(s.kwh > 0) || !(h > 0.05)) return null;
  return Math.round(Math.min(s.kwh / h, 19.2) * 10) / 10; // a home wall charger tops out at 80 A / 19.2 kW
}

/** "Possible demand charge" for a home session that overlapped an alert period, whole dollars; null when not on-peak or unknown. */
export function sessionDemand(s: Pick<ChargeSession, 'startedAt' | 'endedAt' | 'kwh' | 'maxKw' | 'place'>, rate: Pick<Rate, 'tou' | 'demandPerKw'>): number | null {
  if (s.place !== 'home' || !sessionOnPeak(s, rate)) return null;
  return demandEstimate(sessionKw(s), rate.demandPerKw ?? null);
}

/** Power sensor state -> kW, honouring unit_of_measurement (W, kW). Null when not a number. */
export function powerKw(state: string, unit: unknown): number | null {
  const v = Number(String(state).replace(/^"|"$/g, ''));
  if (!Number.isFinite(v) || v < 0) return null;
  const u = String(unit ?? '').trim().toLowerCase();
  if (u === 'kw') return v;
  if (u === 'mw') return v * 1000;
  if (u === 'w' || u === '') return u === '' && v < 50 ? v : v / 1000; // no unit: small numbers are kW
  return null;
}

export type PeakInput = {
  now: Date;
  rate: Pick<Rate, 'tou' | 'demandPerKw'>;
  atHome: boolean;
  /** Live wall charger power, kW (HA power entity); null = no sensor or no reading. */
  powerKw: number | null;
  /** The truck's own charging signal (future CAN); null = none. Only counts at home. */
  canCharging: boolean | null;
  /** A home session was detected/updated in the last few minutes. */
  recentHomeSession: boolean;
  /** HA plug entity (Track C) or charger status: plugged in; null = unknown. */
  pluggedIn: boolean | null;
};

/** The State.chargePeak block. Pure. */
export function chargePeakState(i: PeakInput): import('../types.ts').ChargePeak {
  let charging: boolean | null = null, source: import('../types.ts').ChargePeak['source'] = null;
  if (i.powerKw !== null) { charging = i.powerKw * 1000 > CHARGING_W; source = 'ha-power'; }
  else if (i.canCharging !== null && i.atHome) { charging = i.canCharging; source = 'can'; }
  else if (i.recentHomeSession) { charging = true; source = 'session'; }
  const p = alertPeriodAt(i.rate, i.now);
  const kw = i.powerKw !== null && i.powerKw * 1000 > CHARGING_W ? Math.round(i.powerKw * 10) / 10 : null;
  const onPeak = !!(charging && p && (source === 'ha-power' || i.atHome));
  const msg = onPeak ? peakMessage(p!, kw, i.rate.demandPerKw ?? null) : null;
  // Heads-up: plugged in (or the charger connected but idle) at home, before an alert period.
  const soon = headsUpPeriod(i.rate, i.now);
  const plugged = i.pluggedIn === true;
  const headsUp = !onPeak && soon && i.atHome && plugged && !charging ? headsUpMessage(soon) : null;
  return {
    charging, source, powerKw: kw, atHome: i.atHome,
    period: p ? { name: p.name, start: p.start, end: p.end } : null,
    onPeak,
    estimate: onPeak ? demandEstimate(kw, i.rate.demandPerKw ?? null) : null,
    title: msg?.title ?? null, message: msg?.message ?? null,
    headsUp: headsUp ? headsUp.message : null, headsUpTitle: headsUp ? headsUp.title : null,
  };
}
