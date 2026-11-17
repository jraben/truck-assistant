// The truck's own "Vehicle settings" menu (the instrument screen: Charging,
// Tire pressure, Parking brake, Diagnostic mode, Battery state of health,
// Distance since last update), as far as TA can follow it without the CAN bus.
// TA cannot set the truck's charge limit or parking brake; it keeps the same
// choices so its own numbers match (WEEK, charge times, low-tire warnings).
import type { ChargeSession, Wheel } from './types.ts';
import { CHARGE_EFFICIENCY } from './charges/pricing.ts';

export const WHEELS: Wheel[] = ['fl', 'fr', 'rl', 'rr'];

export type VehicleSettings = {
  /** Charging, Charge limit: the truck's own menu offers 100% or 80% ("80% to prolong battery life"). */
  chargeLimitPct: 80 | 100;
  /** Charging, Charge current: amps the home charger is set to (240 V). */
  chargeAmps: number;
  /** Tire pressure, Reset system: each tire's pressure when last reset after filling all four. */
  tpmsBaseline: { psi: Record<Wheel, number>; at: string } | null;
};

export const defaultVehicle = (): VehicleSettings => ({ chargeLimitPct: 80, chargeAmps: 32, tpmsBaseline: null });

/** A tire reads low when it is this share below its reset pressure (the usual TPMS rule: 25%). */
export const TPMS_DROP = 0.25;
const VOLTS = 240;

/** Home charging power into the pack, kW, from the charge current. */
export const homeKw = (amps: number) => Math.round(((amps * VOLTS) / 1000) * CHARGE_EFFICIENCY * 10) / 10;

/** Hours to charge from `fromPct` to the limit at home. */
export function hoursToLimit(packKwh: number, v: Pick<VehicleSettings, 'chargeLimitPct' | 'chargeAmps'>, fromPct = 10): number {
  const need = Math.max(0, ((v.chargeLimitPct - fromPct) / 100) * packKwh);
  return Math.round((need / homeKw(v.chargeAmps)) * 10) / 10;
}

export class VehicleError extends Error {}

export function validateVehicle(v: unknown): VehicleSettings {
  const d = defaultVehicle();
  if (v === undefined || v === null) return d;
  if (typeof v !== 'object' || Array.isArray(v)) throw new VehicleError('vehicle must be an object');
  const o = v as Record<string, unknown>;
  const limit = o.chargeLimitPct === undefined ? d.chargeLimitPct : o.chargeLimitPct;
  if (limit !== 80 && limit !== 100) throw new VehicleError('vehicle.chargeLimitPct must be 80 or 100');
  const amps = o.chargeAmps === undefined ? d.chargeAmps : Number(o.chargeAmps);
  if (!Number.isFinite(amps) || amps < 6 || amps > 80) throw new VehicleError('vehicle.chargeAmps must be 6 to 80');
  let base: VehicleSettings['tpmsBaseline'] = null;
  if (o.tpmsBaseline !== undefined && o.tpmsBaseline !== null) {
    const b = o.tpmsBaseline as { psi?: Record<string, unknown>; at?: unknown };
    if (!b.psi || typeof b.at !== 'string') throw new VehicleError('vehicle.tpmsBaseline needs psi and at');
    const psi = {} as Record<Wheel, number>;
    for (const w of WHEELS) { const n = Number(b.psi[w]); if (!Number.isFinite(n) || n < 5 || n > 120) throw new VehicleError(`vehicle.tpmsBaseline.psi.${w} must be 5 to 120`); psi[w] = Math.round(n * 10) / 10; }
    base = { psi, at: b.at };
  }
  return { chargeLimitPct: limit, chargeAmps: Math.round(amps), tpmsBaseline: base };
}

/** Tire pressure, Reset system: the four pressures now become the baseline. Null when a tire has no reading. */
export function tpmsReset(tpms: Record<Wheel, { psi: number | null }> | null, now = new Date()): VehicleSettings['tpmsBaseline'] {
  if (!tpms) return null;
  const psi = {} as Record<Wheel, number>;
  for (const w of WHEELS) { const p = tpms[w]?.psi; if (p === null || p === undefined || !Number.isFinite(p)) return null; psi[w] = Math.round(p * 10) / 10; }
  return { psi, at: now.toISOString() };
}

/** Which tires are low against the reset pressures (25% under), or under the fixed floor. */
export function lowTires(tpms: Record<Wheel, { psi: number | null }> | null, base: VehicleSettings['tpmsBaseline'], floorPsi: number): Wheel[] {
  if (!tpms) return [];
  return WHEELS.filter((w) => {
    const p = tpms[w]?.psi;
    if (p === null || p === undefined) return false;
    return p < floorPsi || (base !== null && p < base.psi[w] * (1 - TPMS_DROP));
  });
}

/**
 * Battery state of health, estimated: the usable capacity each logged charge
 * implies (energy in × charger efficiency ÷ share of the pack it filled),
 * median over charges that filled at least 20%, against the pack's rated size.
 * The truck reads it from the battery itself; TA can only infer it.
 */
export function batteryHealth(sessions: Pick<ChargeSession, 'kwh' | 'startSoc' | 'endSoc' | 'simulated'>[], packKwh: number): { pct: number | null; capacityKwh: number | null; sessions: number } {
  const caps = sessions
    .filter((s) => !s.simulated && s.kwh !== null && s.kwh > 0 && s.startSoc !== null && s.endSoc !== null && s.endSoc - s.startSoc >= 20)
    .map((s) => (s.kwh! * CHARGE_EFFICIENCY) / ((s.endSoc! - s.startSoc!) / 100))
    .sort((a, b) => a - b);
  if (!caps.length) return { pct: null, capacityKwh: null, sessions: 0 };
  const mid = caps.length % 2 ? caps[(caps.length - 1) / 2] : (caps[caps.length / 2 - 1] + caps[caps.length / 2]) / 2;
  return { pct: Math.min(100, Math.round((mid / packKwh) * 1000) / 10), capacityKwh: Math.round(mid * 10) / 10, sessions: caps.length };
}
