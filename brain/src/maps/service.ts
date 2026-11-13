// Offline maps: downloaded areas of Protomaps' OpenStreetMap vector tiles, kept
// in their own SQLite file (DATA_DIR/maps.db, so cockpit.db and its backups stay
// small) and served to the cockpit's maps at /api/maps/tiles. One download at a
// time; a download in progress when the brain stops carries on at the next start,
// skipping the tiles it already has.
import { statfsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { kvGet, kvSet, type Db } from '../db.ts';
import { BUILD_HOST, chunk, latestBuild, RemoteArchive, wantedTiles, type Fetcher } from './pmtiles.ts';
import { countTiles, MAX_AREA_TILES, MAX_ZOOM, tileRange, type Bbox } from './tiles.ts';

export type AreaStatus = 'queued' | 'downloading' | 'ready' | 'error';
export type MapArea = {
  id: number; name: string; bbox: Bbox; maxZoom: number;
  status: AreaStatus; tilesTotal: number; tilesDone: number; bytes: number;
  error: string | null; build: string | null; createdAt: string; updatedAt: string;
};
export type MapsView = { enabled: boolean; areas: MapArea[]; usedBytes: number; freeBytes: number | null; maxZoom: number; maxTiles: number };

export class MapsError extends Error {
  readonly status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}

/** Keep this much disk free after a download. */
const DISK_RESERVE = 500 * 1024 * 1024;
const KV_ENABLED = 'maps.offline.enabled';

type Row = { id: number; name: string; w: number; s: number; e: number; n: number; max_zoom: number; status: AreaStatus; tiles_total: number; tiles_done: number; bytes: number; error: string | null; build: string | null; created_at: string; updated_at: string };
const toArea = (r: Row): MapArea => ({
  id: r.id, name: r.name, bbox: [r.w, r.s, r.e, r.n], maxZoom: r.max_zoom, status: r.status,
  tilesTotal: r.tiles_total, tilesDone: r.tiles_done, bytes: r.bytes, error: r.error, build: r.build, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class MapsService {
  readonly db: DatabaseSync;
  private running: number | null = null;
  private stop = new Set<number>();
  private refresh = new Set<number>();
  private q: { has: ReturnType<DatabaseSync['prepare']>; get: ReturnType<DatabaseSync['prepare']>; put: ReturnType<DatabaseSync['prepare']> };

  private dataDir: string;
  private main: Db;
  private f: Fetcher;

  constructor(dataDir: string, main: Db, f: Fetcher = fetch) {
    this.dataDir = dataDir; this.main = main; this.f = f;
    const db = new DatabaseSync(path.join(dataDir, 'maps.db'));
    // auto_vacuum must be set before the first table: deleting an area then gives the space back.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        w REAL NOT NULL, s REAL NOT NULL, e REAL NOT NULL, n REAL NOT NULL, max_zoom INTEGER NOT NULL,
        status TEXT NOT NULL, tiles_total INTEGER NOT NULL DEFAULT 0, tiles_done INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0, error TEXT, build TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tiles (z INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (z, x, y)) WITHOUT ROWID;
    `);
    this.db = db;
    this.q = {
      has: db.prepare('SELECT 1 FROM tiles WHERE z = ? AND x = ? AND y = ?'),
      get: db.prepare('SELECT data FROM tiles WHERE z = ? AND x = ? AND y = ?'),
      put: db.prepare('INSERT OR REPLACE INTO tiles (z, x, y, data) VALUES (?, ?, ?, ?)'),
    };
    // A download the last run didn't finish carries on.
    db.prepare("UPDATE areas SET status = 'queued' WHERE status = 'downloading'").run();
  }

  start() { this.kick(); }
  close() { for (const a of this.areas()) this.stop.add(a.id); this.db.close(); }

  get enabled(): boolean { return kvGet<boolean>(this.main, KV_ENABLED) ?? true; }
  setEnabled(on: boolean) { kvSet(this.main, KV_ENABLED, on); }

  areas(): MapArea[] { return (this.db.prepare('SELECT * FROM areas ORDER BY id').all() as Row[]).map(toArea); }
  area(id: number): MapArea | null { const r = this.db.prepare('SELECT * FROM areas WHERE id = ?').get(id) as Row | undefined; return r ? toArea(r) : null; }

  view(): MapsView {
    const pages = (k: string) => Number((this.db.prepare(`PRAGMA ${k}`).get() as Record<string, number>)[k]);
    let freeBytes: number | null = null;
    try { const s = statfsSync(this.dataDir); freeBytes = s.bavail * s.bsize; } catch { /* not every filesystem says */ }
    return { enabled: this.enabled, areas: this.areas(), usedBytes: (pages('page_count') - pages('freelist_count')) * pages('page_size'), freeBytes, maxZoom: MAX_ZOOM, maxTiles: MAX_AREA_TILES };
  }

  tile(z: number, x: number, y: number): Uint8Array | null {
    const r = this.q.get.get(z, x, y) as { data: Uint8Array } | undefined;
    return r?.data ?? null;
  }

  add(name: string, bbox: Bbox, maxZoom: number): MapArea {
    const n = name.trim().slice(0, 60) || 'Area';
    if (!Number.isInteger(maxZoom) || maxZoom < 6 || maxZoom > MAX_ZOOM) throw new MapsError(`detail must be zoom 6 to ${MAX_ZOOM}`);
    const total = countTiles(bbox, maxZoom);
    if (total > MAX_AREA_TILES) throw new MapsError(`That's ${total.toLocaleString()} tiles: pick a smaller area or less detail (at most ${MAX_AREA_TILES.toLocaleString()})`);
    const now = new Date().toISOString();
    const r = this.db.prepare("INSERT INTO areas (name, w, s, e, n, max_zoom, status, tiles_total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)")
      .run(n, bbox[0], bbox[1], bbox[2], bbox[3], maxZoom, total, now, now);
    this.kick();
    return this.area(Number(r.lastInsertRowid))!;
  }

  /** Download again: `fresh` re-fetches every tile (a newer map); otherwise only what's missing (retry, resume). */
  download(id: number, fresh: boolean): MapArea {
    const a = this.area(id);
    if (!a) throw new MapsError('no such area', 404);
    if (a.status === 'downloading' || a.status === 'queued') return a;
    if (fresh) this.refresh.add(id);
    this.set(id, { status: 'queued', error: null });
    this.kick();
    return this.area(id)!;
  }

  remove(id: number): boolean {
    const a = this.area(id);
    if (!a) return false;
    this.stop.add(id);
    this.db.prepare('DELETE FROM areas WHERE id = ?').run(id);
    this.dropTiles(a);
    return true;
  }

  /** Delete the area's tiles that no other area also covers, and give the space back. */
  private dropTiles(a: MapArea) {
    const others = this.areas();
    for (let z = 0; z <= a.maxZoom; z++) {
      const r = tileRange(a.bbox, z);
      let sql = 'DELETE FROM tiles WHERE z = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?';
      const args: number[] = [z, r.x0, r.x1, r.y0, r.y1];
      for (const o of others) {
        if (o.maxZoom < z) continue;
        const k = tileRange(o.bbox, z);
        sql += ' AND NOT (x BETWEEN ? AND ? AND y BETWEEN ? AND ?)';
        args.push(k.x0, k.x1, k.y0, k.y1);
      }
      this.db.prepare(sql).run(...args);
    }
    this.db.exec('PRAGMA incremental_vacuum;');
  }

  private set(id: number, p: Partial<{ status: AreaStatus; tiles_total: number; tiles_done: number; bytes: number; error: string | null; build: string | null }>) {
    const keys = Object.keys(p);
    if (!keys.length) return;
    this.db.prepare(`UPDATE areas SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => (p as Record<string, string | number | null>)[k]), new Date().toISOString(), id);
  }

  private kick() {
    if (this.running !== null) return;
    const next = this.areas().find((a) => a.status === 'queued');
    if (!next) return;
    this.running = next.id;
    void this.run(next).finally(() => { this.running = null; this.stop.delete(next.id); setImmediate(() => this.kick()); });
  }

  private async run(a: MapArea) {
    const fresh = this.refresh.delete(a.id);
    const stopped = () => this.stop.has(a.id);
    try {
      this.set(a.id, { status: 'downloading', error: null });
      const build = await latestBuild(this.f);
      const arc = new RemoteArchive(BUILD_HOST + build, this.f);
      await arc.open();
      if (!arc.gzipTiles) throw new Error('The map build is not gzip-compressed tiles');
      const total = countTiles(a.bbox, a.maxZoom);
      const wanted = wantedTiles(a.bbox, a.maxZoom, fresh ? undefined : (z, x, y) => this.q.has.get(z, x, y) !== undefined);
      const located = await arc.locate(wanted);
      if (stopped()) return;
      // Slots already on disk, and slots the map has nothing for (empty sea, outside the data), count as done.
      let done = total - located.length;
      const chunks = chunk(located);
      const need = chunks.reduce((s, c) => s + c.length, 0);
      try {
        const s = statfsSync(this.dataDir);
        if (s.bavail * s.bsize < need + DISK_RESERVE) throw new MapsError(`Not enough space: this needs about ${mb(need)}, ${mb(s.bavail * s.bsize)} is free (keeping ${mb(DISK_RESERVE)} spare)`);
      } catch (e) { if (e instanceof MapsError) throw e; }
      let bytes = fresh ? 0 : a.bytes;
      this.set(a.id, { tiles_total: total, tiles_done: done, build });
      await arc.fetchChunks(chunks, (tiles, n) => {
        this.db.exec('BEGIN');
        try { for (const t of tiles) this.q.put.run(t.z, t.x, t.y, t.data); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
        done += tiles.length; bytes += n;
        this.set(a.id, { tiles_done: done, bytes });
      }, stopped);
      if (stopped()) return;
      this.set(a.id, { status: 'ready', tiles_done: total, bytes, error: null });
      console.log(`[maps] ${a.name}: ${total} tiles, ${mb(bytes)} (build ${build})`);
    } catch (e) {
      if (stopped()) return;
      const msg = (e as Error).message;
      console.warn(`[maps] ${a.name}: ${msg}`);
      this.set(a.id, { status: 'error', error: /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|timeout|aborted/i.test(msg) ? `No connection to the map server (${msg}). Retry when the truck is online.` : msg });
    }
  }
}

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
