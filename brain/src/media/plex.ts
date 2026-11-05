// Plex: Jeff's own music library (over home Wi-Fi or Tailscale), with the
// server address and an X-Plex-Token entered on /settings. The token never
// leaves the brain: the cockpit plays /api/media/plex/track/<key> and the
// brain relays the file (Range requests included, so seeking works).
import type { MediaSettings } from './settings.ts';

export type PlexItem = {
  key: string;                      // ratingKey
  type: 'artist' | 'album' | 'track' | 'playlist';
  title: string;
  subtitle: string | null;          // album: artist; track: artist · album
  artist: string | null; album: string | null;
  thumb: string | null;             // brain URL, never a Plex URL with the token
  durationMs: number | null;
  index: number | null;             // track number
};
export type PlexSection = { key: string; title: string };

export class PlexError extends Error {
  status: number;
  constructor(m: string, status = 502) { super(m); this.status = status; }
}

const thumbUrl = (p: unknown) => (typeof p === 'string' && p.startsWith('/library/') ? `/api/media/plex/thumb?path=${encodeURIComponent(p)}` : null);

/** One Metadata entry from Plex JSON -> PlexItem (music types only). */
export function mapPlexItem(m: Record<string, unknown>): PlexItem | null {
  const type = m.type;
  if (type !== 'artist' && type !== 'album' && type !== 'track' && type !== 'playlist') return null;
  if (typeof m.ratingKey !== 'string' && typeof m.ratingKey !== 'number') return null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const artist = type === 'track' ? s(m.originalTitle) ?? s(m.grandparentTitle) : type === 'album' ? s(m.parentTitle) : type === 'artist' ? s(m.title) : null;
  const album = type === 'track' ? s(m.parentTitle) : type === 'album' ? s(m.title) : null;
  return {
    key: String(m.ratingKey), type, title: s(m.title) ?? '(untitled)',
    subtitle: type === 'track' ? [artist, album].filter(Boolean).join(' · ') || null : type === 'album' ? artist : type === 'playlist' ? (typeof m.leafCount === 'number' ? `${m.leafCount} tracks` : null) : null,
    artist, album,
    thumb: thumbUrl(m.thumb ?? m.parentThumb ?? m.grandparentThumb ?? m.composite),
    durationMs: typeof m.duration === 'number' ? m.duration : null,
    index: typeof m.index === 'number' ? m.index : null,
  };
}

export function mapPlexList(j: unknown): PlexItem[] {
  const md = (j as { MediaContainer?: { Metadata?: unknown[] } } | null)?.MediaContainer?.Metadata;
  return Array.isArray(md) ? md.map((m) => (m && typeof m === 'object' ? mapPlexItem(m as Record<string, unknown>) : null)).filter((x): x is PlexItem => !!x) : [];
}

export class PlexService {
  private media: () => MediaSettings;
  private clientId: () => string;
  private parts = new Map<string, string>();     // ratingKey -> part key (/library/parts/…)

  constructor(media: () => MediaSettings, clientId: () => string) { this.media = media; this.clientId = clientId; }

  configured() { const p = this.media().plex; return !!(p.url && p.token); }

  private cfg() {
    const p = this.media().plex;
    if (!p.url || !p.token) throw new PlexError('Enter the Plex server address and token on the settings page (Media and WOPR).', 503);
    return { url: p.url, token: p.token };
  }

  headers(): Record<string, string> {
    return { accept: 'application/json', 'x-plex-token': this.cfg().token, 'x-plex-product': 'Slate Cockpit', 'x-plex-client-identifier': this.clientId() };
  }

  async raw(p: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
    const { url } = this.cfg();
    let r: Response;
    try { r = await fetch(url + p, { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> ?? {}) }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new PlexError(`Can't reach Plex at ${url} (${(e as Error).message}). Away from home it needs Tailscale or remote access.`, 502); }
    if (r.status === 401) throw new PlexError('Plex refused the token: get a fresh X-Plex-Token and enter it on the settings page.', 401);
    if (!r.ok && r.status !== 206) throw new PlexError(`Plex answered ${r.status}`, r.status === 404 ? 404 : 502);
    return r;
  }

  private async json(p: string): Promise<unknown> { return (await this.raw(p)).json(); }

  async sections(): Promise<PlexSection[]> {
    const j = await this.json('/library/sections') as { MediaContainer?: { Directory?: { key: string; title: string; type: string }[] } };
    return (j.MediaContainer?.Directory ?? []).filter((d) => d.type === 'artist').map((d) => ({ key: String(d.key), title: d.title }));
  }

  async artists(section: string): Promise<PlexItem[]> { return mapPlexList(await this.json(`/library/sections/${encodeURIComponent(section)}/all?type=8&sort=titleSort`)); }
  async recent(section: string): Promise<PlexItem[]> { return mapPlexList(await this.json(`/library/sections/${encodeURIComponent(section)}/recentlyAdded?type=9&X-Plex-Container-Start=0&X-Plex-Container-Size=30`)); }
  async playlists(): Promise<PlexItem[]> { return mapPlexList(await this.json('/playlists?playlistType=audio')); }

  async children(key: string, type?: string): Promise<PlexItem[]> {
    const p = type === 'playlist' ? `/playlists/${encodeURIComponent(key)}/items` : `/library/metadata/${encodeURIComponent(key)}/children`;
    const items = mapPlexList(await this.json(p));
    return items;
  }

  async search(q: string): Promise<PlexItem[]> {
    const j = await this.json(`/hubs/search?query=${encodeURIComponent(q.slice(0, 80))}&limit=12`) as { MediaContainer?: { Hub?: { Metadata?: unknown[] }[] } };
    const md = (j.MediaContainer?.Hub ?? []).flatMap((h) => h.Metadata ?? []);
    return mapPlexList({ MediaContainer: { Metadata: md } });
  }

  /** The file behind a track (cached). */
  async partKey(key: string): Promise<string> {
    const c = this.parts.get(key);
    if (c) return c;
    const j = await this.json(`/library/metadata/${encodeURIComponent(key)}`) as { MediaContainer?: { Metadata?: { Media?: { Part?: { key?: string }[] }[] }[] } };
    const part = j.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key;
    if (!part || !part.startsWith('/library/parts/')) throw new PlexError('That track has no playable file', 404);
    if (this.parts.size > 2000) this.parts.clear();
    this.parts.set(key, part);
    return part;
  }

  /** The audio, relayed with the caller's Range header. */
  async stream(key: string, range: string | undefined): Promise<Response> {
    const part = await this.partKey(key);
    return this.raw(part, { headers: range ? { range } : {} }, 30_000);
  }

  async thumb(p: string): Promise<Response> {
    if (!/^\/library\/[\w/.-]+$/.test(p)) throw new PlexError('bad thumb path', 400);
    return this.raw(`/photo/:/transcode?width=240&height=240&minSize=1&upscale=1&url=${encodeURIComponent(p)}`, { headers: { accept: 'image/*' } });
  }
}
