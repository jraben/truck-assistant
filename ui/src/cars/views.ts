// The Family cars view's place in the layout. Pure (tests import it).
import type { Layout } from '../../../brain/src/types.ts';

export const FAMILY_ICON = 'M3 13l2-5a2 2 0 0 1 2-1.4h10A2 2 0 0 1 19 8l2 5v4h-2M3 13v4h2M3 13h18M7 17a2 2 0 1 0 0 .01M17 17a2 2 0 1 0 0 .01M9 17h6';
export const FAMILY_VIEW: Layout['views'][number] = { id: 'family', label: 'Family', widgets: [{ type: 'familyCars', col: 1, row: 1, w: 12, h: 2 }] };

/** Every layout gets the Family cars view, after Gauges (or at the end), unless it has one. */
export function withFamilyView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'family')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'gauges');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, FAMILY_VIEW);
  return { ...layout, views };
}

/** "3 min ago", "5 h ago", "2 days ago". Pure. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
