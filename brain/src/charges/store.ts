// Charge sessions: SQLite CRUD, input checking, CSV.
import type { Db } from '../db.ts';
import type { ChargeSession } from '../types.ts';

type Row = {
  id: number; started_at: string; ended_at: string | null; place: string; network: string | null; station_name: string | null;
  lat: number | null; lon: number | null; kwh: number | null; cost: number | null; cost_source: string | null;
  start_soc: number | null; end_soc: number | null; max_kw: number | null; note: string | null; source: string; driver_id: string | null;
};

const toSession = (r: Row): ChargeSession => ({
  id: r.id, startedAt: r.started_at, endedAt: r.ended_at,
  place: r.place as ChargeSession['place'], network: r.network, stationName: r.station_name,
  lat: r.lat, lon: r.lon, kwh: r.kwh, cost: r.cost, costSource: r.cost_source as ChargeSession['costSource'],
  startSoc: r.start_soc, endSoc: r.end_soc, maxKw: r.max_kw, note: r.note, source: r.source as ChargeSession['source'],
  driverId: r.driver_id ?? null,
});

export class ChargeInputError extends Error {}

export type SessionInput = Partial<Omit<ChargeSession, 'id'>>;

const PLACES = ['home', 'public', 'other'] as const;
const COST_SOURCES = ['receipt', 'home-rate', 'free'] as const;
const SOURCES = ['manual', 'detected', 'home-charger', 'receipt'] as const;

function optNum(v: unknown, name: string, min: number, max: number): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new ChargeInputError(`${name} must be a number from ${min} to ${max}`);
  return n;
}
function optStr(v: unknown, name: string, max = 120): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ChargeInputError(`${name} must be text`);
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
function optTime(v: unknown, name: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) throw new ChargeInputError(`${name} must be an ISO date/time`);
  return new Date(t).toISOString();
}
function optEnum<T extends string>(v: unknown, name: string, allowed: readonly T[]): T | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!allowed.includes(v as T)) throw new ChargeInputError(`${name} must be one of ${allowed.join(', ')}`);
  return v as T;
}

/** Validate and normalise a POST/PUT body. Only fields present are returned. */
export function parseSessionInput(body: unknown): SessionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ChargeInputError('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const out: SessionInput = {};
  const set = <K extends keyof SessionInput>(k: K, v: SessionInput[K] | undefined) => { if (v !== undefined) out[k] = v; };
  set('startedAt', optTime(b.startedAt, 'startedAt') ?? undefined);
  set('endedAt', optTime(b.endedAt, 'endedAt'));
  set('place', optEnum(b.place, 'place', PLACES) ?? undefined);
  set('network', optStr(b.network, 'network'));
  set('stationName', optStr(b.stationName, 'stationName'));
  set('lat', optNum(b.lat, 'lat', -90, 90));
  set('lon', optNum(b.lon, 'lon', -180, 180));
  set('kwh', optNum(b.kwh, 'kwh', 0, 1000));
  set('cost', optNum(b.cost, 'cost', 0, 10000));
  set('costSource', optEnum(b.costSource, 'costSource', COST_SOURCES));
  set('startSoc', optNum(b.startSoc, 'startSoc', 0, 100));
  set('endSoc', optNum(b.endSoc, 'endSoc', 0, 100));
  set('maxKw', optNum(b.maxKw, 'maxKw', 0, 2000));
  set('note', optStr(b.note, 'note', 500));
  set('source', optEnum(b.source, 'source', SOURCES) ?? undefined);
  if (b.driverId !== undefined) {
    if (b.driverId !== null && (typeof b.driverId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(b.driverId))) throw new ChargeInputError('driverId must be a driver id or null');
    out.driverId = b.driverId as string | null;
  }
  return out;
}

const COLS: Record<keyof Omit<ChargeSession, 'id'>, string> = {
  startedAt: 'started_at', endedAt: 'ended_at', place: 'place', network: 'network', stationName: 'station_name',
  lat: 'lat', lon: 'lon', kwh: 'kwh', cost: 'cost', costSource: 'cost_source', startSoc: 'start_soc', endSoc: 'end_soc',
  maxKw: 'max_kw', note: 'note', source: 'source', driverId: 'driver_id',
};

export class ChargeStore {
  private db: Db;

  constructor(db: Db) { this.db = db; }

  list(fromIso?: string | null, toIso?: string | null, driver?: string | null): ChargeSession[] {
    const args = [fromIso ?? '0000', toIso ?? '9999', ...(driver ? [driver] : [])];
    return (this.db.prepare(`SELECT * FROM charge_sessions WHERE started_at >= ? AND started_at < ?${driver ? ' AND driver_id = ?' : ''} ORDER BY started_at DESC`)
      .all(...args) as Row[]).map(toSession);
  }

  get(id: number): ChargeSession | null {
    const r = this.db.prepare('SELECT * FROM charge_sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? toSession(r) : null;
  }

  latest(): ChargeSession | null {
    const r = this.db.prepare('SELECT * FROM charge_sessions ORDER BY started_at DESC, id DESC LIMIT 1').get() as Row | undefined;
    return r ? toSession(r) : null;
  }

  create(s: Omit<ChargeSession, 'id'>): ChargeSession {
    const keys = Object.keys(COLS) as (keyof typeof COLS)[];
    const res = this.db.prepare(`INSERT INTO charge_sessions (${keys.map((k) => COLS[k]).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...keys.map((k) => (s[k] ?? null) as string | number | null));
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, patch: SessionInput): ChargeSession | null {
    const keys = (Object.keys(patch) as (keyof typeof COLS)[]).filter((k) => k in COLS);
    if (keys.length) {
      this.db.prepare(`UPDATE charge_sessions SET ${keys.map((k) => `${COLS[k]} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), id);
    }
    return this.get(id);
  }

  delete(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM charge_sessions WHERE id = ?').run(id).changes) > 0;
  }
}

const CSV_FIELDS: (keyof ChargeSession)[] = ['id', 'startedAt', 'endedAt', 'place', 'network', 'stationName', 'lat', 'lon', 'kwh', 'cost', 'costSource', 'startSoc', 'endSoc', 'maxKw', 'note', 'source', 'driverId'];

export function toCsv(sessions: ChargeSession[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_FIELDS.join(','), ...sessions.map((s) => CSV_FIELDS.map((f) => esc(s[f])).join(','))].join('\r\n') + '\r\n';
}
