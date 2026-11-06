import { describe, expect, it } from 'vitest';
import { alertPeriodAt, chargePeakState, defaultAlertOn, demandEstimate, headsUpPeriod, peakMessage, powerKw, sessionDemand, sessionOnPeak } from '../src/charges/peak.ts';
import { AlertEngine } from '../src/remote/alerts.ts';
import { defaultRemote } from '../src/remote/store.ts';
import { defaultSettings, loadSettings } from '../src/settings.ts';
import type { TouPeriod } from '../src/types.ts';

// Jeff's APS plan: flat 0.0983, on-peak Mon-Fri 16:00-19:00 at 0.1907, demand $19.58438/kW.
const PEAK: TouPeriod = { name: 'APS on-peak 4-7pm', days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00', perKwh: 0.1907, alertOnCharging: true };
const rate = { flatPerKwh: 0.0983, tou: [PEAK], fixedPerSession: 0, demandPerKw: 19.58438 };
// 2027-05-03 is a Monday; 2027-05-08 a Saturday.
const mon = (h: number, m = 0) => new Date(2027, 4, 3, h, m);
const sat = (h: number, m = 0) => new Date(2027, 4, 8, h, m);

describe('on-peak period matching', () => {
  it('weekdays 16:00-19:00 only; weekends are off', () => {
    expect(alertPeriodAt(rate, mon(16, 0))?.name).toBe(PEAK.name);
    expect(alertPeriodAt(rate, mon(18, 59))?.name).toBe(PEAK.name);
    expect(alertPeriodAt(rate, mon(19, 0))).toBeNull();
    expect(alertPeriodAt(rate, mon(15, 59))).toBeNull();
    expect(alertPeriodAt(rate, sat(17))).toBeNull();
  });
  it('a period with alerts off never alerts; the default is on only above the flat / off-peak rate', () => {
    expect(alertPeriodAt({ tou: [{ ...PEAK, alertOnCharging: false }] }, mon(17))).toBeNull();
    expect(defaultAlertOn(PEAK, rate)).toBe(true);
    expect(defaultAlertOn({ perKwh: 0.05 }, rate)).toBe(false);
    expect(defaultAlertOn({ perKwh: 0.08 }, { flatPerKwh: null, tou: [{ ...PEAK, perKwh: 0.08 }, PEAK] })).toBe(false);
    const s = loadSettings({ homeRate: { flatPerKwh: 0.0983, fixedPerSession: 0, tou: [{ name: 'on-peak', days: [1], start: '16:00', end: '19:00', perKwh: 0.19 }] } });
    expect(s.homeRate.tou[0].alertOnCharging).toBe(true);
    expect(s.homeRate.demandPerKw).toBeNull();
    expect(defaultSettings().homeRate.demandPerKw).toBeNull();
  });
  it('a session that overlapped the window is flagged', () => {
    expect(sessionOnPeak({ startedAt: mon(14).toISOString(), endedAt: mon(16, 30).toISOString() }, rate)?.name).toBe(PEAK.name);
    expect(sessionOnPeak({ startedAt: mon(19, 5).toISOString(), endedAt: mon(23).toISOString() }, rate)).toBeNull();
    expect(sessionOnPeak({ startedAt: sat(16).toISOString(), endedAt: sat(18).toISOString() }, rate)).toBeNull();
  });
});

describe('demand charge estimate', () => {
  it('one on-peak hour at 7.2 kW is about $141', () => {
    expect(demandEstimate(7.2, 19.58438)).toBe(141);
    expect(demandEstimate(7.2, null)).toBeNull();
    expect(demandEstimate(null, 19.58)).toBeNull();
  });
  it('the alert says the $ only when power and the demand rate are known', () => {
    expect(peakMessage(PEAK, 7.2, 19.58438).message).toBe('Truck is charging at home during APS on-peak (4–7pm). One hour at 7.2 kW can add about $141 in demand charges this month. Stop or delay charging until 7pm.');
    expect(peakMessage(PEAK, null, 19.58438).message).toBe('Truck is charging at home during APS on-peak (4–7pm). Stop or delay charging until 7pm.');
  });
  it('a home session on-peak carries a possible demand charge from its kW', () => {
    const s = { startedAt: mon(16).toISOString(), endedAt: mon(18).toISOString(), kwh: 14.4, maxKw: null, place: 'home' as const };
    expect(sessionDemand(s, rate)).toBe(141); // 14.4 kWh over 2 h = 7.2 kW
    expect(sessionDemand({ ...s, place: 'public' }, rate)).toBeNull();
    expect(sessionDemand(s, { ...rate, demandPerKw: null })).toBeNull();
  });
  it('power sensors in W or kW', () => {
    expect(powerKw('7200', 'W')).toBe(7.2);
    expect(powerKw('7.2', 'kW')).toBe(7.2);
    expect(powerKw('unavailable', 'W')).toBeNull();
  });
});

describe('pre-peak heads-up', () => {
  it('15:30-16:00 on a weekday only', () => {
    expect(headsUpPeriod(rate, mon(15, 30))?.name).toBe(PEAK.name);
    expect(headsUpPeriod(rate, mon(15, 59))?.name).toBe(PEAK.name);
    expect(headsUpPeriod(rate, mon(15, 29))).toBeNull();
    expect(headsUpPeriod(rate, mon(16, 0))).toBeNull(); // on-peak now: the real alert takes over
    expect(headsUpPeriod(rate, sat(15, 45))).toBeNull();
  });
  it('plugged in at home and not charging: the heads-up; charging on-peak: the alert', () => {
    const base = { rate, atHome: true, canCharging: null, recentHomeSession: false };
    const soon = chargePeakState({ ...base, now: mon(15, 45), powerKw: 0, pluggedIn: true });
    expect(soon.headsUp).toBe('On-peak starts at 4pm — set the charger to start after 7pm.');
    expect(soon.onPeak).toBe(false);
    expect(chargePeakState({ ...base, now: mon(15, 45), powerKw: 0, pluggedIn: false }).headsUp).toBeNull();
    const on = chargePeakState({ ...base, now: mon(16, 10), powerKw: 7.2, pluggedIn: true });
    expect(on).toMatchObject({ onPeak: true, charging: true, source: 'ha-power', powerKw: 7.2, estimate: 141 });
    expect(chargePeakState({ ...base, now: sat(16, 10), powerKw: 7.2, pluggedIn: true }).onPeak).toBe(false);
    // no power sensor: the truck's own signal counts only at home
    expect(chargePeakState({ ...base, now: mon(17), powerKw: null, pluggedIn: null, canCharging: true }).onPeak).toBe(true);
    expect(chargePeakState({ ...base, atHome: false, now: mon(17), powerKw: null, pluggedIn: null, canCharging: true }).onPeak).toBe(false);
    expect(chargePeakState({ ...base, now: mon(17), powerKw: null, pluggedIn: null, recentHomeSession: true })).toMatchObject({ onPeak: true, source: 'session', estimate: null });
  });
});

describe('the alert: debounce and 15-minute cooldown', () => {
  it('holds 30 s, then repeats every 15 min while it lasts', () => {
    const e = new AlertEngine(defaultRemote(false).alerts);
    const cp = chargePeakState({ now: mon(16, 10), rate, atHome: true, powerKw: 7.2, canCharging: null, recentHomeSession: false, pluggedIn: true });
    const t0 = mon(16, 10).getTime();
    const run = (t: number, onPeak = true) => e.evaluate({ now: t, parked: true, cabinTempF: null, aux12v: null, tpms: [], truckboxOnline: true, truckboxOfflineSince: null, motion: null, theft: null, position: null, soc: null, pluggedIn: null, chargePeak: onPeak ? cp : { ...cp, onPeak: false } })
      .filter((f) => f.kind === 'chargingPeak');
    expect(run(t0)).toHaveLength(0);
    expect(run(t0 + 20_000)).toHaveLength(0);
    const f = run(t0 + 31_000);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/\$141/);
    expect(run(t0 + 10 * 60_000)).toHaveLength(0);
    expect(run(t0 + 16 * 60_000)).toHaveLength(1);
    // turned off in settings: never
    const off = defaultRemote(false).alerts; off.rules.chargingPeak.enabled = false;
    const e2 = new AlertEngine(off);
    expect(e2.evaluate({ now: t0 + 60_000, parked: true, cabinTempF: null, aux12v: null, tpms: [], truckboxOnline: true, truckboxOfflineSince: null, motion: null, theft: null, position: null, soc: null, pluggedIn: null, chargePeak: cp })).toHaveLength(0);
  });
});
