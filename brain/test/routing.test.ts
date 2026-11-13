import { describe, expect, it } from 'vitest';
import { fetchRoute, graphhopperBody, parseGhInfo, parseGraphhopper } from '../src/roadtrip/route.ts';
import { defaultRouting, mergeRouting } from '../src/roadtrip/routing.ts';

const A = { lat: 33.44, lon: -112.05 }, B = { lat: 33.55, lon: -111.94 };

describe('local GraphHopper routing', () => {
  it('asks for one car route as GeoJSON, with elevation only when the graph has it', () => {
    expect(graphhopperBody(A, B, { elevation: false })).toEqual({ points: [[-112.05, 33.44], [-111.94, 33.55]], profile: 'car', points_encoded: false, instructions: false, calc_points: true, elevation: false });
  });
  it('towing caps the speed with a custom model (km/h) and turns off CH', () => {
    const b = graphhopperBody(A, B, { elevation: true, towMph: 55 });
    expect(b.custom_model).toEqual({ speed: [{ if: 'true', limit_to: '89' }] });
    expect(b['ch.disable']).toBe(true);
  });
  it('reads a /route answer and its errors', () => {
    expect(parseGraphhopper({ paths: [{ distance: 15930, time: 612000, points: { coordinates: [[-112.05, 33.44], [-111.94, 33.55, 400]] } }] })).toEqual({ meters: 15930, ms: 612000, coords: [[-112.05, 33.44], [-111.94, 33.55, 400]] });
    expect(parseGraphhopper({ message: 'Point 1 is out of bounds' })).toBe('Point 1 is out of bounds');
    expect(parseGraphhopper({ paths: [] })).toBe('no route');
  });
  it('reads /info as GraphHopper 10.2 answers it', () => {
    expect(parseGhInfo({ bbox: [-112.05, 33.44, -111.94, 33.55], profiles: [{ name: 'car' }], version: '10.2', elevation: false, data_date: '' }))
      .toEqual({ bbox: [-112.05, 33.44, -111.94, 33.55], profiles: ['car'], elevation: false, dataDate: null, version: '10.2' });
    expect(parseGhInfo({ data_date: '2026-11-12T21:00:00Z', elevation: true }).dataDate).toBe('2026-11-12T21:00:00Z');
  });
  it('goes local, then OSRM, then a straight line, and takes elevation from the graph', async () => {
    const calls: string[] = [];
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    const f = (async (url: string | URL) => {
      const u = String(url); calls.push(u.replace(/\?.*/, ''));
      if (u.endsWith('/info')) return ok({ bbox: [-113, 33, -111, 34], profiles: [{ name: 'car' }], elevation: true });
      if (u.endsWith('/route')) return ok({ paths: [{ distance: 16093.44, time: 600000, points: { coordinates: [[-112.05, 33.44, 330], [-111.94, 33.55, 420]] } }] });
      throw new Error('should not reach OSRM');
    }) as typeof fetch;
    const r = await fetchRoute(A, B, { graphhopper: 'http://gh:8989/', fetchFn: f });
    expect(r).toMatchObject({ source: 'graphhopper', elevation: true, minutes: 10 });
    expect(r.miles).toBeCloseTo(10, 5);
    expect(r.points.map((p) => p.elevM)).toEqual([330, 420]);
    expect(calls).toEqual(['http://gh:8989/info', 'http://gh:8989/route']);

    const down = (async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith('http://gh')) throw new Error('fetch failed');
      return ok({ code: 'Ok', routes: [{ distance: 20000, duration: 900, geometry: { coordinates: [[-112.05, 33.44], [-111.94, 33.55]] } }] });
    }) as typeof fetch;
    expect((await fetchRoute(A, B, { graphhopper: 'http://gh2:8989', fetchFn: down })).source).toBe('osrm');
    expect((await fetchRoute(A, B, { graphhopper: 'http://gh3:8989', publicOsrm: false, fetchFn: down })).source).toBe('straight');
  });
});

describe('route-planning settings', () => {
  it('defaults: GRAPHHOPPER_URL if set, public OSRM allowed, 65 mph towing', () => {
    expect(defaultRouting(undefined)).toEqual({ graphhopperUrl: null, publicOsrm: true, towMph: 65 });
    expect(defaultRouting(' http://localhost:8989 ').graphhopperUrl).toBe('http://localhost:8989');
  });
  it('checks what Settings sends', () => {
    const d = defaultRouting(undefined);
    expect(mergeRouting(d, { graphhopperUrl: 'http://localhost:8989/' }).graphhopperUrl).toBe('http://localhost:8989');
    expect(mergeRouting({ ...d, graphhopperUrl: 'http://x' }, { graphhopperUrl: '' }).graphhopperUrl).toBeNull();
    expect(() => mergeRouting(d, { graphhopperUrl: 'ftp://x' })).toThrow(/http/);
    expect(() => mergeRouting(d, { graphhopperUrl: 'not a url' })).toThrow(/URL/);
    expect(() => mergeRouting(d, { towMph: 20 })).toThrow(/35 to 80/);
    expect(mergeRouting(d, { towMph: 57.6, publicOsrm: false })).toMatchObject({ towMph: 58, publicOsrm: false });
  });
});
