import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cornerMph, mergeControl, roadMph, SimError, SimTruck, SIM_ROUTE, type SimControl } from '../src/sim.ts';
import { metersBetween } from '../src/geo.ts';
import type { GpsFix } from '../src/gps.ts';

const base: SimControl = { mode: 'auto', gear: 'park', ignition: false, targetMph: 35, loop: true, cabinF: null, auxV: null, lowTire: null, switches: [true, false, false, true, false] };

describe('test panel controls', () => {
  it('takes the wheel from the loop when anything but the mode changes', () => {
    expect(mergeControl(base, { targetMph: 50 }).mode).toBe('manual');
    expect(mergeControl({ ...base, mode: 'manual' }, { mode: 'auto' }).mode).toBe('auto');
  });
  it('switches the ignition on when put in gear', () => {
    expect(mergeControl(base, { gear: 'reverse' })).toMatchObject({ gear: 'reverse', ignition: true });
  });
  it('refuses nonsense', () => {
    expect(() => mergeControl(base, { targetMph: 200 })).toThrow(SimError);
    expect(() => mergeControl(base, { gear: 'neutral' as never })).toThrow(/gear/);
    expect(() => mergeControl(base, { switches: [true] })).toThrow(/five/);
    expect(() => mergeControl(base, { lowTire: 'spare' as never })).toThrow(/lowTire/);
    expect(mergeControl(base, { cabinF: 120 }).cabinF).toBe(120);
    expect(mergeControl({ ...base, cabinF: 120 }, { cabinF: null }).cabinF).toBeNull();
  });
});

describe('simulated truck, driven by hand', () => {
  let topics: Record<string, string>;
  let fixes: GpsFix[];
  let sim: SimTruck;
  beforeEach(() => {
    vi.useFakeTimers();
    topics = {}; fixes = [];
    sim = new SimTruck((sub, p) => { topics[sub] = p; }, (f) => fixes.push(f));
    sim.start();
  });
  afterEach(() => { sim.stop(); vi.useRealTimers(); });

  it('drives at the asked speed, reverses, and parks', () => {
    sim.control({ gear: 'drive', targetMph: 40 });
    vi.advanceTimersByTime(30_000);
    expect(topics['binary_sensor/ignition/state']).toBe('ON');
    expect(sim.status().speedMph).toBeGreaterThan(35);
    expect(fixes.at(-1)!.speedMph).toBeGreaterThan(35);
    sim.control({ gear: 'park' });
    vi.advanceTimersByTime(2000);
    expect(sim.status().speedMph).toBe(0);
    sim.control({ gear: 'reverse' });
    expect(topics['binary_sensor/reverse/state']).toBe('ON');
    sim.control({ gear: 'park', ignition: false });
    expect(topics['binary_sensor/reverse/state']).toBe('OFF');
    expect(topics['binary_sensor/ignition/state']).toBe('OFF');
  });

  it('stops at the end of a leg when told not to loop', () => {
    sim.control({ gear: 'drive', targetMph: 85, loop: false });
    vi.advanceTimersByTime(30 * 60_000);
    expect(sim.status()).toMatchObject({ arrived: true, speedMph: 0, leg: 0 });
    const end = SIM_ROUTE[0].at(-1)!;
    expect(metersBetween(sim.status().pos, end)).toBeLessThan(5);
  });

  it('a tow-away moves the truck past the alert radius with the ignition off', () => {
    const start = sim.status().pos;
    sim.tow(90);
    vi.advanceTimersByTime(95_000);
    expect(topics['binary_sensor/ignition/state']).toBe('OFF');
    expect(metersBetween(start, sim.status().pos)).toBeGreaterThan(200);
    expect(sim.status()).toMatchObject({ towing: false, speedMph: 0 });
  });

  it('moves to a leg only while stopped, and overrides sensors', () => {
    sim.control({ gear: 'drive', targetMph: 40 });
    vi.advanceTimersByTime(20_000);
    expect(() => sim.jump(1)).toThrow(/Stop first/);
    sim.control({ gear: 'park' });
    vi.advanceTimersByTime(1000);
    expect(sim.jump(1).pos).toEqual(SIM_ROUTE[1][0]);
    sim.control({ cabinF: 120, auxV: 11.8, lowTire: 'rr', switches: [false, false, false, false, true] });
    vi.advanceTimersByTime(1000);
    expect(topics['sensor/cabin_temp/state']).toBe('120.0');
    expect(topics['sensor/aux_battery_v/state']).toBe('11.80');
    expect(topics['sensor/tpms_rr_psi/state']).toBe('22.0');
    expect(topics['binary_sensor/five_switch_5/state']).toBe('ON');
    expect(topics['binary_sensor/five_switch_1/state']).toBe('OFF');
  });

  it('hands back to the loop', () => {
    sim.control({ gear: 'drive', targetMph: 30 });
    vi.advanceTimersByTime(10_000);
    expect(sim.control({ mode: 'auto' }).mode).toBe('auto');
  });

  it('plugs in parked, refuses while moving, and unplugs when put in gear', () => {
    sim.control({ gear: 'drive', targetMph: 40 });
    vi.advanceTimersByTime(20_000);
    expect(() => sim.plugIn('home', 80)).toThrow(/Stop first/);
    sim.control({ gear: 'park' });
    vi.advanceTimersByTime(2000);
    const st = sim.plugIn('fast', 90);
    expect(st.charging).toMatchObject({ kind: 'fast', kw: 150, targetPct: 90 });
    expect(st).toMatchObject({ gear: 'park', ignition: false, mode: 'manual' });
    expect(() => sim.plugIn('solar' as never)).toThrow(/kind/);
    expect(() => sim.plugIn('home', 0)).toThrow(/target/);
    sim.control({ gear: 'drive' });
    expect(sim.status().charging).toBeNull();
    sim.control({ gear: 'park' });
    vi.advanceTimersByTime(20_000);
    sim.plugIn('home');
    expect(sim.unplug().charging).toBeNull();
  });
});

