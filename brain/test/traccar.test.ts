import { describe, expect, it } from 'vitest';
import { traccarInterval, traccarUrl, TRACCAR_MOVING_S, TRACCAR_PARKED_S } from '../src/traccar.ts';

describe('traccar feed', () => {
  const at = Date.UTC(2026, 10, 12, 18, 0, 0);
  const base = { gps: { lat: 33.45, lon: -112.07, headingDeg: 270.4, fix: true }, speedMph: 60, soc: 81.6, rangeMi: 190.2, ignition: true, aux12v: 13.4 };

  it('builds an OsmAnd request with the extras as attributes', () => {
    const u = new URL(traccarUrl('http://192.168.1.219:5056/', 'slate', base, at)!);
    expect(u.origin).toBe('http://192.168.1.219:5056');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      id: 'slate', timestamp: String(at / 1000), lat: '33.45', lon: '-112.07',
      speed: '52.1', bearing: '270', batteryLevel: '82', rangeMi: '190', ignition: 'true', aux12v: '13.4',
    });
  });

  it('sends nothing without a fix, and leaves out what it does not know', () => {
    expect(traccarUrl('http://x:5056', 'slate', { ...base, gps: null }, at)).toBeNull();
    expect(traccarUrl('http://x:5056', 'slate', { ...base, gps: { ...base.gps, fix: false } }, at)).toBeNull();
    const u = new URL(traccarUrl('http://x:5056', 'slate', { ...base, speedMph: null, soc: null, rangeMi: null, ignition: null, aux12v: null, gps: { ...base.gps, headingDeg: null } }, at)!);
    expect([...u.searchParams.keys()]).toEqual(['id', 'timestamp', 'lat', 'lon']);
  });

  it('reports often while on or moving, rarely while parked', () => {
    expect(traccarInterval({ ignition: true, speedMph: 0 })).toBe(TRACCAR_MOVING_S);
    expect(traccarInterval({ ignition: null, speedMph: 30 })).toBe(TRACCAR_MOVING_S);
    expect(traccarInterval({ ignition: false, speedMph: 0 })).toBe(TRACCAR_PARKED_S);
  });
});
