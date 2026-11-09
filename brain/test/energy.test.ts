// A trip's energy for review after the drive (drive/energy.ts).
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENERGY_MODEL, downsample, smoothAlt, tripEnergy, type EnergySample } from '../src/drive/energy.ts';
import { validateEnergyModel } from '../src/settings.ts';
import { parseGpsdLine } from '../src/gps.ts';

const T0 = Date.parse('2026-11-09T15:00:00Z');
const M_PER_DEG_LAT = 111_195;
/** A straight run north at `mph`, a sample every 2 s, height from `alt(i)`. */
function run(n: number, mph: number, alt: (i: number) => number | null = () => 300, extra: Partial<EnergySample> = {}): EnergySample[] {
  const step = (mph * 0.44704 * 2) / M_PER_DEG_LAT;
  return Array.from({ length: n }, (_, i) => ({ t: new Date(T0 + i * 2000).toISOString(), lat: 33.4 + i * step, lon: -111.9, altM: alt(i), speedMph: mph, powerKw: null, ...extra }));
}

describe('trip energy model', () => {
  it('a flat 60 mph mile costs rolling + air drag + the steady draw, with no regen', () => {
    const e = tripEnergy(run(31, 60)); // 60 s at 60 mph = 1 mile
    expect(e.source).toBe('model');
    expect(e.totals.miles).toBeCloseTo(1, 1);
    expect(e.totals.regenKwh).toBe(0);
    expect(e.totals.climbM).toBe(0);
    // rolling ≈ 1714 kg × 9.81 × 0.011 × 1609 m ≈ 0.083 kWh at the wheel; air ≈ 0.5 × 1.2 × 1.0 × 26.8² × 1609 ≈ 0.193 kWh
    expect(e.breakdown!.aero).toBeGreaterThan(e.breakdown!.rolling);
    expect(e.totals.whPerMi).toBeGreaterThan(250);
    expect(e.totals.whPerMi).toBeLessThan(400);
  });

  it('a climb costs and the way back down regenerates part of it', () => {
    const up = tripEnergy(run(61, 40, (i) => 300 + i * 1.5));       // ~90 m up
    const down = tripEnergy(run(61, 40, (i) => 390 - i * 1.5));
    const flat = tripEnergy(run(61, 40));
    expect(up.totals.climbM).toBeGreaterThan(70);
    expect(up.totals.netKwh).toBeGreaterThan(flat.totals.netKwh + 0.3);
    expect(down.totals.regenKwh).toBeGreaterThan(0);
    expect(down.totals.netKwh).toBeLessThan(flat.totals.netKwh);
    expect(down.totals.maxRegenKw).toBeGreaterThan(0);
    // what comes back is less than what the climb took
    expect(up.totals.netKwh - flat.totals.netKwh).toBeGreaterThan(flat.totals.netKwh - down.totals.netKwh);
  });

  it('load makes the same trip dearer', () => {
    const light = tripEnergy(run(61, 40, (i) => 300 + i), DEFAULT_ENERGY_MODEL, 0);
    const heavy = tripEnergy(run(61, 40, (i) => 300 + i), DEFAULT_ENERGY_MODEL, 1000);
    expect(heavy.massLb).toBe(light.massLb + 1000);
    expect(heavy.totals.netKwh).toBeGreaterThan(light.totals.netKwh);
  });

  it('uses the truck’s own pack power where it was sent, and says so', () => {
    const s = run(31, 60).map((p, i) => ({ ...p, powerKw: i < 15 ? 20 : -10 }));
    const e = tripEnergy(s);
    expect(e.source).toBe('measured');
    expect(e.breakdown).toBeNull();
    expect(e.totals.usedKwh).toBeCloseTo((20 * 28 + 5 * 2) / 3600, 2); // 14 steps at 20, one 20→-10 step at 5
    expect(e.totals.regenKwh).toBeCloseTo((10 * 30) / 3600, 2);
    expect(e.totals.maxRegenKw).toBe(10);
    const mixed = tripEnergy(run(31, 60).map((p, i) => ({ ...p, powerKw: i < 10 ? 15 : null })));
    expect(mixed.source).toBe('mixed');
  });

  it('splits driving from the dash’s tech and the switched accessories', () => {
    const e = tripEnergy(run(901, 30, () => 300, { techW: 37, accW: 120 })); // 30 minutes
    expect(e.totals.techKwh).toBeCloseTo((37 / 0.9) * 0.5 / 1000, 3);
    expect(e.totals.accessoryKwh).toBeCloseTo((120 / 0.9) * 0.5 / 1000, 3);
    expect(e.totals.driveKwh).toBeCloseTo(e.totals.netKwh - e.totals.techKwh - e.totals.accessoryKwh, 3);
    expect(e.breakdown!.tech).toBeCloseTo(e.totals.techKwh, 3);
    // measured: driving is what the pack gave less the estimated 12 V side
    const m = tripEnergy(run(901, 30, () => 300, { techW: 37, accW: 0, powerKw: 5 }));
    expect(m.totals.driveKwh).toBeCloseTo(m.totals.netKwh - m.totals.techKwh, 3);
  });

  it('spreads nothing across a gap, and needs two samples', () => {
    const a = run(10, 40), b = run(10, 40).map((p) => ({ ...p, t: new Date(Date.parse(p.t) + 600_000).toISOString() }));
    const gap = tripEnergy([...a, ...b]);
    expect(gap.totals.movingS).toBe(36);
    expect(tripEnergy(run(1, 40)).source).toBe('none');
  });

  it('smooths GPS height and keeps the screen series short', () => {
    const noisy = Array.from({ length: 31 }, (_, i) => ({ t: T0 + i * 2000, alt: 300 + (i % 2 ? 6 : -6) }));
    for (const v of smoothAlt(noisy).slice(8, 22)) expect(Math.abs(v! - 300)).toBeLessThan(1);
    expect(smoothAlt([{ t: T0, alt: null }])).toEqual([null]);
    const big = tripEnergy(run(3000, 50));
    expect(big.series.length).toBeLessThanOrEqual(800);
    expect(downsample([{ t: 'a', mi: 0, lat: 0, lon: 0, altM: null, speedMph: null, powerKw: 4, measured: true }, { t: 'b', mi: 1, lat: 0, lon: 0, altM: null, speedMph: null, powerKw: -2, measured: true }], 1)[0].powerKw).toBe(1);
  });

  it('model numbers: defaults fill gaps, nonsense is refused', () => {
    expect(validateEnergyModel(undefined)).toEqual(DEFAULT_ENERGY_MODEL);
    expect(validateEnergyModel({ cdA: 0.9 }).cdA).toBe(0.9);
    expect(() => validateEnergyModel({ crr: 2 })).toThrow();
  });

  it('reads height from gpsd only with a 3D fix', () => {
    expect(parseGpsdLine('{"class":"TPV","mode":3,"lat":33.4,"lon":-111.9,"altMSL":352.1,"alt":330}')!.altM).toBe(352.1);
    expect(parseGpsdLine('{"class":"TPV","mode":3,"lat":33.4,"lon":-111.9,"alt":330}')!.altM).toBe(330);
    expect(parseGpsdLine('{"class":"TPV","mode":2,"lat":33.4,"lon":-111.9,"alt":330}')!.altM).toBeNull();
  });
});

