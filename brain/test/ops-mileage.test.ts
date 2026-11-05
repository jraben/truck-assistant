import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultOps, DEFAULT_RATES, OpsStore } from '../src/ops/config.ts';
import { autoPurpose, buildRows, CSV_HEADER, estimateOdometers, MileageService, odometerNow, rateFor, toCsv, toHtml, validateMileageConfig } from '../src/ops/mileage.ts';
import { openDb } from '../src/db.ts';
import { TripStore } from '../src/trips.ts';
import { defaultSettings } from '../src/settings.ts';
import type { Trip } from '../src/types.ts';

const cfg = () => defaultOps().mileage;
const local = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString();
const trip = (id: number, startedAt: string, miles: number, extra: Partial<Trip> = {}): Trip => ({
  id, startedAt, endedAt: new Date(Date.parse(startedAt) + 1800_000).toISOString(), miles, durationS: 1800,
  startSoc: null, endSoc: null, kwhEst: null, start: { lat: 0, lon: 0 }, end: null, driverId: 'jeff', source: 'truck',
  from: { stopId: 1, name: 'Home' }, to: { stopId: 2, name: 'Costco' }, ...extra,
});

describe('mileage auto-tagging', () => {
  it('a hand-set purpose beats every rule', () => {
    const c = { ...cfg(), placeTags: { '7': 'client' as const }, driverDefaults: { jeff: 'personal' as const } };
    expect(autoPurpose({ purpose: 'commute', note: null }, { nameSource: 'place', placeId: 7 }, 'jeff', c)).toEqual({ purpose: 'commute', source: 'manual' });
  });
  it('a destination saved place tagged client or business is business', () => {
    const c = { ...cfg(), placeTags: { '7': 'client' as const, '8': 'business' as const, '9': 'personal' as const } };
    expect(autoPurpose(null, { nameSource: 'place', placeId: 7 }, 'jeff', c)).toEqual({ purpose: 'business', source: 'place' });
    expect(autoPurpose(null, { nameSource: 'place', placeId: 8 }, 'jeff', c).purpose).toBe('business');
    expect(autoPurpose(null, { nameSource: 'place', placeId: 9 }, 'jeff', c)).toEqual({ purpose: 'personal', source: 'place' });
  });
  it('a destination from the places feed is business unless that is turned off', () => {
    expect(autoPurpose(null, { nameSource: 'feed', placeId: null }, 'jeff', cfg())).toEqual({ purpose: 'business', source: 'feed' });
    expect(autoPurpose(null, { nameSource: 'feed', placeId: null }, 'jeff', { ...cfg(), feedIsBusiness: false }).purpose).toBeNull();
  });
  it('falls back to the driver default, else untagged', () => {
    const c = { ...cfg(), driverDefaults: { sam: 'personal' as const } };
    expect(autoPurpose(null, { nameSource: 'geocode', placeId: null }, 'sam', c)).toEqual({ purpose: 'personal', source: 'driver' });
    expect(autoPurpose(null, null, 'jeff', c)).toEqual({ purpose: null, source: null });
    // a note alone (no purpose) doesn't stop auto-tagging
    expect(autoPurpose({ purpose: null, note: 'x' }, { nameSource: 'feed', placeId: null }, 'jeff', c).purpose).toBe('business');
  });
});

describe('odometer estimate', () => {
  const trips = [trip(1, local(2026, 3, 1), 10), trip(2, local(2026, 3, 2), 20), trip(3, local(2026, 3, 5), 5), trip(4, local(2026, 3, 3), 50, { source: 'phone' })];
  const anchor = { odometer: 1000, at: local(2026, 3, 2, 0) };
  it('counts forward from the anchor and back before it, skipping phone trips', () => {
    const o = estimateOdometers(trips, anchor);
    expect(o.get(2)).toEqual({ start: 1000, end: 1020 });
    expect(o.get(3)).toEqual({ start: 1020, end: 1025 });
    expect(o.get(1)).toEqual({ start: 990, end: 1000 });
    expect(o.has(4)).toBe(false);
  });
  it('no anchor, no readings', () => { expect(estimateOdometers(trips, null).size).toBe(0); expect(odometerNow(trips, null)).toBeNull(); });
  it('now = anchor + truck miles since', () => { expect(odometerNow(trips, anchor)).toBe(1025); });
});

describe('IRS rate', () => {
  it('picks the rate in effect that day, including the 2026 mid-year change', () => {
    expect(rateFor('2025-06-01', DEFAULT_RATES)?.centsPerMile).toBe(70);
    expect(rateFor('2026-06-30', DEFAULT_RATES)?.centsPerMile).toBe(72.5);
    expect(rateFor('2026-07-01', DEFAULT_RATES)?.centsPerMile).toBe(76);
    expect(rateFor('2024-12-31', DEFAULT_RATES)).toBeNull();
  });
});

