import { describe, expect, it } from 'vitest';
import { badgePhoto } from '../src/components/drivers.tsx';
import { centreSquare } from '../src/lib/squarePhoto.ts';

describe('driver photos', () => {
  it('crops the middle square of a portrait or landscape picture', () => {
    expect(centreSquare(3024, 4032)).toEqual({ sx: 0, sy: 504, side: 3024 });
    expect(centreSquare(4000, 3000)).toEqual({ sx: 500, sy: 0, side: 3000 });
    expect(centreSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });

  it('takes the live state’s URL as is, builds one from a settings record, else initials', () => {
    expect(badgePhoto({ initials: 'S', color: '#fff', photo: '/api/drivers/sam/photo?v=1' })).toBe('/api/drivers/sam/photo?v=1');
    expect(badgePhoto({ id: 'sam', initials: 'S', color: '#fff', photo: { updatedAt: '2026-11-09T10:00:00.000Z' } })).toBe('/api/drivers/sam/photo?v=2026-11-09T10%3A00%3A00.000Z');
    expect(badgePhoto({ initials: 'S', color: '#fff', photo: null })).toBeNull();
    expect(badgePhoto(null)).toBeNull();
  });
});