describe('measured 12 V power (INA226 on the truck box)', () => {
  it('reads relay and dash watts, refuses nonsense, and forgets them when the box goes offline', async () => {
    const { parseTruckbox, applyTruckbox, clearTruckbox } = await import('../src/truckbox.ts');
    expect(parseTruckbox('sensor/relay_4_w/state', '312.6')).toEqual({ relayW: { id: 'relay_4', w: 312.6 } });
    expect(parseTruckbox('sensor/dash_w/state', '21.04')).toEqual({ dashW: 21 });
    expect(parseTruckbox('sensor/relay_4_w/state', 'unavailable')).toEqual({ relayW: { id: 'relay_4', w: null } });
    expect(parseTruckbox('sensor/relay_4_w/state', '-3')).toEqual({ relayW: { id: 'relay_4', w: null } });
    expect(parseTruckbox('sensor/relay_9_w/state', '5')).toBeNull();
    const s = { relays: { relay_4: { name: 'Compressor', on: true, watts: 360, measuredW: null } }, dashW: null } as never as import('../src/types.ts').State;
    const tilt = { pitch: null, roll: null };
    applyTruckbox(s, { relayW: { id: 'relay_4', w: 312.6 } }, tilt);
    applyTruckbox(s, { dashW: 21 }, tilt);
    expect(s.relays.relay_4.measuredW).toBe(312.6);
    expect(s.dashW).toBe(21);
    clearTruckbox(Object.assign(s, { fiveSwitch: [] }), tilt);
    expect(s.relays.relay_4.measuredW).toBeNull();
    expect(s.dashW).toBeNull();
  });

  it('the trip split says how much of it was measured', () => {
    const half = run(31, 30).map((p, i) => ({ ...p, techW: 30, accW: 0, techMeas: i < 16, accMeas: false }));
    const e = tripEnergy(half);
    expect(e.totals.techMeasured).toBeCloseTo(0.5, 1);
    expect(e.totals.accessoryMeasured).toBe(0);
    expect(tripEnergy(run(31, 30).map((p) => ({ ...p, techMeas: true }))).totals.techMeasured).toBe(1);
  });
});
