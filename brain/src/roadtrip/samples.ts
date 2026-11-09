// Charging-rate samples: every rise in charge level while plugged in becomes a
// row (from %, to %, kW, the station's rated kW, where). They teach the curve
// (curve.ts) and say which sites were slow last time (sitePerformance).
import type { Db } from '../db.ts';
import { metersBetween } from '../geo.ts';
import type { SitePerformance } from '../types.ts';
import { genericCurve, kwAt, learnCurve, type Curve } from './curve.ts';
import type { SampleRow } from './types.ts';
export type { SampleRow } from './types.ts';

/** A sample spans at least this long; shorter is clock noise. */
const MIN_SPAN_MS = 20_000;
/** Longer than this between readings is a gap, not a rate. */
const MAX_SPAN_MS = 30 * 60_000;
/** Samples within this distance are the same site. */
export const SITE_M = 150;
/** A site is "slow" when it gave less than this share of what the truck should have taken. */
export const SLOW_RATIO = 0.7;

export type { SitePerformance };

export function ensureSampleTable(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS charge_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL, soc_from REAL NOT NULL, soc_to REAL NOT NULL, kw REAL NOT NULL,
      station_kw REAL, lat REAL, lon REAL, session_id INTEGER, simulated INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS charge_samples_at ON charge_samples(at);
  `);
}

/** kW from a rise in charge level over time: points x pack / hours. Null when the span is noise or a gap. */
export function rateKw(socFrom: number, socTo: number, msElapsed: number, packKwh: number): number | null {
  if (!(socTo > socFrom) || msElapsed < MIN_SPAN_MS || msElapsed > MAX_SPAN_MS || !(packKwh > 0)) return null;
  return ((socTo - socFrom) / 100) * packKwh / (msElapsed / 3_600_000);
}

export class SampleStore {
  private db: Db;
  private sim: boolean;
  private cache: { at: number; curve: Curve; rows: SampleRow[] } | null = null;

  constructor(db: Db, opts: { sim?: boolean } = {}) { this.db = db; this.sim = !!opts.sim; ensureSampleTable(db); }

  add(s: Omit<SampleRow, 'simulated'> & { simulated?: boolean }) {
    this.db.prepare('INSERT INTO charge_samples (at, soc_from, soc_to, kw, station_kw, lat, lon, session_id, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.at, s.socFrom, s.socTo, Math.round(s.kw * 10) / 10, s.stationKw, s.lat, s.lon, s.sessionId, (s.simulated ?? this.sim) ? 1 : 0);
    this.cache = null;
  }

  /** Real samples teach a real truck; a SIM brain learns from its own simulated ones (so the demo shows learning). */
  list(limit = 5000): SampleRow[] {
    const rows = this.db.prepare(`SELECT * FROM charge_samples ${this.sim ? '' : 'WHERE simulated = 0'} ORDER BY at DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      at: String(r.at), socFrom: Number(r.soc_from), socTo: Number(r.soc_to), kw: Number(r.kw),
      stationKw: r.station_kw === null ? null : Number(r.station_kw),
      lat: r.lat === null ? null : Number(r.lat), lon: r.lon === null ? null : Number(r.lon),
      sessionId: r.session_id === null ? null : Number(r.session_id), simulated: !!r.simulated,
    }));
  }

  /** The learned curve, rebuilt at most once a minute. */
  curve(now = Date.now()): Curve {
    return this.cached(now).curve;
  }

  private cached(now = Date.now()) {
    if (this.cache && now - this.cache.at < 60_000) return this.cache;
    const rows = this.list();
    this.cache = { at: now, curve: rows.length ? learnCurve(rows) : genericCurve(), rows };
    return this.cache;
  }

  /** Recent samples of one session (the coach's live rate). */
  forSession(sessionId: number): SampleRow[] {
    return this.list(400).filter((s) => s.sessionId === sessionId).reverse();
  }

  /** How a site did against the curve, over its DC samples. Null with fewer than 3. */
  sitePerformance(lat: number, lon: number): SitePerformance | null {
    const c = this.cached();
    return c.rows.length ? sitePerformance(c.rows, lat, lon, c.curve) : null;
  }
}

/** Pure: a site's median ratio of seen to expected kW. */
export function sitePerformance(samples: SampleRow[], lat: number, lon: number, curve: Curve): SitePerformance | null {
  const here = samples.filter((s) => s.lat !== null && s.lon !== null && s.kw > 20 && metersBetween({ lat, lon }, { lat: s.lat, lon: s.lon! }) <= SITE_M);
  if (here.length < 3) return null;
  const pairs = here.map((s) => { const exp = kwAt(curve, (s.socFrom + s.socTo) / 2, s.stationKw); return { seen: s.kw, exp, r: s.kw / exp }; });
  pairs.sort((a, b) => a.r - b.r);
  const mid = pairs[Math.floor(pairs.length / 2)];
  return { ratio: Math.round(mid.r * 100) / 100, kwSeen: Math.round(mid.seen), kwExpected: Math.round(mid.exp), samples: here.length, at: here[0].at };
}
