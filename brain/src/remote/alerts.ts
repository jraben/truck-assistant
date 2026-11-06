// The alert engine: pure. Feed it a snapshot of the truck once in a while
// (every few seconds) and it returns the alerts to send. Each rule can be off,
// has a threshold, a hold time (the condition must stay true that long:
// debounce) and a cooldown (no repeat for that long). Level rules (too hot,
// low 12V, low tire, truck box offline) repeat after the cooldown while the
// condition lasts; event rules (motion, charging, geofence, theft) fire once
// per event, cooldown permitting.
import { metersBetween } from '../geo.ts';
import { ALERT_META } from './alertMeta.ts';
import type { AlertKind, AlertSettings } from './types.ts';
import type { ChargePeak } from '../types.ts';

export type AlertInput = {
  now: number;
  parked: boolean;                  // ignition off (or unknown) and not moving
  cabinTempF: number | null;
  aux12v: number | null;
  tpms: { wheel: string; psi: number }[];   // known readings only
  truckboxOnline: boolean;
  truckboxOfflineSince: number | null;      // ms; null while online or never seen
  motion: { camera: string | null; how: string } | null;   // a motion/vibration event since the last call
  theft: { movedM: number; at: { lat: number; lon: number }; place: string | null; why: string } | null;  // from theft.ts, already decided
  position: { lat: number; lon: number } | null;
  soc: number | null;
  pluggedIn: boolean | null;        // HA charger entity, if set
  /** State.chargePeak: charging at home inside an on-peak period, or plugged in just before one. */
  chargePeak?: ChargePeak | null;
};

export type Fired = { kind: AlertKind; title: string; message: string; priority: 'default' | 'high' };

type RuleState = { since: number | null; lastFired: number | null; latched: boolean };

