// The default cockpit layout. Pure (no Node APIs) so the UI can import it too.
import type { Layout } from './types.ts';

/** The Charge view's widgets before the payoff goal card (the old default). */
const LEGACY_CHARGE = JSON.stringify([['chargers', 1, 1, 6, 2], ['socSlider', 7, 1, 3, 1], ['costSummary', 10, 1, 3, 1], ['costSessions', 7, 2, 6, 1]]);

/** A layout whose Charge view is still the old default gets the payoff goal card; a customised one is left alone. Pure. */
export function migrateChargeLayout(l: Layout): Layout {
  const i = l.views.findIndex((v) => v.id === 'charge');
  if (i < 0 || JSON.stringify(l.views[i].widgets.map((w) => [w.type, w.col, w.row, w.w, w.h])) !== LEGACY_CHARGE) return l;
  const views = l.views.slice();
  const def = DEFAULT_LAYOUT.views.find((v) => v.id === 'charge')!;
  views[i] = { ...structuredClone(def), label: l.views[i].label };
  return { ...l, views };
}

/**
 * Layouts saved before the Road trip screen existed get it, once, right after
 * Charge. A layout that already has a roadTrip widget anywhere is left alone,
 * and one that has `roadTripAdded` set was given it before (so removing it sticks). Pure.
 */
export function migrateRoadTripLayout(l: Layout): Layout {
  if (l.roadTripAdded || l.views.some((v) => v.widgets.some((w) => w.type === 'roadTrip'))) return l.roadTripAdded ? l : { ...l, roadTripAdded: true };
  const def = DEFAULT_LAYOUT.views.find((v) => v.id === 'roadtrip')!;
  const views = l.views.slice();
  const at = views.findIndex((v) => v.id === 'charge');
  views.splice(at >= 0 ? at + 1 : views.length, 0, structuredClone(def));
  return { ...l, views, roadTripAdded: true };
}

/** Same, once, for the Traffic screen (after Road trip, else Charge). Pure. */
export function migrateTrafficLayout(l: Layout): Layout {
  if (l.trafficAdded || l.views.some((v) => v.widgets.some((w) => w.type === 'trafficAhead'))) return l.trafficAdded ? l : { ...l, trafficAdded: true };
  const def = DEFAULT_LAYOUT.views.find((v) => v.id === 'traffic')!;
  const views = l.views.slice();
  let at = views.findIndex((v) => v.id === 'roadtrip');
  if (at < 0) at = views.findIndex((v) => v.id === 'charge');
  views.splice(at >= 0 ? at + 1 : views.length, 0, structuredClone(def));
  return { ...l, views, trafficAdded: true };
}

/** 12 columns x 2 rows on the 1920x720 bar, unless a view says otherwise. */
export const DEFAULT_LAYOUT: Layout = {
  views: [
    // The Track A Drive screen: speed, battery and range, context cards (ui/src/drive).
    { id: 'drive', label: 'Drive', widgets: [
      { type: 'drive', col: 1, row: 1, w: 12, h: 2 },
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
      { type: 'costSessions', col: 7, row: 2, w: 3, h: 1 },
      { type: 'payoffGoal', col: 10, row: 2, w: 3, h: 1 },
    ] },
    // Road trips: plan charging stops, follow the trip, the charging coach (ui/src/components/roadtrip.tsx).
    { id: 'roadtrip', label: 'Road trip', widgets: [
      { type: 'roadTrip', col: 1, row: 1, w: 12, h: 2 },
    ] },
    // 511 cameras and incidents ahead, enforcement cameras (ui/src/components/traffic.tsx).
    { id: 'traffic', label: 'Traffic', widgets: [
      { type: 'trafficAhead', col: 1, row: 1, w: 12, h: 2 },
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
