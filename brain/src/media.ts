// Now playing, as reported by the cockpit UI from CarPlay's MediaData
// (WS {"type":"media"}). Text only: album art never reaches the brain or MQTT.
import type { NowPlaying } from './types.ts';

const MAX = 200;
const text = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX);
  return t || null;
};

/**
 * {"type":"media","title","artist","album"} -> NowPlaying, or null when nothing
 * is playing (no title and no artist). undefined = malformed, ignore it.
 */
export function parseMediaMessage(m: Record<string, unknown>): NowPlaying | null | undefined {
  const title = text(m.title), artist = text(m.artist), album = text(m.album);
  if (title === undefined || artist === undefined || album === undefined) return undefined;
  if (!title && !artist) return null;
  return { title, artist, album, source: 'carplay' };
}

export const sameNowPlaying = (a: NowPlaying | null, b: NowPlaying | null) =>
  a === b || (!!a && !!b && a.title === b.title && a.artist === b.artist && a.album === b.album && a.source === b.source);
