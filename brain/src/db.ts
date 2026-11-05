// SQLite via node:sqlite (built into Node 24), so the Pi needs no compiler.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'cockpit.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      miles REAL NOT NULL DEFAULT 0,
      duration_s INTEGER NOT NULL DEFAULT 0,
      start_soc REAL, end_soc REAL, kwh_est REAL,
      start_lat REAL, start_lon REAL, end_lat REAL, end_lon REAL,
      end_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS trip_points (
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      t TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
      speed_mph REAL, heading_deg REAL
    );
    CREATE INDEX IF NOT EXISTS trip_points_trip ON trip_points(trip_id, t);
    CREATE TABLE IF NOT EXISTS charger_cache (
      key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS charge_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL, ended_at TEXT,
      place TEXT NOT NULL, network TEXT, station_name TEXT,
      lat REAL, lon REAL, kwh REAL, cost REAL, cost_source TEXT,
      start_soc REAL, end_soc REAL, max_kw REAL, note TEXT,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS charge_sessions_started ON charge_sessions(started_at);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id TEXT, source TEXT NOT NULL DEFAULT 'truck',
      arrived_at TEXT NOT NULL, departed_at TEXT,
      lat REAL NOT NULL, lon REAL NOT NULL,
      reason TEXT NOT NULL DEFAULT 'dwell',
      name TEXT, name_source TEXT, place_id INTEGER,
      geocode_tried INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS stops_arrived ON stops(arrived_at);
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
      radius_m REAL NOT NULL DEFAULT 120, created_at TEXT NOT NULL, created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS geocode_cache (key TEXT PRIMARY KEY, name TEXT, fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gas_prices (
      day TEXT NOT NULL, fuel TEXT NOT NULL, price REAL NOT NULL, station TEXT,
      fetched_at TEXT NOT NULL, updated_at TEXT,
      PRIMARY KEY (day, fuel)
    );
    CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, body TEXT NOT NULL);
  `);
  // Columns added after the first release: ALTER only when missing.
  addColumns(db, 'trips', { driver_id: 'TEXT', source: "TEXT NOT NULL DEFAULT 'truck'", start_stop_id: 'INTEGER', end_stop_id: 'INTEGER', city_miles: 'REAL', highway_miles: 'REAL', city_kwh: 'REAL', highway_kwh: 'REAL' });
  addColumns(db, 'charge_sessions', { driver_id: 'TEXT' });
  return db;
}

function addColumns(db: Db, table: string, cols: Record<string, string>) {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export function kvGet<T>(db: Db, k: string): T | null {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.v) as T; } catch { return null; }
}

export function kvSet(db: Db, k: string, v: unknown) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
