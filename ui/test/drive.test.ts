import { describe, expect, it } from 'vitest';
import { overLimit, pickCards } from '../src/drive/logic.ts';
import type { State } from '../../brain/src/types.ts';

const st = (o: { locked?: boolean; tilt?: 'ok' | 'warn' | 'danger' | null; trip?: boolean }): State => ({
  trip: o.trip ? { id: 1, startedAt: '', miles: 1 } : null,
  drive: { lockout: { locked: !!o.locked, bigTargets: false }, tilt: { warnDeg: 20, dangerDeg: 30, level: o.tilt ?? 'ok' } },
} as unknown as State);

describe('Drive screen context cards', () => {
  it('parked: since charge, tilt, then media', () => {
    expect(pickCards(st({}), true)).toEqual(['since', 'tilt', 'np']);
    expect(pickCards(st({}), false)).toEqual(['since', 'tilt']);
  });
  it('moving: media, trip, since charge', () => {
    expect(pickCards(st({ locked: true, trip: true }), true)).toEqual(['np', 'trip', 'since']);
    expect(pickCards(st({ locked: true, trip: true }), false)).toEqual(['trip', 'since', 'tilt']);
  });
  it('a tilt warning goes first', () => {
    expect(pickCards(st({ locked: true, trip: true, tilt: 'danger' }), true)).toEqual(['tilt', 'np', 'trip']);
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
