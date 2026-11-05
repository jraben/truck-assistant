import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChargerFinder, type FinderSettings } from '../src/chargers/finder.ts';
import { lastPaidAt, sessionAt, withLastPaid, type PaidSession } from '../src/chargers/paid.ts';
import { scoreCharger, type Station } from '../src/chargers/score.ts';
import { AFDC_URL, afdcStation, googleAvailability, googleStation, mergeGoogle } from '../src/chargers/sources.ts';
import { openDb } from '../src/db.ts';
import { defaultSettings } from '../src/settings.ts';

const settings = (keys: FinderSettings['keys'] = {}): FinderSettings => ({
  ...defaultSettings(), keys,
  charging: { networks: [], avoidNetworks: [], minKw: 50, connector: 'any', maxDetourMi: 10, wantAmenities: [], arriveMinSoc: 15 },
});
const st = (o: Partial<Station>): Station => ({
  id: 'x', source: 'afdc', name: 'Tempe Marketplace', network: 'Electrify America', lat: 33.43, lon: -111.9, maxKw: 150, connectors: ['CCS'], amenities: [], price: null, ...o,
});
const NOW = Date.parse('2026-11-05T20:00:00Z');

const googlePlace = {
  id: 'g1', displayName: { text: 'Electrify America' }, location: { latitude: 33.4305, longitude: -111.9004 },
  evChargeOptions: { connectorCount: 6, connectorAggregation: [
    { type: 'EV_CONNECTOR_TYPE_CCS_COMBO_1', maxChargeRateKw: 350, count: 4, availableCount: 1, outOfServiceCount: 1, availabilityLastUpdateTime: '2026-11-05T19:55:00Z' },
    { type: 'EV_CONNECTOR_TYPE_J1772', maxChargeRateKw: 7.2, count: 2, availableCount: 2, availabilityLastUpdateTime: '2026-11-05T19:58:00Z' },
  ] },
};

describe('AFDC domain', () => {
  it('uses developer.nlr.gov (developer.nrel.gov stopped resolving)', () => {
    expect(new URL(AFDC_URL).host).toBe('developer.nlr.gov');
  });
});

describe('Google Places', () => {
  it('maps a place: plugs, kW, live DC stalls only, no network or price guessed', () => {
    const g = googleStation(googlePlace)!;
    expect(g.id).toBe('google:g1');
    expect(g.network).toBeNull();
    expect(g.price).toBeNull();
    expect(g.maxKw).toBe(350);
    expect(g.connectors.sort()).toEqual(['CCS', 'J1772']);
    expect(g.availability).toEqual({ available: 1, total: 4, outOfService: 1, updatedAt: '2026-11-05T19:55:00Z' });
  });

  it('reports no availability when Google sends no live count', () => {
    expect(googleAvailability([{ type: 'EV_CONNECTOR_TYPE_CCS_COMBO_1', maxChargeRateKw: 150, count: 4 }])).toBeNull();
  });

  it('lays live counts onto the AFDC twin and adds sites only Google knows', () => {
    const a = afdcStation({ id: 1, station_name: 'Tempe Marketplace', ev_network: 'Electrify America', latitude: 33.43, longitude: -111.9, ev_dc_fast_num: 4 })!;
    const lone = googleStation({ ...googlePlace, id: 'g2', location: { latitude: 33.5, longitude: -111.9 } })!;
    const m = mergeGoogle([a], [googleStation(googlePlace)!, lone]);
    expect(m).toHaveLength(2);
    expect(m[0].id).toBe('afdc:1');
    expect(m[0].availability?.available).toBe(1);
    expect(m[0].maxKw).toBe(350);
    expect(m[1].id).toBe('google:g2');
  });

  it('scores free and busy stalls, and only reports a stale count', () => {
    const base = { distanceMi: 2, soc: 60, settings: settings(), now: NOW };
    const free = scoreCharger(st({ availability: { available: 2, total: 4, outOfService: 0, updatedAt: '2026-11-05T19:57:00Z' } }), base);
    const busy = scoreCharger(st({ availability: { available: 0, total: 4, outOfService: 1, updatedAt: '2026-11-05T19:57:00Z' } }), base);
    const stale = scoreCharger(st({ availability: { available: 0, total: 4, outOfService: 0, updatedAt: '2026-11-05T17:00:00Z' } }), base);
    const none = scoreCharger(st({}), base);
    expect(free.reasons).toContain('2 of 4 stalls free, 3 min ago');
    expect(busy.reasons).toContain('All 4 stalls busy, 3 min ago');
    expect(busy.reasons).toContain('1 out of service');
    expect(free.score).toBeGreaterThan(none.score);
    expect(busy.score).toBeLessThan(none.score);
    expect(stale.score).toBe(none.score);
    expect(stale.reasons).toContain('All 4 stalls busy, 3 h ago');
  });
});

