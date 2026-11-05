import { describe, expect, it } from 'vitest';
import { isDaytime, sunTimes } from '../src/sun.ts';
import { checkContrast, contrastRatio, defaultThemeSettings, migrateTheme, PRESETS, validateThemeSettings, ThemeError } from '../src/themes.ts';
import { defaultSettings, mergeSettings, SettingsError } from '../src/settings.ts';

const PHX = { lat: 33.4484, lon: -112.074 };
const minutesOff = (d: Date, iso: string) => Math.abs(d.getTime() - Date.parse(iso)) / 60_000;

describe('sunrise / sunset', () => {
  it('Phoenix, summer solstice: ~05:19 and ~19:42 MST', () => {
    const t = sunTimes(new Date(2027, 5, 21, 12), PHX.lat, PHX.lon)!;
    expect(minutesOff(t.rise, '2027-06-21T12:19:00Z')).toBeLessThan(5);
    expect(minutesOff(t.set, '2027-06-22T02:42:00Z')).toBeLessThan(5);
  });

  it('Phoenix, winter solstice: ~07:31 and ~17:24 MST', () => {
    const t = sunTimes(new Date(2027, 11, 21, 12), PHX.lat, PHX.lon)!;
    expect(minutesOff(t.rise, '2027-12-21T14:31:00Z')).toBeLessThan(5);
    expect(minutesOff(t.set, '2027-12-22T00:24:00Z')).toBeLessThan(5);
  });

  it('polar night and day return null', () => {
    expect(sunTimes(new Date(2027, 11, 21, 12), 78.2, 15.6)).toBeNull();
    expect(sunTimes(new Date(2027, 5, 21, 12), 78.2, 15.6)).toBeNull();
  });

  it('isDaytime uses the sun with a position and 07-19 without', () => {
    expect(isDaytime(new Date('2027-06-21T19:00:00Z'), PHX)).toBe(true);   // noon MST
    expect(isDaytime(new Date('2027-06-21T10:00:00Z'), PHX)).toBe(false);  // 03:00 MST
    expect(isDaytime(new Date(2027, 0, 5, 6, 59), null)).toBe(false);
    expect(isDaytime(new Date(2027, 0, 5, 12), null)).toBe(true);
  });
});

describe('contrast', () => {
  it('WCAG ratio endpoints', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 1); // the classic AA grey
  });

  it('flags pairs under 4.5:1', () => {
    const c = checkContrast({ colors: { ...PRESETS[0].colors, fg: '#3a3a3a', bg: '#202020' } });
    expect(c.find((x) => x.pair === 'Text on background')?.ok).toBe(false);
  });

  it('every preset passes for text on background and text on accent', () => {
    for (const p of PRESETS) {
      for (const c of checkContrast(p)) expect(c.ok, `${p.name}: ${c.pair} ${c.ratio}`).toBe(true);
    }
  });
});

describe('theme settings', () => {
  it('migrates the old string form', () => {
    expect(migrateTheme('day')).toMatchObject({ active: 'day', auto: { enabled: false } });
    expect(mergeSettings(defaultSettings(), { theme: 'auto' }).theme.auto.enabled).toBe(true);
  });

  it('accepts a custom theme and rejects bad ones', () => {
    const custom = { ...PRESETS[0], id: 'my-night', name: 'Mine' };
    const s = mergeSettings(defaultSettings(), { theme: { active: 'my-night', custom: [custom] } });
    expect(s.theme.active).toBe('my-night');
    expect(() => validateThemeSettings({ ...defaultThemeSettings(), active: 'nope' })).toThrow(ThemeError);
    expect(() => mergeSettings(defaultSettings(), { theme: { custom: [{ ...custom, id: 'night' }] } })).toThrow(SettingsError);
    expect(() => mergeSettings(defaultSettings(), { theme: { custom: [{ ...custom, colors: { ...custom.colors, bg: 'red' } }] } })).toThrow(/bg/);
  });
});
