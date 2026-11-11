import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, migrateCamsLayout } from '../src/layout.ts';
import type { Layout } from '../src/types.ts';

const legacy = (): Layout => ({ views: [{ id: 'cams', label: 'My cams', widgets: [
  { type: 'cam', col: 1, row: 1, w: 3, h: 2, props: { label: 'Rear', note: 'Opens by itself in reverse', guides: true } },
  { type: 'cam', col: 4, row: 1, w: 3, h: 2, props: { label: 'Bed' } },
  { type: 'cam', col: 7, row: 1, w: 3, h: 2, props: { label: 'Front' } },
  { type: 'cam', col: 10, row: 1, w: 3, h: 2, props: { label: 'Hitch', note: 'For hooking up a trailer' } },
] }] } as Layout);

describe('old Cams layout', () => {
  it('the four-tile default becomes the grid view, keeping its label', () => {
    const v = migrateCamsLayout(legacy()).views[0];
    expect(v.label).toBe('My cams');
    expect(v.widgets).toEqual(DEFAULT_LAYOUT.views.find((x) => x.id === 'cams')!.widgets);
  });
  it('a customised Cams view is left alone, and the upgrade is a no-op the second time', () => {
    const custom = legacy(); custom.views[0].widgets.pop();
    expect(migrateCamsLayout(custom)).toBe(custom);
    const once = migrateCamsLayout(legacy());
    expect(migrateCamsLayout(once)).toBe(once);
  });
});
