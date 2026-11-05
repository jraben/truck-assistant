// Replay a driver's phone location history from Home Assistant into trips and
// stops (source 'phone'). One HA request per local day, run in the background
// with progress, because a month of history takes a while. Re-running replaces
// that driver's phone trips and stops in the range.
import { kvGet, kvSet, type Db } from '../db.ts';
import { HaClient, NOT_CONFIGURED, trackerPoints, type TrackerPoint } from '../ha/client.ts';
import type { SettingsStore } from '../settings.ts';
import { segment, type Segmented } from '../stops/segment.ts';
import type { StopService } from '../stops/service.ts';
import type { TripStore } from '../trips.ts';
import type { ImportJob, Stop } from '../types.ts';

export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 400;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "2026-10-01" (local) or any ISO time -> Date; null when missing, undefined when invalid. */
function parseDay(v: unknown): Date | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** [from, to) cut at local midnights. */
export function dayRanges(from: Date, to: Date): [Date, Date][] {
  const out: [Date, Date][] = [];
  let a = new Date(from);
  while (a < to) {
    const next = startOfDay(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1));
    const b = next < to ? next : to;
    out.push([a, b]);
    a = b;
  }
  return out;
}

/** Write a segmented history for one driver, replacing what was there for [from, to). Returns the new stops. */
export function storePhoneHistory(trips: TripStore, stops: StopService, db: Db, driverId: string, from: Date, to: Date, seg: Segmented): Stop[] {
  const fromIso = from.toISOString(), toIso = to.toISOString();
  const created: Stop[] = [];
  db.exec('BEGIN');
  try {
    trips.deletePhone(driverId, fromIso, toIso);
    stops.stops.deletePhone(driverId, fromIso, toIso);
    const ids = seg.stops.map((s) => {
      const row = stops.stops.create({
        driverId, source: 'phone', arrivedAt: new Date(s.arrivedAt).toISOString(),
        // Still there when the history ends: closed at the end of the range (last known), never left open.
        departedAt: new Date(s.departedAt ?? Math.max(s.arrivedAt, to.getTime())).toISOString(), lat: s.lat, lon: s.lon, reason: s.reason,
      });
      created.push(row);
      return row.id;
    });
    for (const t of seg.trips) {
      trips.insertPhone({ driverId, startedAt: t.startedAt, endedAt: t.endedAt, miles: t.miles, points: t.points, startStopId: t.fromStop === null ? null : ids[t.fromStop], endStopId: t.toStop === null ? null : ids[t.toStop] });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  stops.rename(created);
  return created;
}

export class PhoneImporter {
  private db: Db;
  private trips: TripStore;
  private stops: StopService;
  private ha: HaClient;
  private settings: SettingsStore;
  private job: ImportJob | null;
  private running = false;
  onDone: ((j: ImportJob) => void) | null = null;

  constructor(db: Db, trips: TripStore, stops: StopService, ha: HaClient, settings: SettingsStore) {
    this.db = db; this.trips = trips; this.stops = stops; this.ha = ha; this.settings = settings;
    this.job = kvGet<ImportJob>(db, 'phoneImport');
    if (this.job?.state === 'running') this.finish({ state: 'error', error: 'The brain restarted during the import; run it again.' });
  }

  status(): ImportJob | null { return this.job ? { ...this.job } : null; }

  /** Validate and start in the background. Throws ImportError (400/404/409). */
  start(body: unknown, now = new Date()): ImportJob {
    if (this.running) throw new ImportError(409, 'An import is already running');
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (!this.ha.configured()) throw new ImportError(400, NOT_CONFIGURED);
    const driverId = typeof b.driverId === 'string' ? b.driverId : '';
    const d = this.settings.driver(driverId);
    if (!d) throw new ImportError(404, `No driver "${driverId}"`);
    if (d.guest) throw new ImportError(400, 'The Guest profile keeps no history');
    if (!d.tracker) throw new ImportError(400, `${d.name} has no phone tracker set: add one (e.g. person.${d.id}) on the settings page`);
    const f = parseDay(b.from), t = parseDay(b.to);
    if (f === undefined || t === undefined) throw new ImportError(400, 'from and to must be dates (YYYY-MM-DD)');
    const to = t === null ? now : (typeof b.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.to) ? startOfDay(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) : t);
    const end = to > now ? now : to;
    const from = f ?? startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DEFAULT_DAYS));
    if (!(from < end)) throw new ImportError(400, 'from must be before to');
    const days = dayRanges(from, end);
    if (days.length > MAX_DAYS) throw new ImportError(400, `At most ${MAX_DAYS} days at a time`);
    const seq = (kvGet<number>(this.db, 'phoneImportSeq') ?? 0) + 1;
    kvSet(this.db, 'phoneImportSeq', seq);
    this.job = {
      id: seq, driverId, tracker: d.tracker, from: from.toISOString(), to: end.toISOString(), state: 'running',
      daysDone: 0, daysTotal: days.length, points: 0, dropped: 0, trips: 0, stops: 0,
      startedAt: new Date().toISOString(), finishedAt: null, error: null,
    };
    this.save();
    this.running = true;
    void this.run(this.job.id, driverId, d.tracker, days, from, end);
    return { ...this.job };
  }

  /** Resolves when the running import (if any) is finished. For tests and scripts. */
  async idle(): Promise<void> { while (this.running) await new Promise((r) => setTimeout(r, 20)); }

  private async run(id: number, driverId: string, tracker: string, days: [Date, Date][], from: Date, to: Date) {
    const all: TrackerPoint[] = [];
    try {
      for (const [a, b] of days) {
        const states = await this.ha.history(tracker, a, b);
        const { points, dropped } = trackerPoints(states);
        all.push(...points);
        if (this.job?.id !== id) return;
        this.job.daysDone++; this.job.points += points.length; this.job.dropped += dropped;
        this.save();
      }
      const seg = segment(all.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, speedMph: p.speedMph })), to.getTime());
      const created = storePhoneHistory(this.trips, this.stops, this.db, driverId, from, to, seg);
      this.finish({ state: 'done', trips: seg.trips.length, stops: created.length });
      void this.stops.geocodePass(200);
    } catch (e) {
      this.finish({ state: 'error', error: (e as Error).message });
    } finally {
      this.running = false;
    }
  }

  private finish(p: Partial<ImportJob>) {
    if (!this.job) return;
    Object.assign(this.job, p, { finishedAt: new Date().toISOString() });
    this.save();
    if (this.job.state !== 'running') console.log(`[import] phone history #${this.job.id} for ${this.job.driverId}: ${this.job.state}${this.job.error ? ` (${this.job.error})` : `, ${this.job.points} points (${this.job.dropped} dropped), ${this.job.trips} trips, ${this.job.stops} stops`}`);
    this.onDone?.({ ...this.job });
  }

  private save() { try { kvSet(this.db, 'phoneImport', this.job); } catch { /* best effort */ } }
}