describe('last paid', () => {
  const s = (o: Partial<PaidSession>): PaidSession => ({ id: 1, startedAt: '2026-10-12T18:00:00Z', network: 'Electrify America', stationName: null, lat: null, lon: null, kwh: 40, cost: 19.2, ...o });

  it('matches by position, or by name and network when the session has no coordinates', () => {
    expect(sessionAt(st({}), s({ lat: 33.4301, lon: -111.9001 }))).toBe(true);
    expect(sessionAt(st({}), s({ lat: 33.44, lon: -111.9 }))).toBe(false);
    expect(sessionAt(st({}), s({ stationName: 'Tempe Marketplace - Lot B' }))).toBe(true);
    expect(sessionAt(st({}), s({ stationName: 'Tempe Marketplace', network: 'EVgo' }))).toBe(false);
    expect(sessionAt(st({ name: 'EA' }), s({ stationName: 'EA' }))).toBe(false);
  });

  it('takes the newest costed session and works out $/kWh', () => {
    const lp = lastPaidAt(st({}), [s({ id: 3, lat: 33.43, lon: -111.9, kwh: 50, cost: 24 }), s({ id: 2, lat: 33.43, lon: -111.9 })]);
    expect(lp).toMatchObject({ sessionId: 3, cost: 24, perKwh: 0.48, sessions: 2 });
    const c = scoreCharger({ ...st({}), lastPaid: lp }, { distanceMi: 2, soc: 60, settings: settings() });
    expect(c.reasons.some((r) => r.startsWith('You paid $0.48/kWh here (') && r.endsWith(', 2 visits)'))).toBe(true);
  });

  it('falls back to the total when kWh is unknown, and ignores free sessions', () => {
    expect(lastPaidAt(st({}), [s({ lat: 33.43, lon: -111.9, kwh: null, cost: 12.3 })])?.perKwh).toBeNull();
    expect(withLastPaid([st({})], [s({ lat: 33.43, lon: -111.9, cost: 0 })])[0].lastPaid).toBeUndefined();
  });
});

describe('ChargerFinder with Google', () => {
  it('calls Google at most once per interval, joins the charge log, and survives a Google failure', async () => {
    const db = openDb(mkdtempSync(path.join(tmpdir(), 'slate-test-')));
    db.prepare(`INSERT INTO charge_sessions (started_at, place, network, station_name, lat, lon, kwh, cost, source) VALUES (?, 'public', ?, ?, ?, ?, ?, ?, 'receipt')`)
      .run('2026-10-12T18:00:00Z', 'Electrify America', 'EA Tempe', 33.4305, -111.9004, 40, 20);
    let googleCalls = 0, fail = false;
    const fetchFn = (async (url: string | URL) => {
      if (String(url).includes('places.googleapis.com')) {
        googleCalls++;
        if (fail) return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ places: [googlePlace] }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    const f = new ChargerFinder(db, fetchFn);
    const s = settings({ googlePlaces: 'GKEY' });
    const r1 = await f.find(33.43, -111.9, 60, s);
    await f.find(33.45, -111.9, 60, s);
    expect(googleCalls).toBe(1);
    expect(r1.chargers).toHaveLength(1);
    expect(r1.chargers[0].availability?.available).toBe(1);
    expect(r1.chargers[0].lastPaid?.perKwh).toBe(0.5);

    // Force the interval to pass; a failing Google keeps the last good layer and says so.
    (f as unknown as { googleTriedAt: number }).googleTriedAt = 0;
    fail = true;
    const r3 = await f.find(33.43, -111.9, 60, s);
    expect(googleCalls).toBe(2);
    expect(r3.chargers).toHaveLength(1);
    expect(r3.message).toMatch(/Live stall counts unavailable: Google Places answered 500/);
  });
});
