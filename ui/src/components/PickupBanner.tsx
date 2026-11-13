// The airport pickup banner (on every view while a pickup is on), with an ×
// to hide it and a small "Pickup" pill in the top strip to bring it back.
// Hiding lasts until the pickup gets more urgent: it lands (or is at the
// gate), then "Leave now", each brings the banner back by itself, so hiding
// it early can't make you miss leaving. Hiding expires after HIDE_FOR_MS, so the
// next pickup (another day) starts shown.
import { store, useStore, type State } from '../lib/brain.ts';

/** What the cockpit gets in State.pickup. */
export type Brief = { phase: string; line: string; leaveNow: boolean };

/** 0: on its way; 1: landed, taxiing or at the gate; 2: leave now. Pure. */
export function pickupLevel(p: Brief): number {
  return p.leaveNow ? 2 : p.phase === 'taxiing' || p.phase === 'at-gate' ? 1 : 0;
}
/** Show the banner unless it was hidden at this level or higher. Pure. */
export const pickupBannerShown = (p: Brief, hiddenAt: number | null) => hiddenAt === null || pickupLevel(p) > hiddenAt;

// Per screen; kept across a reload so it doesn't pop back after a refresh.
const KEY = 'slate.pickup.hidden';
export const HIDE_FOR_MS = 12 * 3600_000;
/** The level it was hidden at, if that was less than HIDE_FOR_MS ago. Pure. */
export function hiddenLevel(raw: string | null, now: number): number | null {
  try { const v = JSON.parse(raw ?? 'null') as { level?: unknown; at?: unknown } | null; return v && typeof v.level === 'number' && typeof v.at === 'number' && now - v.at < HIDE_FOR_MS ? v.level : null; } catch { return null; }
}
const read = (): number | null => { try { return hiddenLevel(localStorage.getItem(KEY), Date.now()); } catch { return null; } };
const hiddenStore = store<number | null>(read());
const setHidden = (v: number | null) => { hiddenStore.set(v); try { if (v === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify({ level: v, at: Date.now() })); } catch { /* private mode */ } };

export function PickupBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const p = s?.pickup;
  const hiddenAt = useStore(hiddenStore);
  if (!p) return null;
  if (!pickupBannerShown(p, hiddenAt)) return null;
  const urgent = pickupLevel(p) > 0;
  return (
    <div class={`banner ${p.leaveNow ? '' : urgent ? 'ok' : 'calm'} peakbanner tripbanner pickupbanner`} role="status">
      <button type="button" class="bn-main" onClick={() => go('roadtrip')}><b>{p.leaveNow ? 'Leave now' : 'Pickup'}</b><span>{p.line}</span></button>
      <button type="button" class="bn-x" aria-label="Hide the pickup banner" title="Hide (the Pickup button in the top bar brings it back)" onClick={() => setHidden(pickupLevel(p))}>×</button>
    </div>
  );
}

/** Top strip, while the banner is hidden: tap to bring it back. */
export function PickupPill({ s }: { s: State | null }) {
  const p = s?.pickup;
  const hiddenAt = useStore(hiddenStore);
  if (!p || pickupBannerShown(p, hiddenAt)) return null;
  return (
    <button type="button" class="pill pickup-pill" onClick={() => setHidden(null)} title={`${p.line} (tap to show)`} aria-label="Show the pickup banner">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 13l8-1 5-8h2l-2 8 5 1 2-2h2l-1 4 1 4h-2l-2-2-5 1 2 8h-2l-5-8-8-1z" /></svg>
      Pickup
    </button>
  );
}
