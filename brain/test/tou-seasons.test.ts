import { describe, expect, it } from 'vitest';
import { homeRateAt, periodCovers } from '../src/charges/pricing.ts';
import { alertPeriodAt, headsUpPeriod } from '../src/charges/peak.ts';
import type { Settings, TouPeriod } from '../src/types.ts';

const WEEK = [1, 2, 3, 4, 5];
const SUMMER = [5, 6, 7, 8, 9, 10], WINTER = [11, 12, 1, 2, 3, 4];
const tou: TouPeriod[] = [
  { name: 'on-peak summer', days: WEEK, start: '16:00', end: '19:00', perKwh: 0.1907, months: SUMMER, demandPerKw: 19.585, alertOnCharging: true },
  { name: 'on-peak winter', days: WEEK, start: '16:00', end: '19:00', perKwh: 0.1428, months: WINTER, demandPerKw: 13.747, alertOnCharging: true },
  { name: 'super off-peak winter', days: WEEK, start: '10:00', end: '15:00', perKwh: 0.0710, months: WINTER, alertOnCharging: false },
];
const rate = { flatPerKwh: 0.0983, tou, fixedPerSession: 0, demandPerKw: null } as Settings['homeRate'];
const at = (iso: string) => new Date(iso); // local time of the test runner

describe('seasonal time-of-use periods', () => {
  it('summer on-peak only in May-Oct', () => {
    expect(periodCovers(tou[0], at('2027-07-14T17:00:00'))).toBe(true);
    expect(periodCovers(tou[0], at('2027-01-13T17:00:00'))).toBe(false);
  });
  it('prices by season and falls back to the flat rate', () => {
    expect(homeRateAt(rate, at('2027-07-14T17:00:00'))?.perKwh).toBe(0.1907);
    expect(homeRateAt(rate, at('2027-01-13T17:00:00'))?.perKwh).toBe(0.1428);
    expect(homeRateAt(rate, at('2027-01-13T11:00:00'))?.perKwh).toBe(0.0710);
    expect(homeRateAt(rate, at('2027-07-14T11:00:00'))?.perKwh).toBe(0.0983); // no super off-peak in summer
    expect(homeRateAt(rate, at('2027-01-16T17:00:00'))?.perKwh).toBe(0.0983); // Saturday
  });
  it('alerts use the season that applies, and the heads-up skips the other season', () => {
    expect(alertPeriodAt(rate, at('2027-01-13T17:00:00'))?.demandPerKw).toBe(13.747);
    expect(headsUpPeriod(rate, at('2027-01-13T15:45:00'))?.name).toBe('on-peak winter');
  });
});
