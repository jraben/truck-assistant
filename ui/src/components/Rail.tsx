// The left rail: one icon per screen and tool, each with a short word under it
// (the current screen's name is also in the top bar). Press and hold an icon to rearrange, like a phone's
// home screen: the icons wiggle, drag one to move it, tap outside or Done to finish.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { moveItem } from '../lib/railOrder.ts';

export type RailEntry = {
  id: string;
  label: string;
  /** The word under the icon when the label is too long for the rail (default: label). */
  short?: string;
  icon: ComponentChildren;
  /** A link (views, Settings) when set; otherwise a button calling onTap. */
  href?: string;
  onTap?: () => void;
  /** Highlighted: the screen showing, or the panel that is open. */
  current?: boolean;
  pressed?: boolean;
  cls?: string;
  /** What to show outside edit mode instead of the plain icon (the WOPR talk button). */
  live?: ComponentChildren;
  /** False when holding the icon already means something (WOPR: hold to talk). */
  holdToEdit?: boolean;
  /** Hidden at speed (theme, logs, test panel, settings). */
  parkOnly?: boolean;
};

const HOLD_MS = 500;
/** Further than this before the hold fires and it's a scroll or a slide, not a hold. */
const SLOP_PX = 10;
const EDGE_PX = 36;

type Gesture = { id: string; pid: number; x: number; y: number; timer: number; dragging: boolean };

export function Rail({ entries, editing, onEdit, onReorder, locked }: {
  entries: RailEntry[];
  /** At speed: no rearranging. */
  locked?: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onReorder: (order: string[]) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const g = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const ids = entries.map((e) => e.id);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const end = () => {
    const st = g.current;
    if (!st) return;
    clearTimeout(st.timer);
    if (st.dragging) { try { nav.current?.releasePointerCapture(st.pid); } catch { /* already released */ } }
    g.current = null;
    setDragId(null);
  };

  const startDrag = (st: Gesture) => {
    st.dragging = true;
    setDragId(st.id);
    try { nav.current?.setPointerCapture(st.pid); } catch { /* pointer already gone */ }
  };

  const down = (e: PointerEvent, entry: RailEntry) => {
    if (e.button !== 0 || g.current) return;
    const st: Gesture = { id: entry.id, pid: e.pointerId, x: e.clientX, y: e.clientY, timer: 0, dragging: false };
    g.current = st;
    if (editing) { startDrag(st); return; }
    if (entry.holdToEdit === false || locked) { g.current = null; return; }
    st.timer = window.setTimeout(() => {
      if (g.current !== st) return;
      swallowClick.current = true; // the release after a hold is not a tap
      onEdit(true);
      startDrag(st);
      try { navigator.vibrate?.(20); } catch { /* not on this device */ }
    }, HOLD_MS);
  };

  const move = (e: PointerEvent) => {
    const st = g.current;
    if (!st || e.pointerId !== st.pid) return;
    if (!st.dragging) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > SLOP_PX) { clearTimeout(st.timer); g.current = null; }
      return;
    }
    const el = nav.current;
    if (!el) return;
    const row = getComputedStyle(el).flexDirection === 'row';
    const p = row ? e.clientX : e.clientY;
    // Scroll the rail when dragging to its end (it scrolls when the icons don't all fit).
    const r = el.getBoundingClientRect();
    const lo = row ? r.left : r.top, hi = row ? r.right : r.bottom;
    if (p < lo + EDGE_PX) row ? el.scrollBy(-8, 0) : el.scrollBy(0, -8);
    else if (p > hi - EDGE_PX) row ? el.scrollBy(8, 0) : el.scrollBy(0, 8);
    // Drop target: the slot whose middle is nearest the finger.
    const slots = Array.from(el.querySelectorAll<HTMLElement>(':scope > .slot'));
    let best = -1, bestD = Infinity;
    slots.forEach((s, i) => {
      const b = s.getBoundingClientRect();
      const d = Math.abs(p - (row ? b.left + b.width / 2 : b.top + b.height / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    const order = idsRef.current;
    const from = order.indexOf(st.id);
    if (best >= 0 && from >= 0 && best !== from) onReorder(moveItem(order, from, best));
  };

  // While dragging, a finger move must not scroll the rail or the page.
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const f = (e: TouchEvent) => { if (g.current?.dragging) e.preventDefault(); };
    el.addEventListener('touchmove', f, { passive: false });
    return () => el.removeEventListener('touchmove', f);
  }, []);

  // Edit mode ends with a tap anywhere outside the rail (that tap does nothing else) or Escape.
  useEffect(() => { if (locked && editing) onEdit(false); }, [locked]);

  useEffect(() => {
    if (!editing) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || nav.current?.contains(t) || t.closest?.('.rail-edit')) return;
      onEdit(false);
      const eat = (c: Event) => { c.preventDefault(); c.stopPropagation(); };
      document.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 600);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onEdit(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key); };
  }, [editing]);

  // Keyboard: in edit mode the arrow keys move the focused icon.
  const keyMove = (e: KeyboardEvent, id: string) => {
    if (!editing) return;
    const d = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (e.key === 'Enter') { e.preventDefault(); onEdit(false); return; }
    if (!d) return;
    e.preventDefault();
    const i = ids.indexOf(id);
    onReorder(moveItem(ids, i, i + d));
  };

  return (
    <nav ref={nav} class={`rail ${editing ? 'editing' : ''}`} aria-label={editing ? 'Views: drag to rearrange' : 'Views'}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { if (g.current?.dragging) end(); }}
      onContextMenu={(e) => e.preventDefault()}
      onClickCapture={(e) => { if (editing || swallowClick.current) { e.preventDefault(); e.stopPropagation(); swallowClick.current = false; } }}>
      {entries.map((x) => {
        const common = {
          'aria-label': x.label, title: editing ? `${x.label}: drag to move` : x.label,
          class: `${x.cls ?? ''}`, 'aria-current': x.current && x.href ? 'page' as const : undefined,
          onKeyDown: (e: KeyboardEvent) => keyMove(e, x.id),
        };
        return (
          <div key={x.id} class={`slot ${dragId === x.id ? 'lift' : ''} ${x.current ? 'on' : ''} ${x.parkOnly ? 'park-only' : ''}`} data-id={x.id}
            onPointerDown={(e) => down(e, x)}>
            {!editing && x.live ? x.live
              : x.href ? <a href={x.href} draggable={false} {...common} onClick={(e) => { if (x.href!.startsWith('#')) { e.preventDefault(); x.onTap?.(); } }}>{x.icon}<span class="rl" aria-hidden="true">{x.short ?? x.label}</span></a>
              : <button type="button" {...common} aria-pressed={x.pressed} onClick={() => x.onTap?.()}>{x.icon}<span class="rl" aria-hidden="true">{x.short ?? x.label}</span></button>}
          </div>
        );
      })}
    </nav>
  );
}
