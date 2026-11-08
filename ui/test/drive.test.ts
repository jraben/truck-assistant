import { describe, expect, it } from 'vitest';
import { overLimit, pickCards, showTruckPhoto } from '../src/drive/logic.ts';
import type { State } from '../../brain/src/types.ts';

const st = (o: { locked?: boolean; tilt?: 'ok' | 'warn' | 'danger' | null; trip?: boolean }): State => ({
  trip: o.trip ? { id: 1, startedAt: '', miles: 1 } : null,
  drive: { lockout: { locked: !!o.locked, bigTargets: false }, tilt: { warnDeg: 20, dangerDeg: 30, level: o.tilt ?? 'ok' } },
} as unknown as State);

describe('Drive screen context cards', () => {
  it('parked: since charge, then media (the truck in the middle shows the tilt)', () => {
    expect(pickCards(st({}), true)).toEqual(['since', 'np']);
    expect(pickCards(st({}), false)).toEqual(['since']);
  });
  it('moving: media, trip, since charge, two at most', () => {
    expect(pickCards(st({ locked: true, trip: true }), true)).toEqual(['np', 'trip']);
    expect(pickCards(st({ locked: true, trip: true }), false)).toEqual(['trip', 'since']);
  });
  it('the payoff goal: parked only, after the others', () => {
    expect(pickCards(st({}), false, true)).toEqual(['since', 'goal']);
    expect(pickCards(st({}), true, true)).toEqual(['since', 'np']);
    expect(pickCards(st({ locked: true, trip: true }), false, true)).toEqual(['trip', 'since']);
  });
  it('a tilt warning goes first', () => {
    expect(pickCards(st({ locked: true, trip: true, tilt: 'danger' }), true)).toEqual(['tilt', 'np']);
  });
});

describe('over-limit warning', () => {
  const dd = { speedo: 'auto' as const, overLimitWarn: true, overLimitMph: 5 };
  it('only past the tolerance, only when on, only with a limit', () => {
    expect(overLimit(40, 35, dd)).toBe(false);
    expect(overLimit(41, 35, dd)).toBe(true);
    expect(overLimit(60, 35, { ...dd, overLimitWarn: false })).toBe(false);
    expect(overLimit(60, null, dd)).toBe(false);
    expect(overLimit(null, 35, dd)).toBe(false);
  });
});

describe('truck photo on the tilt card', () => {
  const at = (mph: number | null, tilt: 'ok' | 'warn' | 'danger' | null = 'ok', locked = false) => ({ ...st({ tilt, locked }), speedMph: mph } as unknown as State);
  it('parked and level: the photo', () => {
    expect(showTruckPhoto(at(0), true)).toBe(true);
    expect(showTruckPhoto(at(null, null), true)).toBe(true);
  });
  it('moving, steep or no photo: the live drawing', () => {
    expect(showTruckPhoto(at(0), false)).toBe(false);
    expect(showTruckPhoto(at(12), true)).toBe(false);
    expect(showTruckPhoto(at(0, 'warn'), true)).toBe(false);
    expect(showTruckPhoto(at(0, 'danger'), true)).toBe(false);
    expect(showTruckPhoto(at(0, 'ok', true), true)).toBe(false);
  });
});

describe('power ring', () => {
  it('estimates power out at cruise, more when speeding up, regen when slowing', async () => {
    const { estimateDriveKw } = await import('../src/drive/logic.ts');
    expect(estimateDriveKw(0, 0)).toBe(0);
    const cruise = estimateDriveKw(45, 0);
    expect(cruise).toBeGreaterThan(5); expect(cruise).toBeLessThan(25);
    expect(estimateDriveKw(45, 1.5)).toBeGreaterThan(cruise + 30);
    expect(estimateDriveKw(45, -2)).toBeLessThan(0);
    expect(estimateDriveKw(70, 5)).toBe(150);
    expect(estimateDriveKw(60, -9)).toBe(-60);
  });
  it('gives each preset theme its own scene and a custom theme the road', async () => {
    const { ringMotif, motionSeconds } = await import('../src/drive/logic.ts');
    const { PRESETS } = await import('../../brain/src/themes.ts');
    const scenes = PRESETS.map((t) => ringMotif(t.id));
    expect(new Set(scenes).size).toBe(PRESETS.length);
    expect(scenes).not.toContain('road');
    expect(ringMotif('my-own')).toBe('road');
    expect(motionSeconds(0)).toBeNull();
    expect(motionSeconds(45)).toBe(2);
    expect(motionSeconds(90)!).toBeLessThan(motionSeconds(30)!);
  });
});
