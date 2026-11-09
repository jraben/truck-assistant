import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { findFlight, parseAdsb, parseFlight, parseRoute, pickupState, BAGS_MIN, DEPLANE_MIN, TAXI_MIN, type Airport } from '../src/pickup/flight.ts';
import { PickupService } from '../src/pickup/service.ts';
import { adsbdbAnswer } from '../src/demo/backend.ts';

const PHX: Airport = { iata: 'PHX', icao: 'KPHX', name: 'Phoenix Sky Harbor', city: 'Phoenix', lat: 33.4343, lon: -112.0116 };

describe('flight numbers', () => {
  it('reads the ways people write them', () => {
    expect(parseFlight('AA 1234')).toMatchObject({ callsign: 'AAL1234', label: 'AA 1234' });
    expect(parseFlight('wn2510')).toMatchObject({ callsign: 'SWA2510' });
    expect(parseFlight('SWA2510')).toMatchObject({ iata: 'WN', label: 'WN 2510' });
    expect(parseFlight('Southwest 2510')).toMatchObject({ callsign: 'SWA2510' });
    expect(parseFlight('B6 101')).toMatchObject({ callsign: 'JBU101' });
    expect(parseFlight('ZZ 1')).toBeNull();
    expect(parseFlight('hello')).toBeNull();
  });
  it('finds one in a calendar event', () => {
    expect(findFlight('Pick up Sam, AA 1234 from DFW')).toMatchObject({ callsign: 'AAL1234' });
    expect(findFlight('Jordan lands on United 455')).toMatchObject({ callsign: 'UAL455' });
    expect(findFlight('Lunch at 12')).toBeNull();
  });
});

describe('feeds', () => {
  it('reads adsb.fi and adsbdb answers', () => {
    expect(parseAdsb({ ac: [{ flight: 'AAL1234 ', lat: 33.6, lon: -110, alt_baro: 31000, gs: 440, track: 260, seen: 2 }] }, 10_000)).toEqual({ lat: 33.6, lon: -110, altFt: 31000, gsKt: 440, track: 260, seenAt: 8000 });
    expect(parseAdsb({ ac: [] }, 0)).toBeNull();
    expect(parseRoute({})).toEqual({ origin: null, destination: null });
    expect(parseRoute({ response: { flightroute: { destination: { iata_code: 'PHX', name: 'Sky Harbor', latitude: 33.43, longitude: -112.01 } } } }).destination).toMatchObject({ iata: 'PHX', lat: 33.43 });
  });
});

describe('when to leave', () => {
  const base = { now: Date.parse('2027-06-01T15:00:00Z'), dest: PHX, landedAt: null, stoppedSince: null, bags: false, driveMin: 30, label: 'AA 1234', who: 'Sam' };
  it('works out landing and leave time from distance and speed', () => {
    const s = pickupState({ ...base, ac: { lat: 33.4343, lon: -110.0, altFt: 30000, gsKt: 450, track: 270, seenAt: base.now } });
    expect(s.phase).toBe('en-route');
    expect(s.milesOut).toBeGreaterThan(100);
    const lands = Date.parse(s.landsAt!);
    expect(Date.parse(s.readyAt!) - lands).toBe((TAXI_MIN + DEPLANE_MIN) * 60_000);
    expect(Date.parse(s.leaveAt!)).toBe(Date.parse(s.readyAt!) - 35 * 60_000);
    expect(s.line).toMatch(/^Sam's AA 1234 is \d+ mi out, lands about/);
  });
  it('allows for checked bags', () => {
    const ac = { lat: 33.4343, lon: -111.0, altFt: 12000, gsKt: 300, track: 270, seenAt: base.now };
    const a = pickupState({ ...base, ac }), b = pickupState({ ...base, ac, bags: true });
    expect(Date.parse(b.readyAt!) - Date.parse(a.readyAt!)).toBe(BAGS_MIN * 60_000);
  });
  it('knows landed, taxiing and at the gate', () => {
    const ground = { lat: 33.437, lon: -112.0, altFt: 'ground' as const, gsKt: 15, track: 90, seenAt: base.now };
    expect(pickupState({ ...base, ac: ground }).phase).toBe('taxiing');
    const parked = pickupState({ ...base, ac: { ...ground, gsKt: 0 }, landedAt: base.now - 9 * 60_000, stoppedSince: base.now - 120_000 });
    expect(parked.phase).toBe('at-gate');
    expect(parked.line).toMatch(/at the gate: out front in about 15 min/);
    expect(pickupState({ ...base, ac: null }).phase).toBe('waiting');
  });
});

describe('pickup service', () => {
  it('follows the flight, says when to leave, and alerts once per step', async () => {
    let now = Date.parse('2027-06-01T15:00:00Z');
    let pos = { lat: 33.4343, lon: -111.5, alt_baro: 9000 as number | string, gs: 400 };
    const f = (async (u: string | URL) => {
      const url = new URL(String(u));
      if (url.hostname === 'api.adsbdb.com') return adsbdbAnswer(url);
      if (url.hostname === 'opendata.adsb.fi') return new Response(JSON.stringify({ ac: [{ ...pos, seen: 0 }] }));
      // the drive to the airport (OSRM): 30 minutes
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 20000, duration: 1800, geometry: { coordinates: [[-111.98, 33.5], [-112.01, 33.43]] } }] }));
    }) as typeof fetch;
    const sent: string[] = [];
    const svc = new PickupService({ db: openDb(mkdtempSync(path.join(tmpdir(), 'pk-'))), gps: () => ({ lat: 33.5, lon: -111.98 }), online: () => true, notify: async (t) => { sent.push(t); }, fetchFn: f });
    await expect(svc.start({ flight: 'nope' })).rejects.toThrow(/doesn't look like a flight/);
    const v = await svc.start({ flight: 'AA 1234', who: 'Sam' });
    expect(v.pickup!.dest!.iata).toBe('PHX');
    expect(v.state!.phase).toBe('approach');
    expect(v.state!.driveMin).toBe(30);
    expect(sent).toEqual(['Leave now for PHX']);           // ~29 mi out: it lands sooner than the drive
    pos = { lat: 33.437, lon: -112.0, alt_baro: 'ground', gs: 12 };
    now += 31_000; await svc.tick(now);
    expect(svc.view().state!.phase).toBe('taxiing');
    pos = { ...pos, gs: 0 };
    now += 31_000; await svc.tick(now);
    now += 100_000; await svc.tick(now);
    expect(svc.view().state!.phase).toBe('at-gate');
    expect(sent).toEqual(['Leave now for PHX', 'AA 1234 landed', 'AA 1234 is at the gate']);
    svc.cancel();
    expect(svc.view().pickup).toBeNull();
  });

  it('suggests the flight in the next calendar event', () => {
    const svc = new PickupService({ db: openDb(mkdtempSync(path.join(tmpdir(), 'pk-'))), gps: () => null, online: () => true, notify: async () => {} });
    svc.setNextAppointment(() => ({ title: 'Pick up Jordan - WN 2510', location: 'PHX' }));
    expect(svc.view().suggestion).toMatchObject({ flight: { callsign: 'SWA2510' } });
  });
});
