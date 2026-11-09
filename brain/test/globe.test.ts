import { describe, expect, it } from 'vitest';
import { globeAircraft, GLOBE_HEX } from '../src/globe.ts';

describe('globe feed', () => {
  const at = Date.UTC(2026, 10, 9, 18, 0, 0);
  it('draws the truck as one ground vehicle in dump1090 form', () => {
    const doc = globeAircraft({ gps: { lat: 33.45, lon: -112.07, headingDeg: 270, fix: true }, speedMph: 60 }, at, 'slate-1', 7);
    expect(doc).toMatchObject({ now: at / 1000, messages: 7 });
    expect(doc.aircraft).toEqual([{
      hex: GLOBE_HEX, flight: 'SLATE1  ', category: 'C2', alt_baro: 'ground',
      lat: 33.45, lon: -112.07, gs: 52.1, track: 270, seen: 0, seen_pos: 0, messages: 7,
    }]);
  });
  it('is empty without a fix, and leaves out a heading it does not have', () => {
    expect(globeAircraft({ gps: null, speedMph: null }, at, 'TRUCK', 1).aircraft).toEqual([]);
    expect(globeAircraft({ gps: { lat: 1, lon: 2, headingDeg: 0, fix: false }, speedMph: 0 }, at, 'TRUCK', 1).aircraft).toEqual([]);
    const [a] = globeAircraft({ gps: { lat: 1, lon: 2, headingDeg: null, fix: true }, speedMph: null }, at, 'TRUCK', 1).aircraft;
    expect(a).not.toHaveProperty('track');
    expect(a).toMatchObject({ gs: 0, flight: 'TRUCK   ' });
  });
  it('uses an address from the reserved block that God\'s Eye accepts', () => {
    expect(GLOBE_HEX).toMatch(/^[0-9a-f]{6}$/);
  });

  it('adds the airport pickup’s inbound plane beside the truck, under its own hex when known', async () => {
    const { PICKUP_HEX } = await import('../src/globe.ts');
    const at = Date.parse('2027-06-01T15:00:00Z');
    const truck = { gps: { lat: 33.45, lon: -112.07, headingDeg: 270, fix: true }, speedMph: 60 };
    const doc = globeAircraft(truck, at, 'slate-1', 3, { callsign: 'AAL1234', lat: 33.9, lon: -111.2, altFt: 12000, gsKt: 310, track: 250, hex: 'a4b5c6' });
    expect(doc.aircraft).toHaveLength(2);
    expect(doc.aircraft[0]).toMatchObject({ hex: 'a4b5c6', flight: 'AAL1234 ', alt_baro: 12000, gs: 310, track: 250 });
    const noHex = globeAircraft({ gps: null, speedMph: null }, at, 'slate-1', 3, { callsign: 'SWA2510', lat: 33.9, lon: -111.2, altFt: 'ground', gsKt: null, track: null, hex: null });
    expect(noHex.aircraft).toEqual([expect.objectContaining({ hex: PICKUP_HEX, alt_baro: 'ground' })]);
  });
});
