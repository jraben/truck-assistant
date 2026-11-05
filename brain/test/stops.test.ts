import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { STOP_MIN_MS, StopDetector, type StopEvent, type StopSample } from '../src/stops/detector.ts';
import { segment } from '../src/stops/segment.ts';
import { nearestArea, parseFeed, resolveName } from '../src/places/naming.ts';
import { cacheKey, Geocoder, nameFromNominatim } from '../src/places/geocode.ts';
import { openDb } from '../src/db.ts';
import { HaClient } from '../src/ha/client.ts';
import { StopService } from '../src/stops/service.ts';
import { defaultSettings } from '../src/settings.ts';

const HOME = { lat: 33.4990, lon: -111.9800 };
/** Move `m` metres north of p. */
const north = (p: { lat: number; lon: number }, m: number) => ({ lat: p.lat + m / 111_320, lon: p.lon });

function feed(det: StopDetector, samples: StopSample[]) {
  const out: (StopEvent & { i: number })[] = [];
  samples.forEach((s, i) => { for (const e of det.update(s)) out.push({ ...e, i }); });
  return out;
}
/** One sample a second for `secs`, from t0, at pos(t) with speed(t). */
const run = (t0: number, secs: number, pos: (s: number) => { lat: number; lon: number }, speed: (s: number) => number | null, ignition: boolean | null = true): StopSample[] =>
  Array.from({ length: secs }, (_, s) => ({ t: t0 + s * 1000, ...pos(s), speedMph: speed(s), ignition }));

describe('StopDetector', () => {
  it('a 3-minute dwell within 75 m is a stop, backdated to when it slowed', () => {
    const d = new StopDetector();
    const ev = feed(d, [
      ...run(0, 60, (s) => north(HOME, -1000 + s * 15), () => 30),           // driving in
      ...run(60_000, 200, (s) => north(HOME, (s % 7) * 3), () => 0.5),     // parked with jitter
      ...run(260_000, 30, (s) => north(HOME, 20 + s * 12), () => 25),       // drives off
    ]);
    expect(ev.map((e) => e.type)).toEqual(['arrive', 'depart']);
    expect(ev[0]).toMatchObject({ type: 'arrive', at: 60_000, reason: 'dwell' });
    expect(ev[0].i).toBe(60 + 180); // confirmed after 3 minutes
    expect(ev[1]).toMatchObject({ type: 'depart', short: false });
    expect((ev[1] as { at: number }).at).toBeGreaterThan(260_000);
  });

  it('a red light (under 3 minutes) is not a stop', () => {
    const d = new StopDetector();
    const ev = feed(d, [
      ...run(0, 30, (s) => north(HOME, s * 15), () => 30),
      ...run(30_000, 150, () => north(HOME, 450), () => 0),
      ...run(180_000, 30, (s) => north(HOME, 450 + s * 15), () => 30),
    ]);
    expect(ev).toEqual([]);
  });

  it('crawling in traffic (over 2 mph) inside 75 m does not count', () => {
    const d = new StopDetector();
    expect(feed(d, run(0, 240, (s) => north(HOME, s * 0.3), () => 3))).toEqual([]);
  });

  it('ignition off is a stop at once; leaving within 3 minutes marks it short (folded)', () => {
    const d = new StopDetector();
    const ev = feed(d, [
      ...run(0, 20, (s) => north(HOME, s * 10), () => 20),
      ...run(20_000, 10, () => north(HOME, 200), () => 0),                  // stopped
      ...run(30_000, 60, () => north(HOME, 200), () => 0, false),          // ignition off a minute
      ...run(90_000, 30, (s) => north(HOME, 200 + s * 10), () => 20, true),
    ]);
    expect(ev.map((e) => e.type)).toEqual(['arrive', 'depart']);
    expect(ev[0]).toMatchObject({ reason: 'ignition', at: 20_000 }); // backdated to when it stopped
    expect(ev[1]).toMatchObject({ short: true });
  });

  it('a long ignition-off stop is not short', () => {
    const d = new StopDetector();
    const ev = feed(d, [
      ...run(0, 5, () => HOME, () => 0, false),
      ...run(5000, 5, () => HOME, () => 0, false),
      { t: 10 * 60_000, ...north(HOME, 300), speedMph: 20, ignition: true },
    ]);
    expect(ev[1]).toMatchObject({ type: 'depart', short: false });
  });

  it('sparse phone points: one point in the evening, the next far away in the morning, is an overnight stop', () => {
    const d = new StopDetector();
    const t0 = Date.parse('2026-11-03T01:00:00Z');
    const ev = feed(d, [
      { t: t0, ...HOME, speedMph: null },
      { t: t0 + 13 * 3600_000, ...north(HOME, 2000), speedMph: null },
    ]);
    expect(ev.map((e) => e.type)).toEqual(['arrive', 'depart']);
    expect(ev[0].at).toBe(t0);
    // left ~2.5 minutes before the next point (2 km at 30 mph)
    expect(t0 + 13 * 3600_000 - ev[1].at).toBeGreaterThan(140_000);
    expect(t0 + 13 * 3600_000 - ev[1].at).toBeLessThan(160_000);
  });

  it('timeScale shortens the rule for SIM_SPEEDUP', () => {
    const d = new StopDetector(10);
    const ev = feed(d, run(0, 25, () => HOME, () => 0));
    expect(ev[0]).toMatchObject({ type: 'arrive' });
    expect(ev[0].i).toBe(STOP_MIN_MS / 10 / 1000);
  });
});

