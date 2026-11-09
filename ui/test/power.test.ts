import { describe, expect, it } from 'vitest';
import { powerSummary } from '../src/lib/power.ts';

const relays = {
  relay_1: { name: 'Bed lights', on: true, watts: 36, measuredW: null },
  relay_2: { name: 'Light bar', on: false, watts: 120, measuredW: null },
  relay_5: { name: 'Bed fridge', on: true, watts: 45, measuredW: null },
  relay_6: { name: 'Inverter', on: null, watts: 60, measuredW: null },
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
  it('a measured circuit wins over its rated watts, and the dash feed is added when measured', () => {
    const m = { ...relays, relay_5: { ...relays.relay_5, measuredW: 38.4 }, relay_2: { ...relays.relay_2, measuredW: 0 } };
    const p = powerSummary(m, { level: 80, charging: true }, 12, 21);
    expect(p.byRelay.relay_5).toBe(38.4);
    expect(p.measured).toMatchObject({ relay_5: true, relay_2: true, relay_1: false });
    expect(p.total).toBe(Math.round(36 + 38.4 + 12 + 21));
    expect(p.allMeasured).toBe(false); // relay 1 is on with no sensor
    const all = { relay_5: { ...relays.relay_5, measuredW: 40 } };
    expect(powerSummary(all, { level: 80, charging: false }, 12).allMeasured).toBe(true);
  });
});
