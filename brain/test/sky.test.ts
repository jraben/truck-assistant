import { describe, expect, it } from 'vitest';
import { issPasses, nearestAircraft, parseTle } from '../src/sky/sky.ts';

// The ISS orbit as CelesTrak published it on 2026-11-08 (epoch day 312).
const TLE = `ISS (ZARYA)
1 25544U 98067A   26312.17541007  .00012511  00000+0  23266-3 0  9990
2 25544  51.6320 307.5621 0007219   1.6306 358.4705 15.49256954594075`;

describe('ISS passes', () => {
  it('reads the two element lines', () => {
    expect(parseTle(TLE)?.[0]).toMatch(/^1 25544U/);
    expect(parseTle('nothing')).toBeNull();
  });

  it('finds passes over Phoenix and marks the evening ones visible', () => {
    const passes = issPasses(parseTle(TLE)!, 33.45, -112.07, new Date('2026-11-09T08:00:00Z'), 24);
    expect(passes.length).toBeGreaterThanOrEqual(3);
    for (const p of passes) {
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(Date.parse(p.end)).toBeGreaterThanOrEqual(Date.parse(p.start));
    }
    // A visible pass happens with the sky dark at the truck: after sunset in Phoenix (about 00:30 UTC).
    const visible = passes.filter((p) => p.visible);
    expect(visible.length).toBeGreaterThanOrEqual(1);
    for (const p of visible) { const h = new Date(p.peak).getUTCHours(); expect(h >= 0 && h < 13).toBe(true); }
  });
});

describe('the plane overhead', () => {
  it('picks the nearest airborne aircraft and says where it is', () => {
    const n = nearestAircraft({ ac: [
      { flight: 'SWA123 ', t: 'B38M', r: 'N8701Q', lat: 33.60, lon: -112.07, alt_baro: 9000 },
      { flight: 'AAL1  ', t: 'A321', r: 'N100', lat: 33.46, lon: -112.05, alt_baro: 3000 },
      { flight: 'TAXI1', lat: 33.451, lon: -112.07, alt_baro: 'ground' },
    ] }, { lat: 33.45, lon: -112.07 })!;
    expect(n).toMatchObject({ callsign: 'AAL1', type: 'A321', altFt: 3000, bearing: 'NE' });
    expect(n.distMi).toBeLessThan(2);
    expect(nearestAircraft({ ac: [] }, { lat: 0, lon: 0 })).toBeNull();
  });
});
