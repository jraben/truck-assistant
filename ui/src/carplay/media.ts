// Now playing, built up from the dongle's MediaData packets. Pure.
// The dongle sends partial JSON updates (often just the play position), so
// each packet is merged into what we already know.

export type NowPlaying = {
  title: string | null;
  artist: string | null;
  album: string | null;
  app: string | null;            // the phone app playing it, e.g. "Spotify"
  durationMs: number | null;
  positionMs: number | null;
  positionAt: number | null;     // Date.now() when positionMs was reported, to tick it locally
  art: string | null;            // data: URL; stays in the UI, never sent to the brain or MQTT
};

export const emptyNowPlaying = (): NowPlaying => ({ title: null, artist: null, album: null, app: null, durationMs: null, positionMs: null, positionAt: null, art: null });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Merge one MediaData payload ({type: 1, media} or {type: 3, base64Image}). */
export function mergeMedia(prev: NowPlaying, payload: unknown, now = Date.now()): NowPlaying {
  if (!payload || typeof payload !== 'object') return prev;
  const p = payload as { type?: number; media?: Record<string, unknown>; base64Image?: string };
  if (p.type === 3 && typeof p.base64Image === 'string' && p.base64Image) {
    return { ...prev, art: `data:${sniffImage(p.base64Image)};base64,${p.base64Image}` };
  }
  if (p.type !== 1 || !p.media || typeof p.media !== 'object') return prev;
  const m = p.media;
  const next = { ...prev };
  const title = 'MediaSongName' in m ? str(m.MediaSongName) : undefined;
  if (title !== undefined && title !== prev.title) {
    // A new song: forget the old position, duration and cover until the dongle sends the new ones.
    next.title = title;
    next.durationMs = null; next.positionMs = null; next.positionAt = null; next.art = null;
  }
  if ('MediaArtistName' in m) next.artist = str(m.MediaArtistName);
  if ('MediaAlbumName' in m) next.album = str(m.MediaAlbumName);
  if ('MediaAPPName' in m) next.app = str(m.MediaAPPName);
  if ('MediaSongDuration' in m) next.durationMs = num(m.MediaSongDuration);
  if ('MediaSongPlayTime' in m) { next.positionMs = num(m.MediaSongPlayTime); next.positionAt = next.positionMs === null ? null : now; }
  return next;
}

/** JPEG unless the bytes say PNG. */
function sniffImage(b64: string): string {
  return b64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
}

/** Position now, ticking from the last report (capped at the duration). */
export function livePosition(np: NowPlaying, now = Date.now()): number | null {
  if (np.positionMs === null || np.positionAt === null) return np.positionMs;
  const p = np.positionMs + (now - np.positionAt);
  return np.durationMs ? Math.min(p, np.durationMs) : p;
}

/** The part the brain gets (contract: client message {"type":"media"}). Album art stays out. */
export function brainMedia(np: NowPlaying | null): { type: 'media'; title: string | null; artist: string | null; album: string | null } {
  if (!np || (!np.title && !np.artist)) return { type: 'media', title: null, artist: null, album: null };
  return { type: 'media', title: np.title, artist: np.artist, album: np.album };
}

export const fmtClock = (ms: number | null) => {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
