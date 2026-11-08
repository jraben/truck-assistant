import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import type { State } from '../lib/brain.ts';

/** A value or an em dash that says why it's unknown. */
export function V({ v, why }: { v: string | number | null | undefined; why: string }) {
  if (v === null || v === undefined || v === '') return <span class="na" title={why} aria-label={`unknown: ${why}`}>—</span>;
  return <>{v}</>;
}

/** Why a truck-box field is null. */
export function whyTruck(s: State | null, what = 'this'): string {
  if (!s) return 'Not connected to the brain';
  if (!s.truckbox) return 'Truck box offline';
  return `The truck box hasn't reported ${what} yet`;
}

export function whyGps(s: State | null): string {
  if (!s) return 'Not connected to the brain';
  if (!s.gps) return 'No GPS: is gpsd running and the puck plugged in?';
  if (!s.gps.fix) return 'No GPS fix yet';
  return 'Not known yet';
}

export function whySoc(s: State | null): string {
  if (!s) return 'Not connected to the brain';
  return 'Charge level not set: use the slider on the Charge view';
}

export function Card({ label, right, children, class: cls }: { label?: string; right?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <div class={`card ${cls ?? ''}`}>
      {(label || right) && <div class="row between cardhead"><h2 class="sect">{label}</h2>{right}</div>}
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="row between"><h3>{title}</h3><button class="btn" type="button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
