// Tier 1, the always-on watch (firmware/watch): its MQTT topics, parsed. Pure.
// The watch publishes to the HOME broker over TLS from its own LTE-M modem; the
// brain sees the same topics when the Pi's Mosquitto bridge is up (home Wi-Fi
// or the tier 2 LTE modem). Topics, under `<prefix>` (default slate/watch):
//   <prefix>/status   online | offline (will)                       retained
//   <prefix>/state    {"ts","lat","lon","fix","gps_at","v12","cabin_f","vib","moved","ign","pi","rssi","batt_mv","fw"}  retained
//   <prefix>/alert    {"kind","title","message","ts"}               (the watch's own alerts; HA turns them into pushes)
//   <prefix>/command  {"pi":"wake"|"sleep"} | {"relay":"relay_1","on":true} | {"interval_s":300}   (to the watch, QoS 1)
import type { AlertKind, WatchStatus } from './types.ts';

export const emptyWatch = (): WatchStatus => ({ online: false, lastSeen: null, lat: null, lon: null, fix: false, gpsAt: null, aux12v: null, cabinTempF: null, vibration: null, moved: null, ignition: null, piAwake: null, rssi: null, backupMv: null, fw: null });

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const b = (v: unknown) => (typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : null);
const iso = (v: unknown) => {
  if (typeof v === 'number' && v > 1e9) return new Date(v < 1e12 ? v * 1000 : v).toISOString();   // epoch s or ms
  if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return new Date(v).toISOString();
  return null;
};

export type WatchEvent =
  | { type: 'status'; online: boolean }
  | { type: 'state'; patch: Partial<WatchStatus> }
  | { type: 'alert'; kind: AlertKind | 'other'; title: string; message: string; at: string };

const KINDS: string[] = ['cabinHot', 'low12v', 'motionParked', 'theft', 'geofence', 'chargeStopped', 'chargeDone', 'unplugged', 'tirePressure', 'truckboxOffline'];

/** `sub` is the topic after "<prefix>/". */
export function parseWatch(sub: string, payload: string, now = Date.now()): WatchEvent | null {
  const p = payload.trim();
  if (sub === 'status') return { type: 'status', online: p === 'online' };
  if (sub !== 'state' && sub !== 'alert') return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(p); } catch { return null; }
  if (typeof j !== 'object' || j === null) return null;
  if (sub === 'alert') {
    const kind = typeof j.kind === 'string' && KINDS.includes(j.kind) ? (j.kind as AlertKind) : 'other';
    return { type: 'alert', kind, title: String(j.title ?? 'Truck alert').slice(0, 120), message: String(j.message ?? '').slice(0, 500), at: iso(j.ts) ?? new Date(now).toISOString() };
  }
  const lat = n(j.lat), lon = n(j.lon);
  const fix = b(j.fix) === true && lat !== null && lon !== null && !(lat === 0 && lon === 0);
  const patch: Partial<WatchStatus> = {
    lastSeen: iso(j.ts) ?? new Date(now).toISOString(),
    fix,
    aux12v: n(j.v12), cabinTempF: n(j.cabin_f), vibration: n(j.vib), moved: b(j.moved), ignition: b(j.ign), piAwake: b(j.pi),
    rssi: n(j.rssi), backupMv: n(j.batt_mv), fw: typeof j.fw === 'string' ? j.fw.slice(0, 40) : null,
  };
  // A report without a fix keeps the last known position (that's what the Truck page shows).
  if (fix) { patch.lat = lat; patch.lon = lon; patch.gpsAt = iso(j.gps_at) ?? patch.lastSeen!; }
  return { type: 'state', patch };
}

export const watchCommand = {
  wake: () => JSON.stringify({ pi: 'wake' }),
  sleep: () => JSON.stringify({ pi: 'sleep' }),
  relay: (id: string, on: boolean) => JSON.stringify({ relay: id, on }),
};
