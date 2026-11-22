import { describe, expect, it } from 'vitest';
import { laneSeconds, speedBar } from '../src/drive/glassLogic.ts';

describe('Glass layout', () => {
  it('the speed bar fills against the limit and turns amber past it, red when over the warning', () => {
    expect(speedBar(30, 45, false)).toEqual({ fill: 30 / 45 / 1.25, tone: 'ok' });
    expect(speedBar(48, 45, false).tone).toBe('warn');
    expect(speedBar(60, 45, true)).toEqual({ fill: 1, tone: 'bad' });
    expect(speedBar(null, 45, false)).toEqual({ fill: 0, tone: 'dim' });
    expect(speedBar(40, null, false)).toEqual({ fill: 0.5, tone: 'dim' });
  });
  it('lane marks run faster with speed, and stand still when stopped', () => {
    expect(laneSeconds(0)).toBe(0);
    expect(laneSeconds(null)).toBe(0);
    expect(laneSeconds(60)).toBeLessThan(laneSeconds(20));
    expect(laneSeconds(200)).toBe(0.12);
  });
});
