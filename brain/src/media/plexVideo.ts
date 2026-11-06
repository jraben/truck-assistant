// Plex VIDEO for the Parked screen: movies and shows, played as HLS that Plex
// transcodes to the screen's size. The browser only ever talks to the brain:
// /api/media/plex/hls/<path> is relayed to Plex's /video/:/transcode/universal/
// with the token added here, so it never reaches the page (same rule as music).
import { randomUUID } from 'node:crypto';
import { PlexError, type PlexService } from './plex.ts';

export type VideoItem = {
  key: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  subtitle: string | null;      // year, "S2 · E5", or the show
  thumb: string | null;
  durationMs: number | null;
  viewOffsetMs: number | null;  // where it was left
  watched: boolean;
};
export type VideoSection = { key: string; title: string; type: 'movie' | 'show' };

const thumbUrl = (p: unknown) => (typeof p === 'string' && p.startsWith('/library/') ? `/api/media/plex/thumb?path=${encodeURIComponent(p)}` : null);

/** One Plex Metadata entry -> a video item (movies, shows, seasons, episodes only). Pure. */
export function mapVideo(m: Record<string, unknown>): VideoItem | null {
  const type = m.type;
  if (type !== 'movie' && type !== 'show' && type !== 'season' && type !== 'episode') return null;
  if (typeof m.ratingKey !== 'string' && typeof m.ratingKey !== 'number') return null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const n = (v: unknown) => (typeof v === 'number' ? v : null);
  const subtitle = type === 'movie' ? (n(m.year) ? String(m.year) : null)
    : type === 'episode' ? [s(m.grandparentTitle), n(m.parentIndex) !== null && n(m.index) !== null ? `S${m.parentIndex} · E${m.index}` : null].filter(Boolean).join(' · ') || null
    : type === 'season' ? s(m.parentTitle)
    : n(m.childCount) !== null ? `${m.childCount} season${m.childCount === 1 ? '' : 's'}` : null;
  return {
    key: String(m.ratingKey), type, title: s(m.title) ?? '(untitled)', subtitle,
    thumb: thumbUrl(type === 'episode' ? m.thumb ?? m.grandparentThumb : m.thumb ?? m.parentThumb),
    durationMs: n(m.duration), viewOffsetMs: n(m.viewOffset),
    watched: (n(m.viewCount) ?? 0) > 0 || (type !== 'movie' && type !== 'episode' && n(m.leafCount) !== null && n(m.leafCount) === n(m.viewedLeafCount)),
  };
}
export function mapVideoList(j: unknown): VideoItem[] {
  const md = (j as { MediaContainer?: { Metadata?: unknown[] } } | null)?.MediaContainer?.Metadata;
  return Array.isArray(md) ? md.map((m) => (m && typeof m === 'object' ? mapVideo(m as Record<string, unknown>) : null)).filter((x): x is VideoItem => !!x) : [];
}

/** The query that starts a Plex HLS transcode for a 1920x720 screen. Pure. */
export function startQuery(key: string, session: string, o: { maxKbps: number; offsetMs: number }): string {
  return new URLSearchParams({
    path: `/library/metadata/${key}`, mediaIndex: '0', partIndex: '0', protocol: 'hls', fastSeek: '1',
    directPlay: '0', directStream: '1', directStreamAudio: '1', subtitleSize: '100', audioBoost: '100',
    videoResolution: '1920x1080', maxVideoBitrate: String(o.maxKbps), videoQuality: '100',
    offset: String(Math.max(0, Math.round(o.offsetMs / 1000))), session, 'X-Plex-Session-Identifier': session,
    location: 'wan', copyts: '1', mediaBufferSize: '102400', 'X-Plex-Platform': 'Chrome',
  }).toString();
}

/** Only paths Plex's own playlists point at may be relayed. Pure. */
export const okHlsPath = (p: string) => /^(start\.m3u8|session\/[\w-]+\/[\w-]+\/[\w./-]+)$/.test(p) && !p.includes('..');

export class PlexVideo {
  private plex: PlexService;
  constructor(plex: PlexService) { this.plex = plex; }

  private async json(p: string): Promise<unknown> { return (await this.plex.raw(p)).json(); }

  async sections(): Promise<VideoSection[]> {
    const j = await this.json('/library/sections') as { MediaContainer?: { Directory?: { key: string; title: string; type: string }[] } };
    return (j.MediaContainer?.Directory ?? []).filter((d) => d.type === 'movie' || d.type === 'show').map((d) => ({ key: String(d.key), title: d.title, type: d.type as 'movie' | 'show' }));
  }
  async all(section: string): Promise<VideoItem[]> { return mapVideoList(await this.json(`/library/sections/${encodeURIComponent(section)}/all?sort=titleSort`)); }
  async recent(section: string): Promise<VideoItem[]> { return mapVideoList(await this.json(`/library/sections/${encodeURIComponent(section)}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=40`)); }
  async onDeck(): Promise<VideoItem[]> { return mapVideoList(await this.json('/library/onDeck')); }
  async children(key: string): Promise<VideoItem[]> { return mapVideoList(await this.json(`/library/metadata/${encodeURIComponent(key)}/children`)); }
  async search(q: string): Promise<VideoItem[]> {
    const j = await this.json(`/hubs/search?query=${encodeURIComponent(q.slice(0, 80))}&limit=20`) as { MediaContainer?: { Hub?: { Metadata?: unknown[] }[] } };
    return mapVideoList({ MediaContainer: { Metadata: (j.MediaContainer?.Hub ?? []).flatMap((h) => h.Metadata ?? []) } });
  }

  /** A new transcode session; the player loads the returned brain URL. */
  start(key: string, offsetMs = 0, maxKbps = 4000): { url: string; session: string } {
    if (!/^\d+$/.test(key)) throw new PlexError('bad item', 400);
    const session = randomUUID();
    return { url: `/api/media/plex/hls/start.m3u8?${startQuery(key, session, { maxKbps, offsetMs })}`, session };
  }

  /** Relay one HLS file (playlist or segment) from Plex's universal transcoder. */
  async hls(path: string, query: string): Promise<Response> {
    if (!okHlsPath(path)) throw new PlexError('bad HLS path', 400);
    return this.plex.raw(`/video/:/transcode/universal/${path}${query ? `?${query}` : ''}`, { headers: { accept: '*/*' } }, 60_000);
  }

  /** Tell Plex where playback is, so "continue watching" works on the TV too. */
  async timeline(key: string, state: 'playing' | 'paused' | 'stopped', timeMs: number, durationMs: number, session: string) {
    const q = new URLSearchParams({ ratingKey: key, key: `/library/metadata/${key}`, state, time: String(Math.round(timeMs)), duration: String(Math.round(durationMs)), 'X-Plex-Session-Identifier': session });
    await this.plex.raw(`/:/timeline?${q}`).catch(() => {});
    if (state === 'stopped') await this.plex.raw(`/video/:/transcode/universal/stop?session=${encodeURIComponent(session)}`).catch(() => {});
  }
}
