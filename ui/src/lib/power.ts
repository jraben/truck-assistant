// What the Control screen's loads draw. Nothing in the truck box measures
// current, so every figure is the owner's rated watts (Settings › Relay
// names & power), counted while that relay is on, and labelled an estimate.
// The dash tablet draws from the truck only while it charges; on its own
// battery it costs the truck nothing.
import { useEffect, useState } from 'preact/hooks';
import type { State } from './brain.ts';

/** The truck's low-voltage system, for amps. */
export const SYSTEM_VOLTS = 12;

export type TabletPower = {
  /** 0-100, or null where the browser won't say (not Chrome, not a tablet). */
  level: number | null;
  charging: boolean | null;
};

export type PowerSummary = {
  /** Watts per relay id, 0 while off or unknown. */
  byRelay: Record<string, number>;
  /** The tablet's draw on the truck: its watts while charging, 0 on battery, its watts if unknown. */
  tablet: number;
  total: number;
  amps: number;
};

/** Pure (tested). */
export function powerSummary(relays: State['relays'] | null | undefined, tablet: TabletPower, tabletWatts: number): PowerSummary {
  const byRelay: Record<string, number> = {};
  let total = 0;
  for (const [id, r] of Object.entries(relays ?? {})) {
    const w = r.on === true ? Math.max(0, r.watts ?? 0) : 0;
    byRelay[id] = w;
    total += w;
  }
  const t = tablet.charging === false ? 0 : Math.max(0, tabletWatts);
  total += t;
  return { byRelay, tablet: t, total, amps: Math.round((total / SYSTEM_VOLTS) * 10) / 10 };
}

type BatteryLike = EventTarget & { level: number; charging: boolean };

/** This device's battery (the dash tablet, when the cockpit runs on it). */
export function useTabletPower(): TabletPower {
  const [p, setP] = useState<TabletPower>({ level: null, charging: null });
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    let b: BatteryLike | null = null;
    const read = () => { if (b) setP({ level: Math.round(b.level * 100), charging: b.charging }); };
    nav.getBattery().then((bat) => {
      b = bat;
      read();
      bat.addEventListener('levelchange', read);
      bat.addEventListener('chargingchange', read);
    }).catch(() => {});
    return () => { b?.removeEventListener('levelchange', read); b?.removeEventListener('chargingchange', read); };
  }, []);
  return p;
}
