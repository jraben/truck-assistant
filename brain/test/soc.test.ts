import { describe, expect, it } from 'vitest';
import { rangeMi, SocModel, socAfterMiles, type SocChange } from '../src/soc.ts';

describe('SoC estimate', () => {
  it('decays by miles / efficiency / pack', () => {
    // 35 mi at 3.5 mi/kWh = 10 kWh = 10% of a 100 kWh pack.
    expect(socAfterMiles(80, 35, 3.5, 100)).toBeCloseTo(70, 6);
    expect(socAfterMiles(80, 0, 3.5, 100)).toBe(80);
  });

  it('never goes below 0', () => {
    expect(socAfterMiles(5, 1000, 3.5, 52.7)).toBe(0);
  });

  it('range = soc% x packKwh x efficiency, null stays null', () => {
    expect(rangeMi(50, 52.7, 3.5)).toBeCloseTo(92.225, 3);
    expect(rangeMi(null, 52.7, 3.5)).toBeNull();
  });

  it('starts unknown and does not invent a value from miles', () => {
    const m = new SocModel();
    m.addMiles(10, 3.5, 52.7);
    expect(m.value).toBeNull();
    expect(m.source).toBeNull();
  });

  it('manual anchor, then estimate as miles accrue, then manual again', () => {
    const changes: SocChange[] = [];
    const m = new SocModel(undefined, (c) => changes.push(c));
    m.setManual(80);
    expect(m.source).toBe('manual');
    m.addMiles(3.5 * 5.27, 3.5, 52.7); // 5.27 kWh = 10%
    expect(m.value).toBeCloseTo(70, 6);
    expect(m.source).toBe('estimate');
    m.setManual(90);
    expect(m.source).toBe('manual');
    expect(changes.map((c) => [c.prev, c.next])).toEqual([[null, 80], [70, 90]]);
  });

  it('a CAN reading is not overridden by the model', () => {
    const m = new SocModel();
    m.setCan(64);
    m.addMiles(20, 3.5, 52.7);
    expect(m.value).toBe(64);
    expect(m.source).toBe('can');
  });

  it('a value carried over a restart is an estimate, not a fresh manual reading', () => {
    const m = new SocModel({ value: 55, source: 'manual', updatedAt: '2027-01-01T00:00:00Z' });
    expect(m.value).toBe(55);
    expect(m.source).toBe('estimate');
    expect(new SocModel({ value: null, source: null, updatedAt: null }).value).toBeNull();
  });

  it('clamps manual values to 0..100', () => {
    const m = new SocModel();
    m.setManual(140);
    expect(m.value).toBe(100);
  });
});
