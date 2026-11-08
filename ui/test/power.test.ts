import { describe, expect, it } from 'vitest';
import { powerSummary } from '../src/lib/power.ts';

const relays = {
  relay_1: { name: 'Bed lights', on: true, watts: 36 },
  relay_2: { name: 'Light bar', on: false, watts: 120 },
  relay_5: { name: 'Bed fridge', on: true, watts: 45 },
  relay_6: { name: 'Inverter', on: null, watts: 60 },
};

describe('Control screen power (estimate)', () => {
  it('counts each load only while it is on', () => {
    const p = powerSummary(relays, { level: 80, charging: true }, 12);
    expect(p.byRelay).toEqual({ relay_1: 36, relay_2: 0, relay_5: 45, relay_6: 0 });
    expect(p.total).toBe(36 + 45 + 12);
    expect(p.amps).toBe(7.8);
  });
  it('a tablet on its own battery draws nothing from the truck', () => {
    expect(powerSummary(relays, { level: 80, charging: false }, 12).tablet).toBe(0);
  });
  it('a tablet that will not say is counted, so the total is not low', () => {
    expect(powerSummary({}, { level: null, charging: null }, 12).total).toBe(12);
  });
});
