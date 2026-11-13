// Offline maps: read just the part of a remote PMTiles v3 archive (Protomaps'
// daily OpenStreetMap build) that covers an area, with HTTP range requests.
// Same idea as `pmtiles extract`: walk the directories for the wanted tile IDs,
// then fetch the tile bytes in a few large, merged ranges instead of one
// request per tile.
import { gunzipSync } from 'node:zlib';
import { bytesToHeader, findTile, readVarint, zxyToTileId } from 'pmtiles';
import { tileRange, type Bbox } from './tiles.ts';

type Entry = { tileId: number; offset: number; length: number; runLength: number };
type Header = ReturnType<typeof bytesToHeader>;

/** Where the daily builds are listed, and served from. */
export const BUILDS_URL = 'https://build-metadata.protomaps.dev/builds.json';
export const BUILD_HOST = 'https://build.protomaps.com/';

/** Merge tile ranges closer than this, and stop a merged request at this size. */
const GAP = 64 * 1024;
const CHUNK = 4 * 1024 * 1024;
const COMPRESSION_GZIP = 2;
const TILETYPE_MVT = 1;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The newest build's file name, e.g. 20261113.pmtiles. */
export async function latestBuild(f: Fetcher = fetch): Promise<string> {
  const r = await f(BUILDS_URL, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Protomaps build list: HTTP ${r.status}`);
  const list = (await r.json()) as { key?: unknown }[];
  const keys = list.map((b) => b.key).filter((k): k is string => typeof k === 'string' && /^\d{8}\.pmtiles$/.test(k)).sort();
  if (!keys.length) throw new Error('Protomaps build list is empty');
  return keys[keys.length - 1];
}

/** A PMTiles directory (v3): varint count, then delta tile IDs, run lengths, lengths and offsets. */
export function decodeDirectory(buf: Uint8Array): Entry[] {
  const p = { buf, pos: 0 };
  const n = readVarint(p);
  const out: Entry[] = [];
  let id = 0;
  for (let i = 0; i < n; i++) { id += readVarint(p); out.push({ tileId: id, offset: 0, length: 0, runLength: 1 }); }
  for (let i = 0; i < n; i++) out[i].runLength = readVarint(p);
  for (let i = 0; i < n; i++) out[i].length = readVarint(p);
  for (let i = 0; i < n; i++) {
    const v = readVarint(p);
    out[i].offset = v === 0 && i > 0 ? out[i - 1].offset + out[i - 1].length : v - 1;
  }
  return out;
}

export type WantedTile = { z: number; x: number; y: number; id: number };

/** Every tile of a bbox from zoom 0 to maxZoom, in tile-ID order, minus the ones `skip` says we have. */
export function wantedTiles(b: Bbox, maxZoom: number, skip?: (z: number, x: number, y: number) => boolean): WantedTile[] {
  const out: WantedTile[] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) if (!skip?.(z, x, y)) out.push({ z, x, y, id: zxyToTileId(z, x, y) });
  }
  return out.sort((a, b2) => a.id - b2.id);
}

export type Located = WantedTile & { offset: number; length: number };
export type Chunk = { offset: number; length: number; tiles: Located[] };

/** Group located tiles into merged byte ranges (tiles that share bytes, like open ocean, share a range). */
export function chunk(tiles: Located[], gap = GAP, max = CHUNK): Chunk[] {
  const sorted = [...tiles].sort((a, b) => a.offset - b.offset);
  const out: Chunk[] = [];
  for (const t of sorted) {
    const c = out[out.length - 1];
    const end = c ? c.offset + c.length : 0;
    if (c && t.offset <= end + gap && Math.max(end, t.offset + t.length) - c.offset <= max) {
      c.length = Math.max(end, t.offset + t.length) - c.offset;
      c.tiles.push(t);
    } else out.push({ offset: t.offset, length: t.length, tiles: [t] });
  }
  return out;
}

export class RemoteArchive {
  private header: Header | null = null;
  private root: Entry[] = [];
  private leaves = new Map<number, Promise<Entry[]>>();

  readonly url: string;
  private f: Fetcher;
  constructor(url: string, f: Fetcher = fetch) { this.url = url; this.f = f; }

  async range(offset: number, length: number): Promise<Uint8Array> {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await this.f(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: AbortSignal.timeout(120_000) });
        if (r.status !== 206 && !(r.status === 200 && offset === 0)) throw new Error(`HTTP ${r.status}`);
        const b = new Uint8Array(await r.arrayBuffer());
        if (b.length < length) throw new Error(`short read: ${b.length} of ${length} bytes`);
        return b.subarray(0, length);
      } catch (e) {
        last = e;
        await new Promise((ok) => setTimeout(ok, 1000 * 2 ** attempt));
      }
    }
    throw new Error(`Map download failed: ${(last as Error).message}`);
  }

  private dir(b: Uint8Array): Entry[] {
    return decodeDirectory(this.header!.internalCompression === COMPRESSION_GZIP ? new Uint8Array(gunzipSync(b)) : b);
  }

  async open(): Promise<Header> {
    if (this.header) return this.header;
    const first = await this.range(0, 16_384);
    const h = bytesToHeader(first.buffer.slice(first.byteOffset, first.byteOffset + first.length) as ArrayBuffer);
    if (h.specVersion !== 3) throw new Error(`Unsupported PMTiles version ${h.specVersion}`);
    if (h.tileType !== TILETYPE_MVT) throw new Error('The map build is not vector tiles');
    this.header = h;
    const rootBytes = h.rootDirectoryOffset + h.rootDirectoryLength <= first.length
      ? first.subarray(h.rootDirectoryOffset, h.rootDirectoryOffset + h.rootDirectoryLength)
      : await this.range(h.rootDirectoryOffset, h.rootDirectoryLength);
    this.root = this.dir(rootBytes);
    return h;
  }

  private leaf(e: Entry): Promise<Entry[]> {
    let p = this.leaves.get(e.offset);
    if (!p) {
      p = this.range(this.header!.leafDirectoryOffset + e.offset, e.length).then((b) => this.dir(b));
      this.leaves.set(e.offset, p);
    }
    return p;
  }

  /** Where each wanted tile's bytes are; tiles the archive doesn't have (nothing mapped there) are left out. */
  async locate(tiles: WantedTile[], parallel = 4): Promise<Located[]> {
    const h = await this.open();
    const out: Located[] = [];
    let level: { dir: Entry[]; tiles: WantedTile[] }[] = [{ dir: this.root, tiles }];
    for (let depth = 0; depth < 4 && level.length; depth++) {
      const next = new Map<number, { e: Entry; tiles: WantedTile[] }>();
      for (const { dir, tiles: ts } of level) {
        for (const t of ts) {
          const e = findTile(dir, t.id);
          if (!e) continue;
          if (e.runLength === 0) {
            const g = next.get(e.offset) ?? { e, tiles: [] };
            g.tiles.push(t);
            next.set(e.offset, g);
          } else out.push({ ...t, offset: h.tileDataOffset + e.offset, length: e.length });
        }
      }
      const groups = [...next.values()];
      level = [];
      for (let i = 0; i < groups.length; i += parallel) {
        const got = await Promise.all(groups.slice(i, i + parallel).map(async (g) => ({ dir: await this.leaf(g.e), tiles: g.tiles })));
        level.push(...got);
      }
    }
    return out;
  }

  /** Fetch the chunks, handing each one's tiles (still gzip-compressed, as served) to `save`. */
  async fetchChunks(chunks: Chunk[], save: (tiles: { z: number; x: number; y: number; data: Uint8Array }[], bytes: number) => void, stopped: () => boolean, parallel = 4): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < chunks.length && !stopped()) {
        const c = chunks[next++];
        const b = await this.range(c.offset, c.length);
        if (stopped()) return;
        save(c.tiles.map((t) => ({ z: t.z, x: t.x, y: t.y, data: b.subarray(t.offset - c.offset, t.offset - c.offset + t.length) })), c.length);
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  }

  get gzipTiles(): boolean { return this.header?.tileCompression === COMPRESSION_GZIP; }
}
