// The Map view's place in the layout. Pure (no Leaflet), so tests and App can use it.
import type { Layout } from '../../../brain/src/types.ts';

export const MAP_ICON = 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14';
export const MAP_VIEW: Layout['views'][number] = { id: 'map', label: 'Map', widgets: [{ type: 'map', col: 1, row: 1, w: 12, h: 2 }] };
/**
 * The Traffic screen lives in the Map screen's Traffic tab: a layout whose
 * Traffic view is the standard one (just the traffic widget) loses it from the
 * rail. A Traffic view someone changed stays. Pure.
 */
export function foldTrafficIntoMap(layout: Layout): Layout {
  const i = layout.views.findIndex((v) => v.id === 'traffic');
  if (i < 0 || !layout.views[i].widgets.every((w) => w.type === 'trafficAhead')) return layout;
  return { ...layout, views: layout.views.filter((_, k) => k !== i) };
}

/** Every layout gets the Map view, after Drive, unless it already has one. */
export function withMapView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'map')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'drive');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, MAP_VIEW);
  return { ...layout, views };
}
