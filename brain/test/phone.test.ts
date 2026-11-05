import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.ts';
import { HaClient, historyStates, trackerPoints, type HaState } from '../src/ha/client.ts';
import { dayRanges, PhoneImporter } from '../src/import/phone.ts';
import { mergeSettings, SettingsStore } from '../src/settings.ts';
import { StopService } from '../src/stops/service.ts';
import { TripStore } from '../src/trips.ts';
import { segment } from '../src/stops/segment.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
/** One day of person.jeff history exactly as HA's /api/history/period returns it. */
const FIXTURE = JSON.parse(readFileSync(path.join(here, 'fixtures/ha-history-person.json'), 'utf8')) as HaState[][];
const DAY_START = Date.parse('2026-11-03T07:00:00Z'); // midnight in Phoenix
const DAY_END = DAY_START + 24 * 3600_000;

/** A pretend HA: serves the fixture filtered to each request's window, records what was asked. */
function fakeHa(token = 'llat-test-token') {
  const asked: string[] = [];
  const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
    asked.push(url);
    if (init?.headers?.authorization !== `Bearer ${token}`) return { ok: false, status: 401, json: async () => ({}) };
    const u = new URL(url);
    const start = Date.parse(decodeURIComponent(u.pathname.split('/').pop()!));
    const end = Date.parse(u.searchParams.get('end_time')!);
    const rows = FIXTURE[0].filter((s) => { const t = Date.parse(s.last_updated!); return t >= start && t < end; });
    return { ok: true, status: 200, json: async () => (rows.length ? [rows] : []) };
  };
  return { asked, fetchFn };
}

describe('HA history parsing', () => {
  it('drops the GPS-accuracy outlier and the state without coordinates', () => {
    const { points, dropped } = trackerPoints(historyStates(FIXTURE, 'person.jeff'));
    expect(dropped).toBe(2);
    expect(points).toHaveLength(FIXTURE[0].length - 2);
    expect(points.some((p) => p.lat === 33.6)).toBe(false);
    expect(points.every((p) => p.accuracyM === null || p.accuracyM <= 100)).toBe(true);
  });

  it('finds the drive with two stops: home -> Tempe -> downtown -> home', () => {
    const { points } = trackerPoints(historyStates(FIXTURE, 'person.jeff'));
    const s = segment(points, DAY_END);
    expect(s.stops).toHaveLength(4);
    const [home, tempe, downtown, back] = s.stops;
    expect(home.arrivedAt).toBe(DAY_START);
    expect(new Date(home.departedAt!).toISOString()).toMatch(/^2026-11-03T14:4[45]/); // left about 07:44 local
    expect(new Date(tempe.arrivedAt).toISOString()).toBe('2026-11-03T14:58:00.000Z');
    expect(new Date(downtown.arrivedAt).toISOString()).toBe('2026-11-03T16:25:00.000Z');
    expect(new Date(back.arrivedAt).toISOString()).toBe('2026-11-03T18:18:00.000Z');
    expect(back.departedAt).toBeNull();
    expect(s.trips.map((t) => [t.fromStop, t.toStop])).toEqual([[0, 1], [1, 2], [2, 3]]);
    // the outlier 20 km away did not stretch any trip
    for (const t of s.trips) expect(t.miles).toBeLessThan(10); // 13+ mi each way had it reached the outlier
    expect(s.trips[0].miles).toBeGreaterThan(4);
  });
});

describe('phone import job', () => {
  const setup = (dir = mkdtempSync(path.join(tmpdir(), 'slate-imp-'))) => {
    const db = openDb(dir);
    const settings = new SettingsStore(dir);
    const ha = fakeHa();
    const client = new HaClient(() => settings.get(), ha.fetchFn);
    const stops = new StopService(db, client, () => settings.get(), null);
    const trips = new TripStore(db);
    const imp = new PhoneImporter(db, trips, stops, client, settings);
    return { db, settings, ha, client, stops, trips, imp };
  };

  it('says to connect Home Assistant first, without throwing anything else', () => {
    const { imp } = setup();
    expect(() => imp.start({ driverId: 'jeff' })).toThrow(/connect Home Assistant on the settings page/i);
  });

  it('pages by day, stores phone trips and stops for the driver, and a re-run replaces them', async () => {
    const { settings, ha, imp, trips, stops } = setup();
    settings.update({ homeAssistant: { url: 'http://ha.test:8123', token: 'llat-test-token' } });
    const body = { driverId: 'jeff', from: new Date(DAY_START - 3600_000).toISOString(), to: new Date(DAY_END + 3600_000).toISOString() };
    const job = imp.start(body, new Date(DAY_END + 5 * 3600_000));
    expect(job.state).toBe('running');
    expect(job.daysTotal).toBe(dayRanges(new Date(body.from), new Date(body.to)).length);
    await imp.idle();
    const done = imp.status()!;
    expect(done).toMatchObject({ state: 'done', driverId: 'jeff', tracker: 'person.jeff', dropped: 2, stops: 4, trips: 3, error: null });
    expect(done.daysDone).toBe(done.daysTotal);
    // HA was asked for full attributes, every change, for the tracker only
    expect(ha.asked.length).toBe(done.daysTotal);
    for (const u of ha.asked) {
      expect(u).toContain('filter_entity_id=person.jeff');
      expect(u).toContain('significant_changes_only=0');
      expect(u).not.toContain('minimal_response');
    }
    const t = trips.list(10, { driver: 'jeff', source: 'phone' });
    expect(t).toHaveLength(3);
    for (const x of t) expect(x).toMatchObject({ source: 'phone', driverId: 'jeff', startSoc: null, endSoc: null, kwhEst: null });
    expect(t[2].from?.stopId).toBeDefined();
    expect(stops.stops.list({ source: 'phone', driver: 'jeff' })).toHaveLength(4);
    expect(stops.stops.list({ source: 'phone' }).every((x) => x.departedAt !== null)).toBe(true); // the last one closes at the range end
    // truck trips are untouched and phone trips never count as truck miles
    expect(trips.list(10, { source: 'truck' })).toEqual([]);

    imp.start(body, new Date(DAY_END + 5 * 3600_000));
    await imp.idle();
    expect(trips.list(50, { source: 'phone' })).toHaveLength(3);
    expect(stops.stops.list({ source: 'phone' })).toHaveLength(4);
  });

  it('a bad token is reported on the job, not thrown', async () => {
    const { settings, imp } = setup();
    settings.update({ homeAssistant: { url: 'http://ha.test:8123', token: 'wrong' } });
    imp.start({ driverId: 'jeff', from: '2026-11-03', to: '2026-11-03' }, new Date(DAY_END + 3600_000));
    await imp.idle();
    expect(imp.status()).toMatchObject({ state: 'error' });
    expect(imp.status()!.error).toMatch(/token/);
    expect(JSON.stringify(imp.status())).not.toContain('wrong');
  });

  it('refuses a driver with no tracker, and the Guest', () => {
    const { settings, imp } = setup();
    settings.update({ homeAssistant: { url: 'http://ha.test:8123', token: 't' } });
    settings.updateDriver('sam', { tracker: null });
    expect(() => imp.start({ driverId: 'sam' })).toThrow(/no phone tracker/);
    expect(() => imp.start({ driverId: 'guest' })).toThrow(/Guest/);
    void mergeSettings;
  });
});
