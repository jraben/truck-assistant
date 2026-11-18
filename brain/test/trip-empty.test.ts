// A "trip" that never went anywhere isn't kept, and none ends before it starts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { isEmptyTrip, TripStore } from '../src/trips.ts';

const store = () => { const db = openDb(mkdtempSync(path.join(tmpdir(), 'tempty-')), { sim: true }); return { db, trips: new TripStore(db) }; };
const T0 = new Date('2026-11-18T15:45:20Z');
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const P = { lat: 33.45, lon: -112.07 };

describe('empty trips', () => {
  it('a trip under 0.05 mi and 2 min is not a trip', () => {
    expect(isEmptyTrip(0, 0)).toBe(true);
    expect(isEmptyTrip(0.04, 119)).toBe(true);
    expect(isEmptyTrip(0, 600)).toBe(false); // GPS out on a real drive: keep it
    expect(isEmptyTrip(0.3, 30)).toBe(false);
  });

  it('into Drive and back without moving leaves nothing behind', () => {
    const { trips } = store();
    const t = trips.start(T0, 70, P);
    expect(trips.end(t.id, at(20), 70, P, 4, 'park')).toBeNull();
    expect(trips.get(t.id)).toBeNull();
    expect(trips.list()).toEqual([]);
  });

  it('a stop dated before the trip began removes the empty trip instead of ending it before it started', () => {
    const { trips } = store();
    const t = trips.start(T0, 70, P);
    expect(trips.end(t.id, at(-88), 70, P, 4, 'stop')).toBeNull();
    expect(trips.list()).toEqual([]);
  });

  it('a real drive is kept, and its end is never before its start', () => {
    const { db, trips } = store();
    const t = trips.start(T0, 70, P);
    db.prepare('UPDATE trips SET miles = 3.2 WHERE id = ?').run(t.id);
    const kept = trips.end(t.id, at(-30), 68, P, 4, 'stop')!;
    expect(kept.miles).toBe(3.2);
    expect(Date.parse(kept.endedAt!)).toBeGreaterThanOrEqual(Date.parse(kept.startedAt));
  });

  it('cleans up impossible trips left by older versions, and nothing else', () => {
    const { db, trips } = store();
    const ins = db.prepare("INSERT INTO trips (started_at, ended_at, miles, duration_s, source) VALUES (?, ?, ?, ?, 'truck')");
    ins.run('2026-11-17T15:45:20.916Z', '2026-11-17T15:43:52.885Z', 0, 0);  // ended before it started
    ins.run('2026-11-18T00:05:22.012Z', '2026-11-18T00:05:22.012Z', 0, 0);  // no length at all
    ins.run('2026-11-17T16:39:41.098Z', '2026-11-17T16:48:06.199Z', 6.85, 505); // a real drive
    ins.run('2026-11-17T10:00:00.000Z', '2026-11-17T10:20:00.000Z', 0, 1200); // GPS out: kept
    expect(trips.dropImpossible()).toBe(2);
    expect(trips.list().map((t) => t.miles).sort()).toEqual([0, 6.85]);
  });
});
