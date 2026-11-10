// What the dash tablet does when the truck turns off (Settings > Truck), as
// Tasker reads it from GET /api/tablet/sleep (deploy/android/README.md step 6).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sleepPlan } from '../src/tablet.ts';
import { needsAuth } from '../src/ops/auth.ts';
import { SettingsStore } from '../src/settings.ts';

describe('tablet sleep settings', () => {
  it('defaults to sleeping 2 minutes after the truck turns off', () => {
    const s = new SettingsStore(mkdtempSync(path.join(tmpdir(), 'tsleep-')));
    expect(s.get().tabletSleep).toEqual({ minutes: 2, never: false, minBattery: 30 });
    expect(sleepPlan(s.get().tabletSleep)).toEqual({ minutes: 2, waitSec: 120, never: false, keepOn: 0, minBattery: 30 });
  });

  it('saves a change, keeps the parts not sent, and refuses nonsense', () => {
    const s = new SettingsStore(mkdtempSync(path.join(tmpdir(), 'tsleep-')));
    s.update({ tabletSleep: { minutes: 10, never: false, minBattery: 30 } });
    expect(sleepPlan(s.get().tabletSleep)).toMatchObject({ waitSec: 600, keepOn: 0 });
    s.update({ tabletSleep: { never: true, minBattery: 25 } } as never);
    expect(s.get().tabletSleep).toEqual({ minutes: 10, never: true, minBattery: 25 });
    expect(sleepPlan(s.get().tabletSleep).keepOn).toBe(1);
    expect(() => s.update({ tabletSleep: { minutes: -1, never: false, minBattery: 30 } })).toThrow(/tabletSleep.minutes/);
    expect(() => s.update({ tabletSleep: { minutes: 2, never: true, minBattery: 100 } })).toThrow(/minBattery/);
    expect(s.get().tabletSleep.minutes).toBe(10);
  });

  it('Tasker can read it without a login; nothing else about the tablet opens up', () => {
    expect(needsAuth('GET', '/api/tablet/sleep')).toBeNull();
    expect(needsAuth('PUT', '/api/tablet/sleep')).toBe('api');
    expect(needsAuth('GET', '/api/tablet')).toBe('api');
    expect(needsAuth('PUT', '/api/settings')).toBe('api');
  });
});
