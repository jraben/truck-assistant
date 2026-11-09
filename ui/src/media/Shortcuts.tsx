// SHORTCUTS: one screen of big tiles for everything saved — AM/FM presets,
// radio stations, Spotify playlists, Plex playlists — so one tap plays it
// without opening each source's tab. Each source still owns its list; this
// only reads them.
import { useEffect, useState } from 'preact/hooks';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { player, playerStore } from './player.ts';
import { mediaStatusStore, refreshMediaStatus, type MaskedMediaSettings, type PlexItem, type RadioStation, type SpotifyPlaylist } from './status.ts';
import { fmName, presetTrack, type FmPreset, type FmSourceNow } from './FmTab.tsx';
import type { Track } from './player.ts';
import { KIND_ART } from './sources.ts';

type Tile = { key: string; kind: 'AM/FM' | 'Radio' | 'Spotify' | 'Plex'; title: string; sub: string; art: string | null; play: () => void | Promise<void>; on: boolean };

export function ShortcutsTab({ stationTrack, plexTrack }: { stationTrack: (s: RadioStation) => Track; plexTrack: (t: PlexItem) => Track }) {
  const ms = useStore(mediaStatusStore);
  const st = useStore(stateStore);
  const p = useStore(playerStore);
  const [fm, setFm] = useState<{ presets: FmPreset[]; source: FmSourceNow }>({ presets: [], source: 'tuner' });
  const [radio, setRadio] = useState<RadioStation[]>([]);
  const [spotify, setSpotify] = useState<SpotifyPlaylist[]>([]);
  const [plex, setPlex] = useState<PlexItem[]>([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void Promise.all([
      api<MaskedMediaSettings>('/api/media/settings').catch(() => null),
      api<{ source: string }>('/api/media/fm/status').catch(() => null),
    ]).then(([s, f]) => setFm({ presets: s?.fm.presets ?? [], source: (f?.source as FmSourceNow | undefined) ?? 'tuner' }));
    void Promise.all([api<RadioStation[]>('/api/media/radio/presets').catch(() => []), api<RadioStation[]>('/api/media/radio/favourites').catch(() => [])])
      .then(([a, b]) => setRadio([...a, ...b.filter((x) => !a.some((y) => y.id === x.id))]));
  }, [st?.driver?.id]);
  useEffect(() => { if (ms?.spotify.connected) api<SpotifyPlaylist[]>('/api/spotify/playlists').then(setSpotify, () => setSpotify([])); }, [ms?.spotify.connected]);
  useEffect(() => { if (ms?.plex.configured) api<PlexItem[]>('/api/media/plex/playlists').then(setPlex, () => setPlex([])); }, [ms?.plex.configured]);

  const cur = p.current;
  const tiles: Tile[] = [
    ...fm.presets.map((x): Tile => {
      const t = presetTrack(x, fm.source);
      return { key: `fm:${t.id}`, kind: 'AM/FM', title: x.name, sub: x.mhz ? `${fmName(x.mhz)}${x.hd ? ` HD${x.hd}` : ''}` : 'AM/FM', art: null, on: cur?.source === 'fm' && cur.id === t.id, play: () => player.play(t) };
    }),
    ...radio.map((s): Tile => ({ key: `radio:${s.id}`, kind: 'Radio', title: s.name, sub: s.tags.slice(0, 2).join(' · ') || 'Internet radio', art: s.favicon, on: cur?.source === 'radio' && cur.id === s.id, play: () => player.play(stationTrack(s)) })),
    ...spotify.slice(0, 24).map((pl): Tile => ({
      key: `sp:${pl.id}`, kind: 'Spotify', title: pl.name, sub: pl.tracks !== null ? `${pl.tracks} songs` : 'Playlist', art: pl.image, on: false,
      play: async () => { player.stop(); await api('/api/spotify/playlist', { method: 'POST', body: JSON.stringify({ uri: pl.uri }) }); await refreshMediaStatus(); },
    })),
    ...plex.slice(0, 24).map((pl): Tile => ({
      key: `plex:${pl.key}`, kind: 'Plex', title: pl.title, sub: pl.subtitle ?? 'Playlist', art: pl.thumb, on: false,
      play: async () => {
        const items = await api<PlexItem[]>(`/api/media/plex/children?key=${encodeURIComponent(pl.key)}&type=playlist`);
        const tracks = items.filter((i) => i.type === 'track').map(plexTrack);
        if (!tracks.length) throw new Error(`${pl.title} has no songs`);
        player.play(tracks[0], tracks, 0);
      },
    })),
  ];
  const tap = async (t: Tile) => {
    setBusy(t.key);
    try { await t.play(); } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  };

  if (!tiles.length) {
    return (
      <div class="mpane">
        <div class="dimtxt">Nothing saved yet. This row collects your AM/FM presets, radio favourites (☆), Spotify playlists and Plex playlists here.</div>
      </div>
    );
  }
  return (
    <div class="mpane">
      {p.error && <div class="banner bad">{p.error}</div>}
      <div class="mgrid saved">
        {tiles.map((t) => (
          <button type="button" class={`mtile ${t.on ? 'sel' : ''}`} disabled={busy === t.key} onClick={() => void tap(t)} aria-pressed={t.on}>
            <img src={t.art ?? KIND_ART[t.kind]} alt="" loading="lazy" onError={(e) => { const i = e.target as HTMLImageElement; if (i.src !== new URL(KIND_ART[t.kind], location.href).href) i.src = KIND_ART[t.kind]; }} />
            <b class="ellip">{t.title}</b>
            <span class="dimtxt ellip">{t.kind} · {t.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
