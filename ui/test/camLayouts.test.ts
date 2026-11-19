import { describe, expect, it } from 'vitest';
import { nextTrail, splitLayouts, type CamInfo } from '../src/lib/cams.ts';

const cam = (id: string, role: CamInfo['role'], enabled = true) => ({ id, name: id, role, enabled } as CamInfo);
const ids = (cams: CamInfo[]) => splitLayouts(cams).map((s) => [s.id, s.cams.map((c) => c.id).join('|')]);

describe('split layouts', () => {
  it('offer only what the cameras allow, in screen order', () => {
    expect(ids([cam('r', 'rear'), cam('f', 'front'), cam('l', 'left'), cam('ri', 'right'), cam('h', 'hitch')]))
      .toEqual([['front-rear', 'f|r'], ['sides', 'l|r|ri'], ['tow', 'r|h'], ['trail', 'f|l|ri']]);
    expect(ids([cam('r', 'rear')])).toEqual([]);
    expect(ids([cam('f', 'front'), cam('l', 'left'), cam('ri', 'right')])).toEqual([['sides', 'l|ri'], ['trail', 'f|l|ri']]);
    expect(ids([cam('f', 'front', false), cam('r', 'rear')])).toEqual([]);
  });
});

describe('trail view', () => {
  const at = (speedMph: number | null, o: Partial<{ ignition: boolean | null; reverse: boolean | null }> = {}) => ({ speedMph, ignition: true, reverse: false, ...o });
  it('shows at or under the limit when switched on, and leaves above limit + 3', () => {
    expect(nextTrail(false, true, at(8), 10)).toBe(true);
    expect(nextTrail(false, true, at(11), 10)).toBe(false);
    expect(nextTrail(true, true, at(12), 10)).toBe(true);   // no flicker at the limit
    expect(nextTrail(true, true, at(14), 10)).toBe(false);
  });
  it('never when off, in reverse, or with the truck off', () => {
    expect(nextTrail(false, false, at(5), 10)).toBe(false);
    expect(nextTrail(true, true, at(2, { reverse: true }), 10)).toBe(false);
    expect(nextTrail(false, true, at(0, { ignition: false }), 10)).toBe(false);
    expect(nextTrail(false, true, null, 10)).toBe(false);
  });
});