describe('export rows', () => {
  const c = { ...cfg(), placeTags: { '2': 'client' as const }, odometerAnchor: { odometer: 500, at: local(2026, 1, 1, 0) } };
  const inputs = [
    { trip: trip(1, local(2026, 6, 15), 12.345), tag: null, end: { nameSource: 'place', placeId: 2 } },
    { trip: trip(2, local(2026, 7, 2), 10, { to: { stopId: 3, name: 'Bashas, "Main"' } }), tag: { purpose: 'personal' as const, note: 'groceries' }, end: null },
    { trip: trip(3, local(2026, 7, 3), 8, { source: 'phone', to: null, from: null }), tag: { purpose: 'business' as const, note: 'Site visit, Smith' }, end: null },
  ];
  const all = inputs.map((i) => i.trip);
  const { rows, totals } = buildRows(inputs, all, c, (id) => (id === 'jeff' ? 'Jeff' : '—'));

  it('fills purpose, odometer, rate and deduction', () => {
    expect(rows[0]).toMatchObject({ date: '2026-06-15', driver: 'Jeff', purpose: 'business', purposeSource: 'place', from: 'Home', to: 'Costco', startOdometer: 500, endOdometer: 512.3, miles: 12.35, rateCents: 72.5, deduction: 8.95, approximate: false });
    expect(rows[1]).toMatchObject({ purpose: 'personal', note: 'groceries', rateCents: null, deduction: null, startOdometer: 512.3 });
    expect(rows[2]).toMatchObject({ approximate: true, startOdometer: null, rateCents: 76, deduction: 6.08, from: '', to: '' });
  });
  it('totals business miles and the deduction', () => {
    expect(totals.businessMiles).toBe(20.35);
    expect(totals.byPurpose.personal).toBe(10);
    expect(totals.deduction).toBe(15.03);
    expect(totals.approximateMiles).toBe(8);
    expect(totals.ratesUsed.map((r) => r.centsPerMile)).toEqual([72.5, 76]);
  });
  it('CSV has the IRS columns, escapes quotes, flags phone trips and ends with totals', () => {
    const csv = toCsv(rows, totals);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines[2]).toContain('"Bashas, ""Main"""');
    expect(lines[3]).toContain('yes (phone)');
    expect(lines.at(-1)).toContain('20.35');
    expect(lines.at(-1)).toContain('15.03');
  });
  it('HTML escapes text and states the estimate basis', () => {
    const html = toHtml(rows, totals, { title: 'Log', period: '2026', truck: 'slate', anchor: c.odometerAnchor, generated: '2026-11-05' });
    expect(html).toContain('Bashas, &quot;Main&quot;');
    expect(html).toContain('estimates');
    expect(html).toContain('$15.03');
  });
});

describe('mileage config validation', () => {
  it('accepts an anchor and sorts rates; rejects bad purposes', () => {
    const n = validateMileageConfig(cfg(), { odometerAnchor: { odometer: 1234.56, at: '2026-11-01T10:00:00Z' }, rates: [{ from: '2027-01-01', centsPerMile: 80 }, { from: '2026-01-01', centsPerMile: 72.5, source: 'x' }] });
    expect(n.odometerAnchor).toEqual({ odometer: 1234.6, at: '2026-11-01T10:00:00.000Z' });
    expect(n.rates.map((r) => r.from)).toEqual(['2026-01-01', '2027-01-01']);
    expect(() => validateMileageConfig(cfg(), { driverDefaults: { jeff: 'fun' } })).toThrow();
    expect(() => validateMileageConfig(cfg(), { placeTags: { abc: 'client' } })).toThrow();
  });
});

describe('MileageService bulk tagging', () => {
  it('tags many trips, keeps notes, and clears back to automatic', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mil-'));
    const db = openDb(dir);
    const ts = new TripStore(db);
    const ids = [1, 2, 3].map((i) => { const t = ts.start(new Date(2026, 4, i, 9), null, { lat: 33.4, lon: -112 }, 'jeff'); ts.addMiles(t.id, 5); ts.end(t.id, new Date(2026, 4, i, 10), null, { lat: 33.5, lon: -112 }, 3.5, 'test'); return t.id; });
    const svc = new MileageService(db, new OpsStore(dir), ts, () => defaultSettings());
    expect(svc.tag({ tripIds: ids, purpose: 'business' })).toBe(3);
    expect(svc.tag({ tripIds: [ids[0]], note: 'Client: Smith' })).toBe(1);
    let rows = svc.list().rows;
    expect(rows.every((r) => r.purpose === 'business')).toBe(true);
    expect(rows.find((r) => r.tripId === ids[0])?.note).toBe('Client: Smith');
    svc.tag({ tripIds: [ids[1]], purpose: null });
    rows = svc.list({ purpose: 'untagged' }).rows;
    expect(rows.map((r) => r.tripId)).toEqual([ids[1]]);
    expect(() => svc.tag({ tripIds: [ids[0]], purpose: 'fun' })).toThrow();
    db.close();
  });
});
