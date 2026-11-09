// Parse the truck box's ESPHome topics (docs/contract.md) into State patches. Pure.
import type { State, Wheel } from './types.ts';

export type TruckboxPatch = {
  truckbox?: boolean;
  relay?: { id: string; on: boolean | null };
  fiveSwitch?: { index: number; on: boolean | null };
  ignition?: boolean | null;
  reverse?: boolean | null;
  cabinTempF?: number | null;
  cabinHumidity?: number | null;
  aux12v?: number | null;
  pitch?: number | null;
  roll?: number | null;
  tpms?: { wheel: Wheel; field: 'psi' | 'tempF'; value: number | null };
  /** Measured watts (packages/power_ina226.yaml). */
  relayW?: { id: string; w: number | null };
  dashW?: number | null;
};

const onOff = (p: string): boolean | null => (p === 'ON' ? true : p === 'OFF' ? false : null);
const float = (p: string): number | null => {
  if (p === '' || /^(nan|unknown|unavailable|none)$/i.test(p)) return null;
  const n = Number(p);
  return Number.isFinite(n) ? n : null;
};

/** `sub` is the topic after "<truckId>/truckbox/". Returns null for topics we don't use. */
/** A watts reading: a number from 0 to 5 kW, else null (unavailable, NaN, nonsense). Pure. */
const watts = (p: string) => { const v = Number(p); return Number.isFinite(v) && v >= 0 && v < 5000 ? Math.round(v * 10) / 10 : null; };

export function parseTruckbox(sub: string, payload: string): TruckboxPatch | null {
  const p = payload.trim();
  if (sub === 'status') return { truckbox: p === 'online' };
  let m = /^switch\/(relay_[1-6])\/state$/.exec(sub);
  if (m) return { relay: { id: m[1], on: onOff(p) } };
  m = /^binary_sensor\/five_switch_([1-5])\/state$/.exec(sub);
  if (m) return { fiveSwitch: { index: Number(m[1]) - 1, on: onOff(p) } };
  if (sub === 'binary_sensor/ignition/state') return { ignition: onOff(p) };
  if (sub === 'binary_sensor/reverse/state') return { reverse: onOff(p) };
  if (sub === 'sensor/cabin_temp/state') return { cabinTempF: float(p) };
  if (sub === 'sensor/cabin_humidity/state') return { cabinHumidity: float(p) };
  if (sub === 'sensor/aux_battery_v/state') return { aux12v: float(p) };
  if (sub === 'sensor/pitch/state') return { pitch: float(p) };
  if (sub === 'sensor/roll/state') return { roll: float(p) };
  m = /^sensor\/tpms_(fl|fr|rl|rr)_(psi|temp)\/state$/.exec(sub);
  if (m) return { tpms: { wheel: m[1] as Wheel, field: m[2] === 'psi' ? 'psi' : 'tempF', value: float(p) } };
  m = /^sensor\/(relay_[1-6])_w\/state$/.exec(sub);
  if (m) return { relayW: { id: m[1], w: watts(p) } };
  if (sub === 'sensor/dash_w/state') return { dashW: watts(p) };
  return null;
}

/** Apply a patch to the state in place. Pitch/roll are held until both are known. */
export function applyTruckbox(s: State, p: TruckboxPatch, tilt: { pitch: number | null; roll: number | null }): void {
  if (p.truckbox !== undefined) {
    s.truckbox = p.truckbox;
    if (!p.truckbox) clearTruckbox(s, tilt);
  }
  if (p.relay && s.relays[p.relay.id]) s.relays[p.relay.id].on = p.relay.on;
  if (p.fiveSwitch) s.fiveSwitch[p.fiveSwitch.index] = p.fiveSwitch.on;
  if (p.ignition !== undefined) s.ignition = p.ignition;
  if (p.reverse !== undefined) { s.reverse = p.reverse; }
  if (p.cabinTempF !== undefined) s.cabinTempF = p.cabinTempF;
  if (p.aux12v !== undefined) s.aux12v = p.aux12v;
  if (p.pitch !== undefined) tilt.pitch = p.pitch;
  if (p.roll !== undefined) tilt.roll = p.roll;
  if (p.pitch !== undefined || p.roll !== undefined) s.tilt = tilt.pitch !== null && tilt.roll !== null ? { pitch: tilt.pitch, roll: tilt.roll } : null;
  if (p.relayW && s.relays[p.relayW.id]) s.relays[p.relayW.id].measuredW = p.relayW.w;
  if (p.dashW !== undefined) s.dashW = p.dashW;
  if (p.tpms) {
    s.tpms ??= { fl: { psi: null, tempF: null }, fr: { psi: null, tempF: null }, rl: { psi: null, tempF: null }, rr: { psi: null, tempF: null } };
    s.tpms[p.tpms.wheel][p.tpms.field] = p.tpms.value;
  }
  // Gear: R comes from the reverse wire. Anything else needs CAN, so it is null, not "D".
  if (p.reverse !== undefined || p.truckbox !== undefined) s.gear = s.reverse === true ? 'R' : null;
}

/** Truck box offline: everything it reported is now unknown. */
export function clearTruckbox(s: State, tilt: { pitch: number | null; roll: number | null }) {
  for (const r of Object.values(s.relays)) { r.on = null; r.measuredW = null; }
  s.dashW = null;
  s.fiveSwitch = s.fiveSwitch.map(() => null);
  s.ignition = null; s.reverse = null; s.cabinTempF = null; s.aux12v = null; s.tilt = null; s.tpms = null; s.gear = null;
  tilt.pitch = null; tilt.roll = null;
}
