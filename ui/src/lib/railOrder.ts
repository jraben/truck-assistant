// The left rail's icon order, rearranged by press-and-hold and saved per browser.

export const RAIL_ORDER_KEY = 'slate.railOrder';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The saved order, or null when there is none (or it is unreadable). */
export function loadOrder(store: KV | null | undefined): string[] | null {
  try {
    const raw = store?.getItem(RAIL_ORDER_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch { return null; }
}

export function saveOrder(store: KV | null | undefined, order: string[]): void {
  try { store?.setItem(RAIL_ORDER_KEY, JSON.stringify(order)); } catch { /* private window or full storage */ }
}

export function clearOrder(store: KV | null | undefined): void {
  try { store?.removeItem(RAIL_ORDER_KEY); } catch { /* private window */ }
}

/**
 * What the rail shows: the saved order, minus screens that no longer exist,
 * plus any screens added since, appended in their default order.
 */
export function mergeOrder(saved: readonly string[] | null, available: readonly string[]): string[] {
  const have = new Set(available);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of saved ?? []) if (have.has(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  for (const id of available) if (!seen.has(id)) { out.push(id); seen.add(id); }
  return out;
}

/** `order` with the item at `from` moved to `to`. Out-of-range indexes leave it unchanged. */
export function moveItem<T>(order: readonly T[], from: number, to: number): T[] {
  const out = order.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}
