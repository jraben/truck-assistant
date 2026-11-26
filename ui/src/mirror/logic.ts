// The Mirror screen's choices. Pure (tested).
import { signalSide } from '../../../brain/src/truckbox.ts';
import type { Layout } from '../../../brain/src/types.ts';

export const MIRROR_ICON = 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM12 17v3M8 20h8M7 9l3 3M11 9l2 2';
export const MIRROR_VIEW: Layout['views'][number] = { id: 'mirror', label: 'Mirror', widgets: [{ type: 'mirror', col: 1, row: 1, w: 12, h: 2 }] };

/** The Mirror screen is optional: on the rail only while Settings › Cameras › Mirror screen is on. */
export function withMirrorView(layout: Layout, on: boolean): Layout {
  const has = layout.views.some((v) => v.id === 'mirror');
  if (on === has) return layout;
  if (!on) return { ...layout, views: layout.views.filter((v) => v.id !== 'mirror') };
  const i = layout.views.findIndex((v) => v.id === 'cams');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, MIRROR_VIEW);
  return { ...layout, views };
}

export type MirrorMode = 'rear' | 'three' | 'off';
export const MIRROR_MODES: MirrorMode[] = ['rear', 'three', 'off'];
export const nextMode = (m: MirrorMode): MirrorMode => MIRROR_MODES[(MIRROR_MODES.indexOf(m) + 1) % MIRROR_MODES.length];

/**
 * What the mirror shows now. Reverse always shows the rear camera (with guides) whatever the mode;
 * a turn signal slides that side's camera in; "off" is a black glass, woken by reverse or a signal.
 */
export function mirrorView(mode: MirrorMode, s: { reverse: boolean | null; turnSignals: { left: boolean | null; right: boolean | null } } | null): {
  rear: boolean; left: boolean; right: boolean; guides: boolean; dark: boolean;
} {
  const side = signalSide(s?.turnSignals);
  const reverse = s?.reverse === true;
  if (reverse) return { rear: true, left: false, right: false, guides: true, dark: false };
  const left = mode === 'three' || side === 'left';
  const right = mode === 'three' || side === 'right';
  if (mode === 'off' && side !== 'left' && side !== 'right') return { rear: false, left: false, right: false, guides: false, dark: true };
  return { rear: true, left, right, guides: false, dark: false };
}
