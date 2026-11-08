import { describe, expect, it } from 'vitest';
import { inverterReadout, isInverter } from '../src/lib/inverter.ts';
import { fitLevel } from '../src/lib/stripFit.ts';

describe('inverter tile', () => {
  it('finds the inverter relay by name, whatever the driver called it', () => {
    expect(isInverter('Inverter')).toBe(true);
    expect(isInverter('120V inverter')).toBe(true);
    expect(isInverter('Bed fridge')).toBe(false);
    expect(isInverter(null)).toBe(false);
  });
  it('reads the truck battery, rounded, and flags it low at 20%', () => {
    expect(inverterReadout({ soc: 79.4, rangeMi: 166.2, aux12v: 13.78 })).toEqual({ soc: 79, rangeMi: 166, volts: 13.8, low: false });
    expect(inverterReadout({ soc: 20, rangeMi: 40, aux12v: null }).low).toBe(true);
  });
  it('shows nothing it does not know', () => {
    expect(inverterReadout(null)).toEqual({ soc: null, rangeMi: null, volts: null, low: false });
  });
});

describe('top strip fit', () => {
  it('stops at the first level that fits', () => {
    expect(fitLevel((l) => l < 2)).toBe(2);
    expect(fitLevel(() => false)).toBe(0);
  });
  it('gives up at the last level when nothing fits', () => {
    expect(fitLevel(() => true, 6)).toBe(6);
  });
});
