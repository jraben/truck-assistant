import { describe, expect, it } from 'vitest';
import { ago, withFamilyView } from '../src/cars/views.ts';

describe('family cars view', () => {
  it('goes after Gauges, once', () => {
    const l = { views: [{ id: 'drive', label: 'Drive', widgets: [] }, { id: 'gauges', label: 'Gauges', widgets: [] }, { id: 'charge', label: 'Charge', widgets: [] }] };
    const out = withFamilyView(l);
    expect(out.views.map((v) => v.id)).toEqual(['drive', 'gauges', 'family', 'charge']);
    expect(withFamilyView(out)).toBe(out);
  });
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-25T18:00:00Z');
    expect(ago(null, now)).toBe('never');
    expect(ago('2026-11-25T17:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-25T17:40:00Z', now)).toBe('20 min ago');
    expect(ago('2026-11-25T13:00:00Z', now)).toBe('5 h ago');
    expect(ago('2026-11-21T18:00:00Z', now)).toBe('4 days ago');
  });
});
