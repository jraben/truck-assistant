import { describe, expect, it } from 'vitest';
import { CLOSE_FOR_MS, stillClosed } from '../src/components/AlertBanner.tsx';

describe('closed alert banners', () => {
  it('keep only recent closes, newest 50, and shrug off junk', () => {
    const now = 1_000_000_000;
    expect(stillClosed(null, now)).toEqual({});
    expect(stillClosed('not json', now)).toEqual({});
    expect(stillClosed(JSON.stringify({ a: now - 1000, b: now - CLOSE_FOR_MS - 1, c: 'x' }), now)).toEqual({ a: now - 1000 });
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, now - i]));
    const kept = stillClosed(JSON.stringify(many), now);
    expect(Object.keys(kept)).toHaveLength(50);
    expect(kept.k0).toBe(now);
    expect(kept.k59).toBeUndefined();
  });
});
