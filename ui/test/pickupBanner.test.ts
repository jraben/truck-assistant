import { describe, expect, it } from 'vitest';
import { HIDE_FOR_MS, hiddenLevel, pickupBannerShown, pickupLevel } from '../src/components/PickupBanner.tsx';

const p = (phase: string, leaveNow = false) => ({ phase, line: 'AA 1234', leaveNow });
describe('pickup banner hide and return', () => {
  it('levels: on its way, landed, leave now', () => {
    expect([pickupLevel(p('cruise')), pickupLevel(p('taxiing')), pickupLevel(p('at-gate')), pickupLevel(p('cruise', true))]).toEqual([0, 1, 1, 2]);
  });
  it('hidden stays hidden until it gets more urgent', () => {
    expect(pickupBannerShown(p('cruise'), null)).toBe(true);
    expect(pickupBannerShown(p('cruise'), 0)).toBe(false);
    expect(pickupBannerShown(p('taxiing'), 0)).toBe(true);   // landed: back by itself
    expect(pickupBannerShown(p('at-gate'), 1)).toBe(false);
    expect(pickupBannerShown(p('at-gate', true), 1)).toBe(true); // leave now: back
    expect(pickupBannerShown(p('at-gate', true), 2)).toBe(false);
  });
  it('hiding lasts 12 hours, then the next pickup starts shown', () => {
    const at = 1_000_000;
    expect(hiddenLevel(JSON.stringify({ level: 1, at }), at + 1000)).toBe(1);
    expect(hiddenLevel(JSON.stringify({ level: 1, at }), at + HIDE_FOR_MS)).toBeNull();
    expect(hiddenLevel(null, at)).toBeNull();
    expect(hiddenLevel('junk', at)).toBeNull();
  });
});
