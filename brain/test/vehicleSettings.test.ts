import { describe, expect, it } from 'vitest';
import { batteryHealth, homeKw, hoursToLimit, lowTires, tpmsReset, validateVehicle } from '../src/vehicle.ts';
import { defaultSettings, mergeSettings } from '../src/settings.ts';

const tires = (fl: number | null, fr = 36, rl = 36, rr = 36) => ({ fl: { psi: fl }, fr: { psi: fr }, rl: { psi: rl }, rr: { psi: rr } });

describe('vehicle settings (the truck menu, followed)', () => {
  it('charge limit is 80 or 100, charge current 6-80 A, and both default sensibly', () => {
    expect(validateVehicle(undefined)).toEqual({ chargeLimitPct: 80, chargeAmps: 32, tpmsBaseline: null });
    expect(validateVehicle({ chargeLimitPct: 100, chargeAmps: 40 })).toMatchObject({ chargeLimitPct: 100, chargeAmps: 40 });
    expect(() => validateVehicle({ chargeLimitPct: 90 })).toThrow(/80 or 100/);
    expect(() => validateVehicle({ chargeAmps: 200 })).toThrow(/6 to 80/);
    // through the settings store: stored, and an older settings file without it gets the defaults
    const s = mergeSettings(defaultSettings(), { vehicle: { chargeLimitPct: 100, chargeAmps: 48, tpmsBaseline: null } });
    expect(s.vehicle).toMatchObject({ chargeLimitPct: 100, chargeAmps: 48 });
    expect(() => mergeSettings(defaultSettings(), { vehicle: { chargeLimitPct: 70 } })).toThrow(/80 or 100/);
  });

  it('charge current gives home charging power and time to the limit', () => {
    expect(homeKw(32)).toBeCloseTo(6.9, 1);                 // 32 A x 240 V x 0.9
    expect(hoursToLimit(52.7, { chargeLimitPct: 80, chargeAmps: 32 }, 10)).toBeCloseTo((0.7 * 52.7) / 6.9, 1);
    expect(hoursToLimit(52.7, { chargeLimitPct: 80, chargeAmps: 32 }, 90)).toBe(0);
  });

  it('tire pressure reset keeps all four pressures; low means 25% under them or under the floor', () => {
    expect(tpmsReset(null)).toBeNull();
    expect(tpmsReset(tires(null))).toBeNull();                 // a tire with no reading: no reset
    const base = tpmsReset(tires(40, 40, 38, 38), new Date('2026-11-17T12:00:00Z'))!;
    expect(base).toEqual({ psi: { fl: 40, fr: 40, rl: 38, rr: 38 }, at: '2026-11-17T12:00:00.000Z' });
    expect(lowTires(tires(31, 40, 38, 38), null, 30)).toEqual([]);   // no reset: only the floor counts
    expect(lowTires(tires(29.9, 40, 38, 38), base, 25)).toEqual(['fl']); // 25% under 40 = 30
    expect(lowTires(tires(31, 40, 38, 38), base, 25)).toEqual([]);
    expect(lowTires(tires(22, 40, 38, 38), null, 30)).toEqual(['fl']);
  });

  it('battery health is inferred from charges that filled at least 20%, ignoring test-mode ones', () => {
    expect(batteryHealth([], 52.7)).toEqual({ pct: null, capacityKwh: null, sessions: 0 });
    const s = (kwh: number, a: number, b: number, simulated = false) => ({ kwh, startSoc: a, endSoc: b, simulated });
    // 52.7 kWh pack at 95%: 50.065 kWh usable; filling 20->80% takes 30.04 kWh in, / 0.9 at the wall
    const wall = (0.6 * 52.7 * 0.95) / 0.9;
    const r = batteryHealth([s(wall, 20, 80), s(wall, 20, 80), s(10, 50, 55), s(5, 10, 90, true)], 52.7);
    expect(r.sessions).toBe(2);
    expect(r.pct).toBeCloseTo(95, 0);
    expect(batteryHealth([s(100, 0, 100)], 52.7).pct).toBe(100); // never above 100
  });
});
