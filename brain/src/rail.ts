// The cockpit rail's icon order, saved per driver (Driver.railOrder).
import type { Layout } from './types.ts';

/**
 * Rail ids that are not views in the driver's layout: the screens the UI always
 * adds (Media, Home, Parked) and the tools. The UI's rail entries (App.tsx) must
 * use these ids; anything else in a saved order is dropped.
 */
export const RAIL_EXTRA_IDS = ['media', 'home', 'parked', '@wopr', '@driver', '@theme', '@logs', '@sim', '@settings'] as const;

const MAX = 64;

/**
 * A saved order as stored: null (the default order) or a list of known ids,
 * without duplicates. Unknown, malformed or repeated ids are dropped, not refused,
 * so a stale UI or an old order never blocks saving.
 */
export function validateRailOrder(v: unknown, layout: Layout): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new TypeError('railOrder must be a list of ids or null');
  const known = new Set<string>([...layout.views.map((x) => x.id), ...RAIL_EXTRA_IDS]);
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== 'string' || !known.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX) break;
  }
  return out.length ? out : null;
}
