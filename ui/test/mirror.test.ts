import { describe, expect, it } from 'vitest';
import { mirrorView, nextMode, withMirrorView } from '../src/mirror/logic.ts';

const st = (reverse: boolean, left: boolean, right: boolean) => ({ reverse, turnSignals: { left, right } });

describe('mirror screen', () => {
  it('cycles rear → three → off', () => {
    expect(nextMode('rear')).toBe('three');
    expect(nextMode('three')).toBe('off');
    expect(nextMode('off')).toBe('rear');
  });
  it('shows the rear, and slides a side camera in on its signal (not on hazards)', () => {
    expect(mirrorView('rear', st(false, false, false))).toMatchObject({ rear: true, left: false, right: false, dark: false });
    expect(mirrorView('rear', st(false, true, false))).toMatchObject({ left: true, right: false });
    expect(mirrorView('rear', st(false, true, true))).toMatchObject({ left: false, right: false });
    expect(mirrorView('three', st(false, false, false))).toMatchObject({ left: true, right: true });
  });
  it('wakes from off for reverse (with guides, rear only) or a signal', () => {
    expect(mirrorView('off', st(false, false, false))).toMatchObject({ dark: true, rear: false });
    expect(mirrorView('off', st(false, false, true))).toMatchObject({ dark: false, right: true });
    expect(mirrorView('three', st(true, true, false))).toEqual({ rear: true, left: false, right: false, guides: true, dark: false });
  });
});

describe('mirror screen is optional', () => {
  const l = { views: [{ id: 'drive', label: 'Drive', widgets: [] }, { id: 'cams', label: 'Cams', widgets: [] }, { id: 'trips', label: 'Trips', widgets: [] }] };
  it('joins the rail after Cams only while switched on, and leaves when switched off', () => {
    expect(withMirrorView(l, false)).toBe(l);
    const on = withMirrorView(l, true);
    expect(on.views.map((v) => v.id)).toEqual(['drive', 'cams', 'mirror', 'trips']);
    expect(withMirrorView(on, true)).toBe(on);
    expect(withMirrorView(on, false).views.map((v) => v.id)).toEqual(['drive', 'cams', 'trips']);
  });
});
