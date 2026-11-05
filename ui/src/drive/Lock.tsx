// What a paused feature shows while driving, and the city/highway split line for trips.
import type { ComponentChildren } from 'preact';
import type { Trip } from '../lib/brain.ts';
import { useLockout } from './hooks.ts';

/** Wrap video, a browser or a long list: over the lockout speed it is replaced by a calm notice. */
export function DrivingLock({ what, children, summary }: { what: 'video' | 'browser' | 'list'; children: ComponentChildren; summary?: ComponentChildren }) {
  const { locked } = useLockout();
  if (!locked) return <>{children}</>;
  const words = what === 'video' ? 'Video pauses' : what === 'browser' ? 'The browser pauses' : 'Long lists pause';
  return (
    <div class="lockout" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
      <b>{words} while driving</b>
      {summary && <div class="lockout-sum">{summary}</div>}
      <span class="dimtxt">Back when the truck stops.</span>
    </div>
  );
}

/** "City 8.2 mi · Hwy 12.4 mi" with a two-part bar; nothing for trips recorded before the split. */
export function ModeSplit({ t, kwh }: { t: Pick<Trip, 'miles' | 'cityMiles' | 'highwayMiles' | 'cityKwh' | 'highwayKwh'>; kwh?: boolean }) {
  if (t.cityMiles == null && t.highwayMiles == null) return null;
  const c = t.cityMiles ?? 0, h = t.highwayMiles ?? 0, tot = c + h || 1;
  const eff = (mi: number, k: number | null | undefined) => (k && k > 0 ? ` · ${(mi / k).toFixed(1)} mi/kWh` : '');
  return (
    <span class="modesplit" title="Split by the 2-minute average speed (highway at or over the threshold). kWh are estimates until CAN.">
      <span class="msbar" aria-hidden="true"><i style={{ width: `${(c / tot) * 100}%` }} /><i class="hwy" style={{ width: `${(h / tot) * 100}%` }} /></span>
      <span class="num">City {c.toFixed(1)} mi{kwh && t.cityKwh != null ? ` · ~${t.cityKwh.toFixed(1)} kWh${eff(c, t.cityKwh)}` : ''}</span>
      <span class="num">Hwy {h.toFixed(1)} mi{kwh && t.highwayKwh != null ? ` · ~${t.highwayKwh.toFixed(1)} kWh${eff(h, t.highwayKwh)}` : ''}</span>
    </span>
  );
}