const fmt = (n: number, d = 0) => n.toFixed(d);
/** Meters as miles for alert text: "0.3 mi", "12 mi"; under a tenth reads as feet. */
export const miles = (m: number) => { const mi = m / 1609.344; return mi < 0.1 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`; };

/** Inside "HH:MM".."HH:MM" (may cross midnight)? */
export function inQuietHours(now: number, start: string, end: string): boolean {
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

export class AlertEngine {
  private st = new Map<AlertKind, RuleState>();
  private socHistory: { t: number; soc: number }[] = [];
  private charging = false;
  private lastSocRiseAt: number | null = null;
  private wasPlugged: boolean | null = null;
  private zonesInside = new Set<string>();
  private settings: AlertSettings;
  constructor(settings: AlertSettings) { this.settings = settings; }

  setSettings(s: AlertSettings) { this.settings = s; }

  private state(k: AlertKind): RuleState {
    let s = this.st.get(k);
    if (!s) { s = { since: null, lastFired: null, latched: false }; this.st.set(k, s); }
    return s;
  }

  /** Level rule: true for holdSec, then fire, and again every cooldown while it stays true. */
  private level(k: AlertKind, cond: boolean, now: number, make: () => Omit<Fired, 'kind'>, out: Fired[]) {
    const r = this.settings.rules[k];
    const s = this.state(k);
    if (!r?.enabled || !cond) { s.since = null; s.latched = false; return; }
    if (s.since === null) s.since = now;
    if (now - s.since < r.holdSec * 1000) return;
    if (s.lastFired !== null && now - s.lastFired < r.cooldownMin * 60_000) return;
    s.lastFired = now; s.latched = true;
    out.push({ kind: k, ...make() });
  }

  /** Event rule: fires for the event unless it fired within the cooldown. */
  private event(k: AlertKind, happened: boolean, now: number, make: () => Omit<Fired, 'kind'>, out: Fired[]) {
    const r = this.settings.rules[k];
    if (!r?.enabled || !happened) return;
    const s = this.state(k);
    if (s.lastFired !== null && now - s.lastFired < r.cooldownMin * 60_000) return;
    s.lastFired = now;
    out.push({ kind: k, ...make() });
  }

  evaluate(i: AlertInput): Fired[] {
    const out: Fired[] = [];
    const R = this.settings.rules;
    const now = i.now;

    const hot = R.cabinHot.threshold ?? ALERT_META.cabinHot.threshold!;
    this.level('cabinHot', i.cabinTempF !== null && i.cabinTempF >= hot, now, () => ({
      title: `Cabin ${fmt(i.cabinTempF!)}°F`, message: `The cab is at ${fmt(i.cabinTempF!)}°F (alert at ${fmt(hot)}°F). Check for pets or kids.`, priority: 'high',
    }), out);

    const lowV = R.low12v.threshold ?? 12;
    // Only while parked: cranking and DC-DC dips while driving are not a flat battery.
    this.level('low12v', i.parked && i.aux12v !== null && i.aux12v < lowV, now, () => ({
      title: `12V battery ${fmt(i.aux12v!, 2)} V`, message: `The 12V battery is at ${fmt(i.aux12v!, 2)} V (alert below ${fmt(lowV, 1)} V). Relays will drop at the truck box cutoff; the Pi stays asleep.`, priority: 'high',
    }), out);

    const psi = R.tirePressure.threshold ?? 30;
    const low = i.tpms.filter((t) => t.psi < psi);
    this.level('tirePressure', low.length > 0, now, () => ({
      title: `Tire pressure low: ${low.map((t) => t.wheel.toUpperCase()).join(', ')}`, message: low.map((t) => `${t.wheel.toUpperCase()} ${fmt(t.psi)} psi`).join(', ') + ` (alert below ${fmt(psi)} psi).`, priority: 'default',
    }), out);

    const offMin = R.truckboxOffline.threshold ?? 120;
    const offFor = !i.truckboxOnline && i.truckboxOfflineSince !== null ? (now - i.truckboxOfflineSince) / 60_000 : 0;
    this.level('truckboxOffline', offFor >= offMin, now, () => ({
      title: 'Truck box offline', message: `No word from the truck box for ${Math.round(offFor)} minutes. Relays and sensors are unknown.`, priority: 'default',
    }), out);

    this.event('motionParked', i.parked && i.motion !== null, now, () => ({
      title: 'Motion at the truck', message: `${i.motion!.how} while parked${i.motion!.camera ? `; saving a clip from ${i.motion!.camera}` : ''}.`, priority: 'high',
    }), out);

    this.event('theft', i.theft !== null, now, () => ({
      title: 'Truck moved', message: `The truck moved ${miles(i.theft!.movedM)} from where it was parked, ${i.theft!.why}. Now ${i.theft!.place ? `at ${i.theft!.place}` : 'at an unnamed spot (see the Truck page map)'}.`, priority: 'high',
    }), out);

    // Geofence: left a zone while inside the quiet hours.
    const gf = this.settings.geofence;
    if (i.position) {
      for (const z of gf.zones) {
        const inside = metersBetween(i.position, z) <= z.radiusM;
        const was = this.zonesInside.has(z.name);
        if (inside) this.zonesInside.add(z.name); else this.zonesInside.delete(z.name);
        if (was && !inside) this.event('geofence', inQuietHours(now, gf.quietStart, gf.quietEnd), now, () => ({
          title: `Left ${z.name}`, message: `The truck left ${z.name} at ${new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, inside the quiet hours (${gf.quietStart}–${gf.quietEnd}).`, priority: 'high',
        }), out);
      }
    }

    // Charging, from the charge level rising while parked (CAN later), and the charger's plug entity if HA has one.
    if (i.soc !== null) {
      const last = this.socHistory[this.socHistory.length - 1];
      if (!last || last.soc !== i.soc) this.socHistory.push({ t: now, soc: i.soc });
      if (last && i.soc > last.soc && i.parked) { this.charging = true; this.lastSocRiseAt = now; }
      this.socHistory = this.socHistory.filter((p) => now - p.t < 6 * 3600_000).slice(-200);
    }
    if (!i.parked) this.charging = false;
    const target = this.settings.chargeTargetSoc;
    if (this.charging && i.soc !== null && i.soc >= target) {
      this.charging = false;
      this.event('chargeDone', true, now, () => ({ title: `Charged to ${fmt(i.soc!)}%`, message: `Charging reached ${fmt(i.soc!)}% (target ${fmt(target)}%).`, priority: 'default' }), out);
    }
    const stallMin = R.chargeStopped.threshold ?? 10;
    if (this.charging && this.lastSocRiseAt !== null && now - this.lastSocRiseAt >= stallMin * 60_000 && i.soc !== null && i.soc < target) {
      this.charging = false;
      this.event('chargeStopped', true, now, () => ({ title: `Charging stopped at ${fmt(i.soc!)}%`, message: `The charge level hasn't risen for ${fmt(stallMin)} minutes, short of ${fmt(target)}%.`, priority: 'high' }), out);
    }
    // On-peak charging: a level rule (repeats every cooldown, default 15 min, while it lasts); the heads-up once per window.
    const cp = i.chargePeak ?? null;
    this.level('chargingPeak', !!cp?.onPeak, now, () => ({ title: cp!.title ?? 'Charging on-peak', message: cp!.message ?? 'The truck is charging at home during on-peak.', priority: 'high' }), out);
    this.level('peakSoon', !!cp?.headsUp, now, () => ({ title: cp!.headsUpTitle ?? 'On-peak soon', message: cp!.headsUp!, priority: 'default' }), out);

    if (i.pluggedIn !== null) {
      if (this.wasPlugged === true && i.pluggedIn === false) {
        this.event('unplugged', true, now, () => ({ title: 'Unplugged', message: `The charger was unplugged${i.soc !== null ? ` at ${fmt(i.soc)}%` : ''}.`, priority: 'default' }), out);
        this.charging = false;
      }
      this.wasPlugged = i.pluggedIn;
    }
    return out;
  }
}
