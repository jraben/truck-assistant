// The Media view's sources: what each tile is called, its artwork (original
// monogram tiles in ./art, not the services' logos), and, for the services a
// web page can't play, how the cockpit hands off to them instead.
import spotifyArt from './art/spotify.svg';
import pandoraArt from './art/pandora.svg';
import ytmusicArt from './art/ytmusic.svg';
import amazonArt from './art/amazonmusic.svg';
import plexArt from './art/plex.svg';
import radioArt from './art/radio.svg';
import fmArt from './art/fm.svg';
import filesArt from './art/files.svg';
import { androidIntent } from '../lib/nav.ts';

export type SourceId = 'spotify' | 'pandora' | 'ytmusic' | 'amazon' | 'plex' | 'radio' | 'fm' | 'local';

/** A service with no playback API a web page can use: the tile opens its app or web player, and shows what the phone reports. */
export type HandOff = {
  /** Android package, opened through Fully Kiosk's JavaScript interface on the tablet. */
  androidPackage: string;
  web: string;
  /** Matches the app name the phone reports through CarPlay (NowPlaying.app). */
  app: RegExp;
  why: string;
};

/** `short`: the name under a small tile, where the full one won't fit. */
export type Source = { id: SourceId; label: string; short?: string; art: string; handOff?: HandOff };

export const SOURCES: Source[] = [
  {
    id: 'spotify', label: 'Spotify', art: spotifyArt,
    handOff: { androidPackage: 'com.spotify.music', web: 'https://open.spotify.com', app: /spotify/i, why: '' },
  },
  {
    id: 'pandora', label: 'Pandora', art: pandoraArt,
    handOff: { androidPackage: 'com.pandora.android', web: 'https://www.pandora.com', app: /pandora/i, why: 'Pandora has no public playback API that a web page can use.' },
  },
  {
    id: 'ytmusic', label: 'YouTube Music', short: 'YT Music', art: ytmusicArt,
    handOff: { androidPackage: 'com.google.android.apps.youtube.music', web: 'https://music.youtube.com', app: /youtube\s*music|yt\s*music/i, why: 'YouTube Music has no public playback API that a web page can use.' },
  },
  {
    id: 'amazon', label: 'Amazon Music', short: 'Amazon', art: amazonArt,
    handOff: { androidPackage: 'com.amazon.mp3', web: 'https://music.amazon.com', app: /amazon\s*music/i, why: 'Amazon Music has no public playback API that a web page can use.' },
  },
  { id: 'plex', label: 'Plex', art: plexArt },
  { id: 'radio', label: 'Radio', art: radioArt },
  { id: 'fm', label: 'AM/FM', art: fmArt },
  { id: 'local', label: 'Files', art: filesArt },
];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id) ?? null;
export const isSourceId = (id: string | null): id is SourceId => !!id && SOURCES.some((s) => s.id === id);

/** Art for a Shortcuts tile that has no cover of its own. */
export const KIND_ART: Record<string, string> = { 'AM/FM': fmArt, Radio: radioArt, Spotify: spotifyArt, Plex: plexArt };

/** Does the phone's now-playing (via CarPlay) come from this hand-off service? Pure. */
export function phonePlaying<T extends { app: string | null; title: string | null; artist: string | null }>(h: HandOff | undefined, np: T | null): T | null {
  if (!h || !np || !np.app || !(np.title || np.artist)) return null;
  return h.app.test(np.app) ? np : null;
}

type Fully = { startApplication?: (pkg: string) => void };
/** Fully Kiosk's JavaScript interface (tablet), when it is switched on. */
export const fully = (): Fully | null => ((globalThis as { fully?: Fully }).fully ?? null);

/**
 * The link that opens the service's own app on the dash tablet (Chrome on Android):
 * its web address handed to that app by package, and the Play Store if it isn't installed. Pure.
 */
export const tabletAppLink = (h: HandOff): string => androidIntent(h.web, { package: h.androidPackage, fallbackPackage: h.androidPackage });
/** This page is on an Android tablet or phone (the dash tablet), where tabletAppLink opens the app. */
export const onAndroid = (): boolean => { try { return /Android/i.test(navigator.userAgent); } catch { return false; } };
