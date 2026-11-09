import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { routeGeoJson, tripBundle } from '../src/globe/scene.ts';

const route = Array.from({ length: 300 }, (_, i) => ({ lat: 33.45 + i * 0.006, lon: -112.07 + i * 0.001, elevM: 340 + i * 6 }));
const stops = [
  { id: 'start', name: 'Home', lat: route[0].lat, lon: route[0].lon, elevM: 340, kind: 'start' as const },
  { id: 'charge-1', name: 'Cordes Junction', lat: route[150].lat, lon: route[150].lon, elevM: 1240, kind: 'charge' as const, note: 'Arrive 20%, charge to 80%' },
  { id: 'end', name: 'Flagstaff', lat: route[299].lat, lon: route[299].lon, elevM: 2134, kind: 'end' as const },
];

describe("God's Eye scene bundle", () => {
  it('is a version-1 bundle holding a version-5 scene with one GeoJSON pack whose bytes match their hash', () => {
    const b = tripBundle({ title: 'Road trip to Flagstaff', route, stops, attribution: 'test', now: new Date('2027-01-01T00:00:00Z') });
    expect(b.format).toBe('gev-scene-bundle');
    expect(b.version).toBe(1);
    expect(b.project.version).toBe(5);
    const scene = b.project.scenes[0];
    expect(scene.id).toBe('road-trip-to-flagstaff');
    const pack = scene.dataPacks[0];
    expect(pack).toMatchObject({ id: 'route', version: 1, format: 'geojson', source: { adapter: 'scene-bundle', path: 'road-trip-to-flagstaff/route.geojson' }, placement: { altitudeReference: 'ellipsoid' } });
    const a = b.assets[0];
    const bytes = Buffer.from(a.base64, 'base64');
    expect(a.path).toBe(pack.source.path);
    expect(a.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(pack.sha256).toBe(a.sha256);
    expect(pack.byteLength).toBe(bytes.length);
    expect(JSON.parse(bytes.toString('utf8')).type).toBe('FeatureCollection');
  });

  it('has an overview shot then one at each stop, all inside the camera limits', () => {
    const shots = tripBundle({ title: 'T', route, stops, attribution: 'x' }).project.scenes[0].shots as { id: string; camera: { lat: number; lon: number; alt: number; heading: number; pitch: number }; dataPackIds: string[] }[];
    expect(shots.map((s) => s.id)).toEqual(['overview', 'stop-0', 'stop-1', 'stop-2']);
    for (const s of shots) {
      expect(Math.abs(s.camera.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.camera.pitch)).toBeLessThanOrEqual(90);
      expect(s.camera.alt).toBeGreaterThan(0);
      expect(s.dataPackIds).toEqual(['route']);
    }
    // A stop's camera stands back from the stop, above its ground height.
    expect(shots[2].camera.alt).toBe(1240 + 1500);
  });

  it('flies along a driven trip instead', () => {
    const shots = tripBundle({ title: 'Trip', route, stops: [stops[0], stops[2]], attribution: 'x', flyAlong: true }).project.scenes[0].shots;
    expect(shots[0].id).toBe('overview');
    expect(shots.length).toBeGreaterThanOrEqual(5);
    expect(shots.at(-1)!.title).toBe('Arrive');
  });

  it('keeps the GeoJSON inside the pack limits, with unique string ids and heights', () => {
    const big = Array.from({ length: 20000 }, (_, i) => ({ lat: 33 + i * 1e-4, lon: -112, elevM: null }));
    const g = routeGeoJson(big, stops, 'x');
    const line = g.features[0].geometry.coordinates as number[][];
    expect(line.length).toBeLessThanOrEqual(5000);
    expect(line[0]).toHaveLength(3);
    const ids = g.features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((x) => typeof x === 'string')).toBe(true);
  });
});
