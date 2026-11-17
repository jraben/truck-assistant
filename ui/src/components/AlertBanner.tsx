// The alert banners that follow you to every screen (tire, traffic, road trip,
// on-peak charging), each with an × like the pickup banner. Closing hides that
// alert only: a different one (another crash, another tire, the next road-trip
// step) shows again, and a closed one comes back after CLOSE_FOR_MS.
import type { ComponentChildren } from 'preact';
import { store, useStore } from '../lib/brain.ts';

const KEY = 'slate.banners.closed';
export const CLOSE_FOR_MS = 6 * 3600_000;

/** Which closed ids still count, newest 50 kept. Pure. */
export function stillClosed(raw: string | null, now: number): Record<string, number> {
  try {
    const o = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 50)) if (typeof v === 'number' && now - v < CLOSE_FOR_MS) out[k] = v;
    return out;
  } catch { return {}; }
}
const read = () => { try { return stillClosed(localStorage.getItem(KEY), Date.now()); } catch { return {}; } };
const closedStore = store<Record<string, number>>(read());
const close = (id: string) => {
  const next = { ...stillClosed(JSON.stringify(closedStore.get()), Date.now()), [id]: Date.now() };
  closedStore.set(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: closed for this visit */ }
};

export function AlertBanner({ id, tone, title, children, onOpen, alert = false }: {
  /** What this alert is: closing hides this id, so word it to change when the alert does. */
  id: string;
  tone: 'bad' | 'ok' | 'warn';
  title: ComponentChildren;
  children: ComponentChildren;
  onOpen?: () => void;
  alert?: boolean;
}) {
  const closed = useStore(closedStore);
  if (closed[id] !== undefined && Date.now() - closed[id] < CLOSE_FOR_MS) return null;
  const body = <><b>{title}</b><span>{children}</span></>;
  return (
    <div class={`banner ${tone === 'warn' ? '' : tone} peakbanner tripbanner closable`} role={alert ? 'alert' : 'status'}>
      {onOpen ? <button type="button" class="bn-main" onClick={onOpen}>{body}</button> : <div class="bn-main">{body}</div>}
      <button type="button" class="bn-x" aria-label={`Close this alert`} title="Close (comes back if it changes)" onClick={() => close(id)}>×</button>
    </div>
  );
}
