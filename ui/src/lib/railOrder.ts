// The left rail's icon order, rearranged by press-and-hold and saved per driver.

export const RAIL_ORDER_KEY = 'slate.railOrder';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CachedOrder = { driver: string; order: string[] | null };

// The order lives on the brain, per driver (Driver.railOrder). This browser keeps
// only a copy of the last driver's order so the first paint, before settings
// arrive, already looks right. It is never the source of truth.

/** The cached order, or null when there is none (or it is unreadable). */
export function loadCache(store: KV | null | undefined): CachedOrder | null {
  try {
    const raw = store?.getItem(RAIL_ORDER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CachedOrder> | null;
    if (!v || typeof v.driver !== 'string') return null;
    const order = Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === 'string') : null;
    return { driver: v.driver, order };
  } catch { return null; }
}

export function saveCache(store: KV | null | undefined, c: CachedOrder): void {
  try { store?.setItem(RAIL_ORDER_KEY, JSON.stringify(c)); } catch { /* private window or full storage */ }
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

/**
 * Which saved order the rail uses: an edit not yet confirmed by the brain (for
 * this driver only), else the active driver's own order, else (settings not
 * loaded yet) the cached copy. null means the default order.
 */
export function pickOrder(o: { driver: string | null; driverOrder: string[] | null; draft: CachedOrder | null; cache: CachedOrder | null }): string[] | null {
  if (o.driver === null) return o.cache?.order ?? null;
  if (o.draft && o.draft.driver === o.driver) return o.draft.order;
  return o.driverOrder;
}

/** Move one id to the end (the driver's profile stays at the bottom of the rail). Pure. */
export function pinLast(order: string[], id: string): string[] {
  return order.includes(id) ? [...order.filter((x) => x !== id), id] : order;
}
