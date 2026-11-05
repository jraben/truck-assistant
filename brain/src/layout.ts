// The default cockpit layout. Pure (no Node APIs) so the UI can import it too.
import type { Layout } from './types.ts';

/** 12 columns x 2 rows on the 1920x720 bar, unless a view says otherwise. */
export const DEFAULT_LAYOUT: Layout = {
  views: [
    { id: 'drive', label: 'Drive', widgets: [
      { type: 'speed', col: 1, row: 1, w: 3, h: 2 },
      { type: 'soc', col: 4, row: 1, w: 3, h: 2 },
      { type: 'nowPlaying', col: 7, row: 1, w: 3, h: 1 },
      { type: 'nextCharger', col: 10, row: 1, w: 3, h: 1 },
      { type: 'trip', col: 7, row: 2, w: 2, h: 1 },
      { type: 'cabin', col: 9, row: 2, w: 1, h: 1 },
      { type: 'aux12v', col: 10, row: 2, w: 1, h: 1 },
      { type: 'tilt', col: 11, row: 2, w: 2, h: 1 },
    ] },
    { id: 'carplay', label: 'CarPlay', widgets: [
      { type: 'carplay', col: 1, row: 1, w: 10, h: 2 },
      { type: 'liveStrip', col: 11, row: 1, w: 2, h: 2 },
    ] },
    { id: 'control', label: 'Control', widgets: [
      { type: 'relays', col: 1, row: 1, w: 9, h: 2 },
      { type: 'fiveSwitch', col: 10, row: 1, w: 3, h: 1 },
      { type: 'tpms', col: 10, row: 2, w: 3, h: 1 },
    ] },
    { id: 'charge', label: 'Charge', widgets: [
      { type: 'chargers', col: 1, row: 1, w: 6, h: 2 },
      { type: 'socSlider', col: 7, row: 1, w: 3, h: 1 },
      { type: 'costSummary', col: 10, row: 1, w: 3, h: 1 },
      { type: 'costSessions', col: 7, row: 2, w: 6, h: 1 },
    ] },
    { id: 'trips', label: 'Trips', widgets: [
      { type: 'trips', col: 1, row: 1, w: 12, h: 2 },
    ] },
    { id: 'cams', label: 'Cams', widgets: [
      // Grid or one camera; the rear camera by itself (with guides) in reverse. Cameras are set in Settings > Cameras.
      { type: 'cams', col: 1, row: 1, w: 12, h: 2 },
    ] },
  ],
};
