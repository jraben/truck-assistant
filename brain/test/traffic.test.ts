import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { defaultSettings, maskSettings, mergeSettings } from '../src/settings.ts';
import { fetchEvents, parseCameras, parseEvents } from '../src/traffic/feed.ts';
import { ahead, bearing } from '../src/traffic/ahead.ts';
import { enforcementQuery, parseEnforcement } from '../src/traffic/enforcement.ts';
import { statesAt, STATES_511 } from '../src/traffic/states.ts';
import { TrafficService } from '../src/traffic/service.ts';
import { withMiles, type Route } from '../src/roadtrip/route.ts';
import { az511Answer } from '../src/demo/backend.ts';
import type { Settings } from '../src/types.ts';

// Shaped like the AZ511 /api/v2/get/cameras sample (2026-11-08).
const CAMS = [
  { Id: 960, Source: 'ADOT', SourceId: '960', Roadway: 'SR-95', Direction: 'Unknown', Latitude: 35.1, Longitude: -114.6, Location: 'SR-95 NB 249.80 @SR68', SortOrder: 1,
    Views: [{ Id: 960, Url: 'https://az511.com/map/Cctv/960', Status: 'Enabled', Description: 'SR-95 NB 249.80 @SR68 Laughlin Rd' }] },
  { Id: 961, Roadway: 'I-10', Latitude: 33.4, Longitude: -112.0, Views: [{ Id: 961, Url: 'https://az511.com/map/Cctv/961', Status: 'Disabled' }] },
  { Id: 962, Roadway: 'I-17', Latitude: 0, Longitude: 0, Views: [{ Url: 'x' }] },
];

describe('511 feeds', () => {
  it('reads cameras, skipping disabled views and missing positions', () => {
    const c = parseCameras(CAMS, 'az');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'az:960', roadway: 'SR-95', lat: 35.1, views: [{ url: 'https://az511.com/map/Cctv/960' }] });
    expect(parseCameras({ error: 'x' }, 'az')).toEqual([]);
  });

  it('reads events and sorts them into crash, closure, roadwork', () => {
    const e = parseEvents([
      { ID: 1, RoadwayName: 'I-10', DirectionOfTravel: 'Westbound', EventType: 'accidentsAndIncidents', Latitude: 33.4, Longitude: -112, StartDate: 1_800_000_000, IsFullClosure: false },
      { ID: 2, EventType: 'closures', Latitude: 33.5, Longitude: -112, IsFullClosure: true },
      { ID: 3, EventType: 'roadwork', Latitude: 33.6, Longitude: -112 },
    ], 'az');
    expect(e.map((x) => x.type)).toEqual(['crash', 'closure', 'roadwork']);
    expect(e[0].startsAt).toBe(new Date(1_800_000_000_000).toISOString());
    expect(e[1].fullClosure).toBe(true);
  });

  it('knows which states cover a point', () => {
    expect(statesAt(33.45, -112.07).map((s) => s.id)).toEqual(['az']);
    expect(statesAt(43.07, -89.4).map((s) => s.id)).toContain('wi');
    expect(STATES_511.filter((s) => s.checked).map((s) => s.id)).toEqual(['az', 'wi']);
  });

  it('reads a 400 "Invalid Key" as a refused key, any other 400 as itself', async () => {
    const az = STATES_511.find((s) => s.id === 'az')!;
    const answer = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
    await expect(fetchEvents(az, 'x', answer(400, '<Error><Message>Invalid Key</Message></Error>'))).rejects.toThrow(/refused the developer key/);
    await expect(fetchEvents(az, 'x', answer(400, 'bad request'))).rejects.toThrow(/answered 400/);
  });
});

describe('what is ahead', () => {
  const pts = (n: number) => Array.from({ length: n + 1 }, (_, i) => ({ lat: 33 + i / 69, lon: -112 }));   // due north, a mile a step
  const route: Route = { points: withMiles(pts(60)), miles: 60, minutes: 60, source: 'osrm', elevation: false };
  const items = [{ id: 'behind', lat: 33 - 5 / 69, lon: -112 }, { id: 'ahead10', lat: 33 + 10 / 69, lon: -112 }, { id: 'side', lat: 33 + 10 / 69, lon: -112 + 8 / 58 }, { id: 'far', lat: 33 + 50 / 69, lon: -112 }];

  it('follows the trip route', () => {
    const r = ahead(items, { here: { lat: 33, lon: -112 }, heading: 0, route: { route, mi: 0 }, maxMi: 40, offMi: 0.6 });
    expect(r.map((x) => x.id)).toEqual(['ahead10']);
    expect(r[0]).toMatchObject({ distMi: 10, onRoute: true });
  });

  it('uses the heading without a route, and anything near when parked', () => {
    expect(ahead(items, { here: { lat: 33, lon: -112 }, heading: 0, route: null, maxMi: 25, offMi: 0.6 }).map((x) => x.id)).toEqual(['ahead10']);
    expect(ahead(items, { here: { lat: 33, lon: -112 }, heading: 180, route: null, maxMi: 25, offMi: 0.6 }).map((x) => x.id)).toEqual(['behind']);
    expect(ahead(items, { here: { lat: 33, lon: -112 }, heading: null, route: null, maxMi: 25, offMi: 0.6, nearMi: 6 }).map((x) => x.id)).toEqual(['behind']);
    expect(Math.round(bearing({ lat: 33, lon: -112 }, { lat: 34, lon: -112 }))).toBe(0);
  });
});

