import { describe, expect, it } from 'vitest';
import { FamilyCars, summarize } from '../src/cars/familyCars.ts';

const now = Date.parse('2026-11-25T18:00:00Z');
const devices = [
  { id: 1, name: 'F150', status: 'online', lastUpdate: '2026-11-25T17:59:00Z' },
  { id: 2, name: 'Tucson', status: 'offline', lastUpdate: '2026-11-23T10:00:00Z' },
  { id: 3, name: 'Old', disabled: true },
];
const positions = [
  { id: 10, deviceId: 1, fixTime: '2026-11-25T17:59:00Z', latitude: 33.5, longitude: -112.1, speed: 26, attributes: { batt: '12.4', fuel: 61.4, coolant: 190, mil: true, dtcs: 'p0420, P0171', pending: 'P0300', ignition: true, totalDistance: 160934.4 } },
  { id: 20, deviceId: 2, fixTime: '2026-11-23T10:00:00Z', latitude: 33.4, longitude: -111.9, speed: 0, attributes: { batt: 11.8, ignition: false } },
];

describe('family cars', () => {
  it('summarizes each car from Traccar devices and positions', () => {
    const cars = summarize(devices, positions, now);
    expect(cars.map((c) => c.name)).toEqual(['Tucson', 'F150']); // most warnings first; disabled left out
    const f = cars.find((c) => c.name === 'F150')!;
    expect(f).toMatchObject({ speedMph: 30, moving: true, batteryV: 12.4, fuelPct: 61, coolantF: 190, checkEngine: true, odometerMi: 100 });
    expect(f.codes).toEqual([{ code: 'P0420', pending: false }, { code: 'P0171', pending: false }, { code: 'P0300', pending: true }]);
    expect(f.warnings).toEqual(['Check engine: P0420, P0171']);
    const t = cars.find((c) => c.name === 'Tucson')!;
    expect(t.warnings).toEqual(['Battery 11.8 V: may not start', 'No report for over a day']);
  });
  it('is not configured without a URL, user and password, and reports a refused login in words', async () => {
    expect((await new FamilyCars(() => ({ url: null, user: null })).report()).configured).toBe(false);
    const fake = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const r = await new FamilyCars(() => ({ url: 'http://x:3952', user: 'ta', password: 'p' }), fake).report();
    expect(r).toMatchObject({ configured: true, cars: [] });
    expect(r.error).toMatch(/refused the login/);
  });
});