describe('segment', () => {
  it('turns a day of points into stop -> trip -> stop', () => {
    const t = (min: number) => Date.parse('2026-11-03T14:00:00Z') + min * 60_000;
    const A = HOME, B = north(HOME, 5000);
    const pts: StopSample[] = [
      { t: t(0), ...A, speedMph: null }, { t: t(10), ...A, speedMph: null },
      { t: t(12), ...north(A, 1500), speedMph: null }, { t: t(14), ...north(A, 3500), speedMph: null },
      { t: t(16), ...B, speedMph: null }, { t: t(30), ...north(B, 10), speedMph: null },
    ];
    const s = segment(pts);
    expect(s.stops).toHaveLength(2);
    expect(s.stops[0]).toMatchObject({ arrivedAt: t(0) });
    expect(s.stops[1]).toMatchObject({ arrivedAt: t(16), departedAt: null });
    expect(s.trips).toHaveLength(1);
    expect(s.trips[0]).toMatchObject({ fromStop: 0, toStop: 1, endedAt: t(16) });
    expect(s.trips[0].miles).toBeCloseTo(5000 / 1609.344, 1);
  });
});

describe('naming precedence', () => {
  const p = HOME;
  const tiers = {
    places: [{ name: "Jeff's garage", ...north(p, 50), radiusM: 120, placeId: 7 }],
    zones: [{ name: 'Home', ...p, radiusM: 100 }],
    feed: [{ name: 'Lee residence (client)', ...p, radiusM: 150 }],
  };
  it('saved place beats HA zone beats the places feed', () => {
    expect(resolveName(p, tiers)).toEqual({ name: "Jeff's garage", source: 'place', placeId: 7 });
    expect(resolveName(p, { ...tiers, places: [] })).toEqual({ name: 'Home', source: 'zone', placeId: null });
    expect(resolveName(p, { ...tiers, places: [], zones: [] })).toEqual({ name: 'Lee residence (client)', source: 'feed', placeId: null });
    expect(resolveName(north(p, 500), tiers)).toBeNull();
  });
  it('each area only counts inside its own radius, nearest first', () => {
    const areas = [{ name: 'far', ...north(p, 90), radiusM: 100 }, { name: 'near', ...north(p, 30), radiusM: 40 }, { name: 'tiny', ...north(p, 10), radiusM: 5 }];
    expect(nearestArea(p, areas)?.name).toBe('near');
  });
  it('parses a tolerant places feed', () => {
    expect(parseFeed([{ name: 'Store', lat: 33.4, lon: -111.9 }, { name: '', lat: 1, lon: 1 }, { name: 'X', latitude: '33.1', longitude: '-111.1', radius: 60 }, { lat: 1 }]))
      .toEqual([{ name: 'Store', lat: 33.4, lon: -111.9, radiusM: 120 }, { name: 'X', lat: 33.1, lon: -111.1, radiusM: 60 }]);
  });
  it('reads a short name out of Nominatim', () => {
    expect(nameFromNominatim({ name: 'Costco', address: { road: 'E Baseline Rd' } })).toBe('Costco');
    expect(nameFromNominatim({ name: '', address: { house_number: '1234', road: 'E Camelback Rd' } })).toBe('1234 E Camelback Rd');
    expect(nameFromNominatim({ error: 'Unable to geocode' })).toBeNull();
  });
});