describe('enforcement cameras (OpenStreetMap)', () => {
  it('asks for speed cameras and enforcement relations around a point', () => {
    expect(enforcementQuery(33.45, -112.07, 30000)).toMatch(/highway"="speed_camera"\]\(around:30000,33\.4500,-112\.0700\)/);
  });
  it('reads nodes and relation centres', () => {
    const c = parseEnforcement({ elements: [
      { type: 'node', id: 1, lat: 33.5, lon: -112, tags: { highway: 'speed_camera', maxspeed: '45 mph' } },
      { type: 'relation', id: 2, center: { lat: 33.6, lon: -112.1 }, tags: { type: 'enforcement', enforcement: 'traffic_signals' } },
      { type: 'node', id: 3, tags: {} },
    ] });
    expect(c).toEqual([
      { key: 'osm:node/1', kind: 'speed', lat: 33.5, lon: -112, maxspeed: '45 mph', name: null },
      { key: 'osm:relation/2', kind: 'red-light', lat: 33.6, lon: -112.1, maxspeed: null, name: null },
    ]);
  });
});

describe('511 keys in settings', () => {
  it('stores one per state, masks them, and ignores unknown states', () => {
    let s = mergeSettings(defaultSettings(), { keys: { traffic511: { az: 'az-secret-key-9999', zz: 'nope' } } });
    expect(s.keys.traffic511).toEqual({ az: 'az-secret-key-9999' });
    const m = maskSettings(s).keys.traffic511!.az;
    expect(m).toMatch(/9999$/);
    expect(m).not.toContain('secret');
    s = mergeSettings(s, { keys: { traffic511: { az: m, wi: 'wi-key' } } });
    expect(s.keys.traffic511).toEqual({ az: 'az-secret-key-9999', wi: 'wi-key' });
    s = mergeSettings(s, { keys: { afdc: 'x' } });
    expect(s.keys.traffic511?.az).toBe('az-secret-key-9999');
    s = mergeSettings(s, { keys: { traffic511: { az: '', wi: '' } } });
    expect(s.keys.traffic511).toBeUndefined();
  });
});

describe('traffic service', () => {
  function setup(opts: { key?: boolean; speed?: number; heading?: number | null; at?: { lat: number; lon: number } } = {}) {
    const calls: string[] = [];
    const settings: Settings = { ...defaultSettings(), keys: opts.key === false ? {} : { traffic511: { az: 'k' } } };
    const fetchFn = (async (u: string | URL) => {
      const url = new URL(String(u));
      if (url.hostname === 'az511.com') { calls.push(url.pathname); return az511Answer(url); }
      calls.push('overpass');
      return new Response(JSON.stringify({ elements: [{ type: 'node', id: 9, lat: 33.4440, lon: -111.9930, tags: { highway: 'speed_camera' } }] }));
    }) as typeof fetch;
    const svc = new TrafficService({
      db: openDb(mkdtempSync(path.join(tmpdir(), 'tf-'))), settings: () => settings,
      gps: () => opts.at ?? { lat: 33.4400, lon: -112.0000 }, heading: () => opts.heading === undefined ? 270 : opts.heading,
      speedMph: () => opts.speed ?? 50, online: () => true, route: () => null, fetchFn,
    });
    return { svc, calls };
  }

  it('fetches cameras first, then events on a later tick (one call per site per tick)', async () => {
    const { svc, calls } = setup();
    const t0 = Date.now();
    await svc.tick(t0);
    expect(calls.filter((c) => c !== 'overpass')).toEqual(['/api/v2/get/cameras']);
    await svc.tick(t0 + 1000);                  // too soon for that site
    expect(calls.filter((c) => c !== 'overpass')).toHaveLength(1);
    await svc.tick(t0 + 10_000);
    expect(calls.filter((c) => c !== 'overpass')).toEqual(['/api/v2/get/cameras', '/api/v2/get/event']);
    expect(calls.filter((c) => c === 'overpass')).toHaveLength(1);   // cached for the cell after that
  });

  it('shows cameras and a crash ahead heading west on I-10, and says so in the banner', async () => {
    const { svc } = setup();
    const t0 = Date.now();
    await svc.tick(t0); await svc.tick(t0 + 10_000);
    const v = svc.view();
    expect(v.following).toBe('heading');
    expect(v.cameras.map((c) => c.location)).toEqual(expect.arrayContaining(['I-10 WB @ 24th St', 'I-10 WB @ 7th St']));
    expect(v.cameras.every((c) => c.distMi <= 25)).toBe(true);
    expect(v.events.map((e) => e.type)).toContain('crash');
    expect(svc.brief(v)).toMatchObject({ kind: 'crash' });
    expect(svc.brief(v)!.text).toMatch(/Crash ahead on I-10 Westbound/);
  });

  it('warns about an enforcement camera just ahead, before a crash farther on', async () => {
    const { svc } = setup({ at: { lat: 33.4440, lon: -111.9800 }, heading: 270 });
    const t0 = Date.now();
    await svc.tick(t0); await svc.tick(t0 + 10_000);
    expect(svc.brief()).toMatchObject({ kind: 'camera' });
  });

  it('asks for a key instead of guessing', async () => {
    const { svc, calls } = setup({ key: false });
    await svc.tick();
    expect(calls.filter((c) => c !== 'overpass')).toEqual([]);
    expect(svc.view().message).toMatch(/Arizona \(AZ511\) developer key/);
  });
});
