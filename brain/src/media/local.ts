// Local files: music on the Pi's SSD (DATA_DIR/music unless set otherwise),
// browsed by folder and played by the cockpit's <audio>. Works offline.
// Titles come from the path ("Artist/Album/03 - Title.mp3"); tags aren't read.
import { createReadStream, mkdirSync, promises as fsp } from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm',
};

import type { LocalListing, LocalTrack } from './types.ts';
export type { LocalEntry, LocalListing, LocalTrack } from './types.ts';

export class LocalError extends Error {
  status: number;
  constructor(m: string, status = 400) { super(m); this.status = status; }
}

/** "Artist/Album/03 - Title.mp3" (relative, forward slashes) -> what to show. Pure. */
export function trackInfo(rel: string): { title: string; artist: string | null; album: string | null } {
  const parts = rel.split('/').filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  let base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  base = base.replace(/^(\d{1,3}|[A-Z]?\d{1,2})[\s.-]+(?=\S)/, '').trim(); // "03 - ", "1-02 "
  let artist = parts.length >= 3 ? parts[parts.length - 3] : null;
  const album = parts.length >= 2 ? parts[parts.length - 2] : null;
  const dash = base.indexOf(' - ');
  if (dash > 0 && (!artist || parts.length < 3)) { artist = base.slice(0, dash).trim(); base = base.slice(dash + 3).trim(); }
  return { title: base || file, artist, album };
}

/** A path inside root, or a LocalError. `rel` is what the UI sends back ("" = the root). */
export function safeJoin(root: string, rel: string): string {
  const clean = (rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.split('/').some((p) => p === '..')) throw new LocalError('no such folder', 404);
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new LocalError('no such folder', 404);
  return abs;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class LocalService {
  private rootFn: () => string;
  constructor(root: () => string) { this.rootFn = root; }

  root(): string {
    const r = path.resolve(this.rootFn());
    try { mkdirSync(r, { recursive: true }); } catch { /* reported by list() */ }
    return r;
  }

  async list(rel = ''): Promise<LocalListing> {
    const root = this.root();
    const abs = safeJoin(root, rel);
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); }
    catch { throw new LocalError(rel ? 'no such folder' : `The music folder ${root} can't be read`, 404); }
    const relOf = (n: string) => path.relative(root, path.join(abs, n)).split(path.sep).join('/');
    const dirs = ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => ({ name: e.name, path: relOf(e.name) })).sort((a, b) => collator.compare(a.name, b.name));
    const files: LocalTrack[] = [];
    for (const e of ents) {
      if (!e.isFile() || !(path.extname(e.name).toLowerCase() in AUDIO_EXT)) continue;
      const p = relOf(e.name);
      let size = 0;
      try { size = (await fsp.stat(path.join(abs, e.name))).size; } catch { continue; }
      files.push({ name: e.name, path: p, size, ...trackInfo(p) });
    }
    files.sort((a, b) => collator.compare(a.name, b.name));
    const here = path.relative(root, abs).split(path.sep).join('/');
    return { root, path: here, parent: here ? here.split('/').slice(0, -1).join('/') : null, dirs, files };
  }

  /** A file to send, with an optional byte range ("bytes=100-"). */
  async open(rel: string, range: string | undefined) {
    const abs = safeJoin(this.root(), rel);
    const type = AUDIO_EXT[path.extname(abs).toLowerCase()];
    if (!type) throw new LocalError('not an audio file', 404);
    let st;
    try { st = await fsp.stat(abs); } catch { throw new LocalError('no such file', 404); }
    if (!st.isFile()) throw new LocalError('no such file', 404);
    const r = parseRange(range, st.size);
    if (r === 'bad') return { status: 416, type, size: st.size, start: 0, end: -1, stream: null };
    const [start, end] = r ?? [0, st.size - 1];
    return { status: r ? 206 : 200, type, size: st.size, start, end, stream: createReadStream(abs, { start, end }) };
  }
}

/** "bytes=a-b" -> [a, b] within size; null = no range; 'bad' = unsatisfiable. Pure. */
export function parseRange(h: string | undefined, size: number): [number, number] | null | 'bad' {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number, end: number;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return 'bad';
  return [start, end];
}
