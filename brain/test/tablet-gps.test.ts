// The dash tablet as the truck's GPS (src/tabletGps.ts): only from the dash
// tablet, only with the setting on, and a GPS puck with a fresh fix always wins.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDashTablet, PUCK_FRESH_MS, tabletFix, useTabletFix } from '../src/tabletGps.ts';

const TAB_UA = 'Mozilla/5.0 (Linux; Android 14; SM-T733) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const msg = { type: 'gps', lat: 33.4255, lon: -111.94, accM: 6, speedMps: 26.8, headingDeg: 271, altM: 352 };

describe('tablet GPS rules', () => {
  it('only the dash tablet: Android on the truck Wi-Fi, a home LAN or Tailscale', () => {
    expect(isDashTablet('10.42.0.23', TAB_UA)).toBe(true);
    expect(isDashTablet('::ffff:192.168.1.40', TAB_UA)).toBe(true);
    expect(isDashTablet('100.101.2.3', TAB_UA)).toBe(true);
    expect(isDashTablet('10.42.0.23', PC_UA)).toBe(false);
    expect(isDashTablet('8.8.8.8', TAB_UA)).toBe(false);
    expect(isDashTablet(undefined, TAB_UA)).toBe(false);
  });

  it('turns a browser position into a fix: mph, heading, and GPS-grade only when accurate', () => {
    const f = tabletFix(msg, 1_000)!;
    expect(f).toMatchObject({ lat: 33.4255, lon: -111.94, headingDeg: 271, fix: true, altM: 352 });
    expect(f.speedMph).toBeCloseTo(59.95, 1);
    expect(f.at.getTime()).toBe(1_000); // the brain's clock, not the tablet's
    expect(tabletFix({ ...msg, accM: 900 }, 0)!.fix).toBe(false); // a Wi-Fi/cell guess
    expect(tabletFix({ ...msg, speedMps: null, headingDeg: null }, 0)).toMatchObject({ speedMph: null, headingDeg: null });
    expect(tabletFix({ ...msg, lat: 0, lon: 0 }, 0)).toBeNull();
    expect(tabletFix({ ...msg, lat: 'x' }, 0)).toBeNull();
    expect(tabletFix({ ...msg, lat: 95 }, 0)).toBeNull();
  });

  it('a puck with a fresh fix wins; the simulator owns the position unless the desk test is on', () => {
    const now = 100_000;
    expect(useTabletFix({ enabled: true, puckFixAt: 0, simOwnsGps: false, now })).toBe(true);
    expect(useTabletFix({ enabled: true, puckFixAt: now - 1000, simOwnsGps: false, now })).toBe(false);
    expect(useTabletFix({ enabled: true, puckFixAt: now - PUCK_FRESH_MS - 1, simOwnsGps: false, now })).toBe(true);
    expect(useTabletFix({ enabled: false, puckFixAt: 0, simOwnsGps: false, now })).toBe(false);
    expect(useTabletFix({ enabled: true, puckFixAt: 0, simOwnsGps: true, now })).toBe(false);
  });
});

describe('the brain taking the tablet as its GPS', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tgps-'));
  process.env.DATA_DIR = dir;
  process.env.MQTT_DISABLED = '1';
  process.env.GEOCODE_DISABLED = '1';
  const { openDb } = await import('../src/db.ts');
  const { SettingsStore } = await import('../src/settings.ts');
  const { Brain } = await import('../src/brain.ts');
  const brain = new Brain(openDb(dir), new SettingsStore(dir));

  it('uses the dash tablet’s fixes, reports "tablet", refuses other devices, and stops when turned off', () => {
    expect(brain.onTabletFix(msg, '10.42.0.23', PC_UA)).toBe(false);
    expect(brain.getState().gps).toBeNull();
    expect(brain.onTabletFix(msg, '10.42.0.23', TAB_UA)).toBe(true);
    expect(brain.getState().gps).toMatchObject({ lat: 33.4255, lon: -111.94, fix: true });
    expect(brain.getState().speedMph).toBeCloseTo(60, 0); // the state rounds to 0.1 mph
    expect(brain.health().gps).toBe('tablet');
    brain.settings.update({ tabletGps: false });
    expect(brain.onTabletFix({ ...msg, lat: 33.5 }, '10.42.0.23', TAB_UA)).toBe(false);
    expect(brain.getState().gps!.lat).toBe(33.4255);
    brain.settings.update({ tabletGps: true });
  });

  it('ignores the tablet while a GPS puck has a fresh fix', () => {
    (brain as unknown as { puckFixAt: number }).puckFixAt = Date.now();
    expect(brain.onTabletFix({ ...msg, lat: 33.6 }, '10.42.0.23', TAB_UA)).toBe(false);
    (brain as unknown as { puckFixAt: number }).puckFixAt = 0;
    expect(brain.onTabletFix({ ...msg, lat: 33.6 }, '10.42.0.23', TAB_UA)).toBe(true);
  });
});
