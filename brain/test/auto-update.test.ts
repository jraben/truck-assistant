// Automatic updates: GitHub every 12 hours, an available version installed by
// itself only while parked (and, if chosen, on home Wi-Fi), never the same
// failed version twice.
import { describe, expect, it } from 'vitest';
import { loadOps } from '../src/ops/config.ts';
import { AUTO_CHECK_MS, autoUpdateStep, isDriving, Updater, type AutoInputs, type Job, type Report, type Runner } from '../src/ops/updater.ts';

const H = 3_600_000;
const base: AutoInputs = { now: 100 * H, lastCheckAt: 99 * H, online: true, driving: false, homeWifi: true, phase: 'available', latestTag: 'v1.2.0', triedTag: null, installNote: null };
const on = { enabled: true, when: 'parked' as const };

describe('auto-update rules', () => {
  it('checks every 12 hours when online, on or off', () => {
    const idle = { ...base, phase: 'up-to-date' as const };
    expect(autoUpdateStep({ ...on, enabled: false }, { ...idle, lastCheckAt: null })).toEqual({ act: 'check', waiting: null });
    expect(autoUpdateStep(on, { ...idle, lastCheckAt: 100 * H - AUTO_CHECK_MS + 1 }).act).toBeNull();
    expect(autoUpdateStep(on, { ...idle, lastCheckAt: 100 * H - AUTO_CHECK_MS }).act).toBe('check');
    expect(autoUpdateStep(on, { ...idle, lastCheckAt: null, online: false }).act).toBeNull();
    expect(autoUpdateStep(on, { ...idle, lastCheckAt: null, phase: 'building' }).act).toBeNull();
  });

  it('installs only when on, parked and (if asked) on home Wi-Fi', () => {
    expect(autoUpdateStep(on, base)).toEqual({ act: 'install', waiting: null });
    expect(autoUpdateStep({ ...on, enabled: false }, base)).toEqual({ act: null, waiting: null });
    expect(autoUpdateStep(on, { ...base, driving: true })).toEqual({ act: null, waiting: 'Waiting until the truck is parked' });
    expect(autoUpdateStep({ ...on, when: 'home-wifi' }, { ...base, homeWifi: false })).toEqual({ act: null, waiting: 'Waiting for home Wi-Fi' });
    expect(autoUpdateStep({ ...on, when: 'home-wifi' }, { ...base, homeWifi: false, driving: true }).waiting).toBe('Waiting until the truck is parked');
    expect(autoUpdateStep(on, { ...base, homeWifi: false }).act).toBe('install');
    expect(autoUpdateStep(on, { ...base, installNote: 'needs the updater service' })).toEqual({ act: null, waiting: 'needs the updater service' });
  });

  it('does not try the same version again by itself', () => {
    expect(autoUpdateStep(on, { ...base, triedTag: 'v1.2.0' }).act).toBeNull();
    expect(autoUpdateStep(on, { ...base, triedTag: 'v1.1.0' }).act).toBe('install');
  });

  it('driving = ignition on, a trip open, or moving', () => {
    expect(isDriving({ ignition: false, trip: null, speedMph: 0 })).toBe(false);
    expect(isDriving({ ignition: null, trip: null, speedMph: null })).toBe(false);
    expect(isDriving({ ignition: true, trip: null, speedMph: 0 })).toBe(true);
    expect(isDriving({ ignition: false, trip: { id: 1 }, speedMph: 0 })).toBe(true);
    expect(isDriving({ ignition: false, trip: null, speedMph: 12 })).toBe(true);
  });

  it('is off by default, and an older or bad ops.json gets a sane setting', () => {
    expect(loadOps({}).updater.auto).toEqual({ enabled: false, when: 'parked' });
    expect(loadOps({ updater: { repo: 'https://github.com/a/b', channel: 'stable' } }).updater).toMatchObject({ repo: 'https://github.com/a/b', auto: { enabled: false, when: 'parked' } });
    expect(loadOps({ updater: { auto: { enabled: 'yes', when: 'never' } } }).updater.auto).toEqual({ enabled: false, when: 'parked' });
    expect(loadOps({ updater: { auto: { enabled: true, when: 'home-wifi' } } }).updater.auto).toEqual({ enabled: true, when: 'home-wifi' });
  });

  it('reports the setting and why it waits in the update status', () => {
    const runner: Runner = { unavailable: () => null, request: async (_j: Job) => {}, report: async (): Promise<Report | null> => null, hasPrevious: () => false };
    const u = new Updater({
      runner, source: { list: async () => [] },
      cfg: () => ({ repo: 'https://github.com/a/b', channel: 'stable', auto: { enabled: true, when: 'home-wifi' } }),
      installed: () => ({ version: '1.0.0', tag: 'v1.0.0', sha: null, channel: null, installedAt: null }),
      autoInfo: () => ({ waiting: 'Waiting for home Wi-Fi', nextCheckAt: '2026-11-10T06:00:00.000Z', skipped: null }),
    });
    expect(u.status().auto).toEqual({ enabled: true, when: 'home-wifi', waiting: 'Waiting for home Wi-Fi', nextCheckAt: '2026-11-10T06:00:00.000Z', skipped: null });
  });
});