describe('the loop on real roads', () => {
  it('follows the baked roads: dense points, each leg starting about where the last one ended', () => {
    expect(SIM_ROUTE).toHaveLength(3);
    for (const [i, leg] of SIM_ROUTE.entries()) {
      expect(leg.length).toBeGreaterThan(100);
      const prev = SIM_ROUTE[(i + 2) % 3].at(-1)!;
      expect(metersBetween(prev, leg[0])).toBeLessThan(150);
    }
    expect(roadMph(1, 0)).toBeGreaterThan(0);
    expect(Math.max(...SIM_ROUTE[1].map((_, k) => roadMph(1, k)))).toBeGreaterThanOrEqual(50); // the freeway leg
  });

  it('reads a right-angle turn as a slow corner and a straight road as none', () => {
    const P = (lat: number, lon: number) => ({ lat, lon });
    const ell = [P(33.40, -111.90), P(33.4005, -111.90), P(33.401, -111.90), P(33.401, -111.8994), P(33.401, -111.8988)];
    expect(cornerMph(ell)[2]).toBe(12);
    const straight = [P(33.40, -111.90), P(33.4005, -111.90), P(33.401, -111.90), P(33.4015, -111.90)];
    expect(cornerMph(straight).every((m) => m === Infinity)).toBe(true);
  });

  it('drives the freeway leg at freeway speed on its own', () => {
    vi.useFakeTimers();
    const fixes: GpsFix[] = [];
    const sim = new SimTruck(() => {}, (f) => fixes.push(f), 4);
    sim.start();
    sim.jump(1);
    vi.advanceTimersByTime(12 * 60_000); // 48 simulated minutes: parked, reverse, the whole leg
    sim.stop(); vi.useRealTimers();
    expect(Math.max(...fixes.map((f) => f.speedMph ?? 0))).toBeGreaterThan(50);
    expect(sim.status().leg).not.toBe(1); // arrived downtown and moved on
  });
});