describe('the whole chain, with OSM last', () => {
  const setup = (osm: (url: string) => unknown) => {
    const db = openDb(mkdtempSync(path.join(tmpdir(), 'slate-stops-')));
    const calls: { url: string; ua: string }[] = [];
    const geo = new Geocoder(db, '9.9.9', async (url, init) => { calls.push({ url, ua: init.headers['user-agent'] }); return { ok: true, status: 200, json: async () => osm(url) }; });
    const svc = new StopService(db, new HaClient(() => defaultSettings()), () => defaultSettings(), geo);
    return { db, svc, calls };
  };

  it('falls back to OSM, caches it, then a saved place takes over and the stop is renamed', async () => {
    const { svc, calls } = setup(() => ({ name: 'Costco Wholesale' }));
    const a = svc.stops.create({ driverId: 'jeff', source: 'truck', arrivedAt: '2026-11-03T15:00:00Z', departedAt: null, ...HOME, reason: 'dwell' });
    svc.nameStop(a.id);
    await svc.geocodePass();
    expect(svc.stops.get(a.id)).toMatchObject({ name: 'Costco Wholesale', nameSource: 'geocode' });
    expect(calls).toHaveLength(1);
    expect(calls[0].ua).toBe('slate-cockpit/9.9.9');
    expect(calls[0].ua).not.toMatch(/@/);
    // a second stop in the same ~11 m cell is named from the cache, no second request
    const b = svc.stops.create({ driverId: 'jeff', source: 'truck', arrivedAt: '2026-11-04T15:00:00Z', departedAt: null, ...HOME, reason: 'dwell' });
    svc.nameStop(b.id);
    await svc.geocodePass();
    expect(svc.stops.get(b.id)?.name).toBe('Costco Wholesale');
    expect(calls).toHaveLength(1);
    // tap to name
    const r = svc.nameFromStop(a.id, { name: 'Costco Tempe' }, 'jeff')!;
    expect(r.renamed).toBe(2);
    expect(svc.stops.get(b.id)).toMatchObject({ name: 'Costco Tempe', nameSource: 'place', placeId: r.place.id });
    expect(svc.placesWithVisits()[0]).toMatchObject({ name: 'Costco Tempe', visits: 2 });
    // deleting the place falls back to the cached OSM name
    svc.deletePlace(r.place.id);
    expect(svc.stops.get(b.id)).toMatchObject({ name: 'Costco Wholesale', nameSource: 'geocode' });
  });

  it('no name anywhere stays null ("Unnamed stop") and offline leaves it to try later', async () => {
    const { db, svc } = setup(() => ({ error: 'Unable to geocode' }));
    const a = svc.stops.create({ driverId: null, source: 'phone', arrivedAt: '2026-11-03T15:00:00Z', departedAt: null, lat: 34, lon: -112, reason: 'dwell' });
    svc.nameStop(a.id);
    await svc.geocodePass();
    expect(svc.stops.get(a.id)?.name).toBeNull();
    const row = db.prepare('SELECT name FROM geocode_cache WHERE key = ?').get(cacheKey(34, -112)) as { name: string | null };
    expect(row.name).toBeNull(); // cached as "nothing here"
  });

  it('suggests a spot visited 3+ times with no proper name', () => {
    const { svc } = setup(() => ({}));
    for (let i = 0; i < 3; i++) svc.stops.create({ driverId: 'jeff', source: 'truck', arrivedAt: `2026-11-0${i + 1}T15:00:00Z`, departedAt: null, ...north(HOME, i * 20), reason: 'dwell' });
    svc.stops.create({ driverId: 'jeff', source: 'truck', arrivedAt: '2026-11-04T15:00:00Z', departedAt: null, ...north(HOME, 3000), reason: 'dwell' });
    const s = svc.suggestions();
    expect(s).toHaveLength(1);
    expect(s[0].visits).toBe(3);
    expect(svc.suggestions('sam')).toEqual([]);
  });
});

describe('driver suggestion from phone presence', () => {
  it('only a phone within 150 m, heard from in the last 10 minutes, counts', async () => {
    const { driversAtTruck } = await import('../src/brain.ts');
    const drivers = defaultSettings().drivers;
    const now = Date.parse('2026-11-05T15:00:00Z');
    const presence = new Map([
      ['person.jeff', { ...north(HOME, 60), at: now - 2 * 60_000 }],
      ['person.sam', { ...north(HOME, 400), at: now - 60_000 }],        // too far
      ['person.jordan', { ...north(HOME, 20), at: now - 30 * 60_000 }],          // too old
    ]);
    expect(driversAtTruck(drivers, presence, HOME, now).map((d) => d.id)).toEqual(['jeff']);
    presence.set('person.jordan', { ...north(HOME, 20), at: now - 60_000 });
    expect(driversAtTruck(drivers, presence, HOME, now).map((d) => d.id)).toEqual(['jeff', 'jordan']);
  });
});
