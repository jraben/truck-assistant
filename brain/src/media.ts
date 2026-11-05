// Now playing, as reported by the cockpit UI (WS {"type":"media"}): CarPlay's
// MediaData, or what the Media view's own player is playing (internet radio,
// AM/FM, Plex, local files), plus Spotify Connect from the brain itself.
// Text only: album art never reaches the brain's State or MQTT.
import type { NowPlaying, NowPlayingSource } from './types.ts';

const MAX = 200;
const text = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX);
  return t || null;
};

export const NOW_PLAYING_SOURCES: readonly NowPlayingSource[] = ['carplay', 'spotify', 'radio', 'fm', 'plex', 'local'];

/**
 * {"type":"media","title","artist","album","source"?} -> NowPlaying, or null
 * when nothing is playing (no title and no artist). undefined = malformed,
 * ignore it. No source = 'carplay' (the original message).
 */
export function parseMediaMessage(m: Record<string, unknown>): NowPlaying | null | undefined {
  const title = text(m.title), artist = text(m.artist), album = text(m.album);
  if (title === undefined || artist === undefined || album === undefined) return undefined;
  const source = m.source === undefined || m.source === null ? 'carplay' : m.source;
  if (!NOW_PLAYING_SOURCES.includes(source as NowPlayingSource)) return undefined;
  if (!title && !artist) return null;
  return { title, artist, album, source: source as NowPlayingSource };
}

/** Which source a {"type":"media"} message is about (for clearing it), or undefined when malformed. */
export function mediaSourceOf(m: Record<string, unknown>): NowPlayingSource | undefined {
  const s = m.source === undefined || m.source === null ? 'carplay' : m.source;
  return NOW_PLAYING_SOURCES.includes(s as NowPlayingSource) ? s as NowPlayingSource : undefined;
}

export const sameNowPlaying = (a: NowPlaying | null, b: NowPlaying | null) =>
  a === b || (!!a && !!b && a.title === b.title && a.artist === b.artist && a.album === b.album && a.source === b.source);

/**
 * One now-playing out of many reporters. Each reporter (a cockpit socket and
 * source, or the brain's Spotify poller) keeps its own latest report; State
 * shows the most recently started one, falling back to the next when it
 * stops. A screen with no CarPlay saying "nothing" never clears another
 * screen's report.
 */
export class NowPlayingHub {
  private reports = new Map<string, { np: NowPlaying; at: number }>();
  private seq = 0;
  private emit: (np: NowPlaying | null) => void;

  constructor(emit: (np: NowPlaying | null) => void) { this.emit = emit; }

  /** A report; null = that reporter has stopped. A new song from the same reporter keeps its place in line. */
  report(key: string, np: NowPlaying | null) {
    const cur = this.reports.get(key);
    if (np === null) { if (!cur) return; this.reports.delete(key); }
    else if (cur && sameNowPlaying(cur.np, np)) return;
    else this.reports.set(key, { np, at: cur ? cur.at : ++this.seq });
    this.emit(this.current());
  }

  /** Every report whose key starts with `prefix` is gone (a socket closed). */
  dropPrefix(prefix: string) {
    let changed = false;
    for (const k of [...this.reports.keys()]) if (k.startsWith(prefix)) { this.reports.delete(k); changed = true; }
    if (changed) this.emit(this.current());
  }

  current(): NowPlaying | null {
    let best: { np: NowPlaying; at: number } | null = null;
    for (const r of this.reports.values()) if (!best || r.at > best.at) best = r;
    return best ? { ...best.np } : null;
  }
}
