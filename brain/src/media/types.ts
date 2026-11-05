// Track B shapes shared by the brain and the cockpit UI (docs/contract.md,
// "Track B: Media and WOPR"). Types only: no Node APIs, so the UI can import it.

export type RadioStation = {
  id: string;                       // Radio Browser stationuuid, or "preset:kjef"
  name: string;
  url: string;                      // what to play (url_resolved when Radio Browser has one)
  homepage: string | null;
  favicon: string | null;
  tags: string[];
  country: string | null;
  codec: string | null;
  bitrate: number | null;           // kbps; 0/unknown = null
  hls: boolean;
};

export type FmPreset = { mhz: number; name: string };

export type SpotifyToken = { access: string; refresh: string; expiresAt: number; scope: string; user: string | null };

export type MediaSettings = {
  wopr: { url: string | null; username: string; password?: string };
  spotify: {
    clientId: string | null;        // each owner's own free developer app (developer.spotify.com)
    deviceName: string;             // the truck as a Spotify Connect speaker (librespot --name)
    connect: boolean;               // run librespot on the Pi when it is installed
    bitrate: 96 | 160 | 320;
    tokens: Record<string, SpotifyToken>;   // driverId -> tokens; never sent to the UI
  };
  plex: { url: string | null; token?: string };
  radio: { kjefUrl: string; favourites: Record<string, RadioStation[]> };
  fm: { presets: FmPreset[]; ppm: number; gain: number | null };
  local: { folder: string | null };  // null = DATA_DIR/music
  receipts: { autoImport: boolean };
};

/** What GET /api/media/settings returns: secrets masked, Spotify tokens reduced to who is connected. */
export type MaskedMediaSettings = Omit<MediaSettings, 'spotify'> & {
  spotify: Omit<MediaSettings['spotify'], 'tokens'> & { connected: Record<string, { user: string | null }> };
};

export type SpotifyDevice = { id: string; name: string; type: string; active: boolean; volume: number | null };
export type SpotifyPlayback = {
  playing: boolean; title: string | null; artist: string | null; album: string | null; art: string | null;
  durationMs: number | null; positionMs: number | null; device: SpotifyDevice | null; context: string | null;
};
export type SpotifyPlaylist = { id: string; uri: string; name: string; tracks: number | null; image: string | null; owner: string | null };
export type SpotifyStatus = {
  clientId: boolean; deviceName: string;
  librespot: 'running' | 'starting' | 'off' | 'not-installed' | 'sim' | 'crashed';
  librespotError: string | null;
  connected: boolean;              // the active driver has tokens
  user: string | null;
  playback: SpotifyPlayback | null;
  onTruck: boolean;                // playing on the truck's Connect device
  message: string | null;
};

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

export type LocalEntry = { name: string; path: string };
export type LocalTrack = LocalEntry & { title: string; artist: string | null; album: string | null; size: number };
export type LocalListing = { root: string; path: string; parent: string | null; dirs: LocalEntry[]; files: LocalTrack[] };

export type Tuner = { state: 'present' | 'none' | 'no-software' | 'sim' | 'busy'; message: string; checkedAt: string };

export type RadioNow = { stationId: string; name: string; title: string | null; artist: string | null; since: string };

export type MediaStatus = {
  saveData: boolean; link: string;
  nowPlaying: { title: string | null; artist: string | null; album: string | null; source: string } | null;
  spotify: SpotifyStatus;
  radio: { now: RadioNow | null };
  fm: { tuner: Tuner; tuned: number | null };
  plex: { configured: boolean };
  local: { root: string };
  wopr: { configured: boolean; online: boolean; url: string | null; message: string | null };
};
