// The MEDIA view: a home screen of big source tiles (and the saved shortcuts
// under them); a tap opens that source. Spotify controls the truck's Connect
// speaker when it is set up; Pandora, YouTube Music and Amazon Music hand off
// to their own apps (no playback API for a web page); the rest play through
// the cockpit's own player (player.ts). CarPlay keeps its own view.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { carplayStore, nowPlayingStore } from '../carplay/controller.ts';
import { Card, Modal } from '../components/common.tsx';
import type { WP } from '../components/drive.tsx';
import { mbPerHour, player, playerStore, type Track } from './player.ts';
import { mediaStatusStore, pollMediaStatus, refreshMediaStatus, type LocalListing, type LocalTrack, type MediaStatus, type PlexItem, type PlexSection, type RadioStation, type SpotifyPlaylist } from './status.ts';
import { FmTab, fmNetTrack, fmTrack, presetTrack, type FmSourceNow } from './FmTab.tsx';
import { ShortcutsTab } from './Shortcuts.tsx';
import { fully, isSourceId, phonePlaying, SOURCES, sourceById, type HandOff, type Source, type SourceId } from './sources.ts';
import type { NowPlaying } from '../carplay/media.ts';
import './media.css';
export { fmTrack, fmNetTrack, presetTrack };

const LS_TAB = 'slate.media.tab';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [st, setSt] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => { if (alive) setSt({ data, error: null, loading: false }); }, (e: Error) => { if (alive) setSt({ data: null, error: e.message, loading: false }); });
    return () => { alive = false; };
  }, [...deps, n]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

const STREAMS = new Set(['spotify', 'radio', 'plex', 'home']);

/** The Media view widget (type "media"). */
export function MediaW({ go }: WP) {
  const [tab, setTab] = useState<SourceId | 'home'>(() => { const t = lsGet(LS_TAB); return isSourceId(t) ? t : 'home'; });
  useEffect(() => pollMediaStatus(true), []);
  const pick = (t: SourceId | 'home') => { setTab(t); lsSet(LS_TAB, t); };
  const ms = useStore(mediaStatusStore);
  // Whether AM/FM comes off a tuner (no data) or an internet stream: the banner must not promise "no data" for a stream.
  const [fmSrc, setFmSrc] = useState<FmSourceNow | null>(null);
  useEffect(() => { if (ms?.saveData) api<{ source: FmSourceNow }>('/api/media/fm/status').then((f) => setFmSrc(f.source), () => setFmSrc(null)); }, [ms?.saveData]);
  const src = tab === 'home' ? null : sourceById(tab);
  return (
    <div class="card media">
      {src && <SourceHeader src={src} pick={pick} />}
      {ms?.saveData && STREAMS.has(tab) && <div class="banner" style="font-size:var(--fs-body-sm)">On a phone hotspot with "save data" on: streaming asks first. {fmSrc === null || fmSrc === 'tuner' ? "AM/FM, Files and the phone's own apps use no truck data." : "With no radio tuner, AM/FM plays over the internet and asks too; Files and the phone's own apps use no truck data."}</div>}
      <div class="mbody">
        {tab === 'home' && <MediaHome pick={pick} />}
        {tab === 'spotify' && <SpotifyTab go={go} />}
        {src?.handOff && src.id !== 'spotify' && <HandOffPane src={src} go={go} />}
        {tab === 'radio' && <RadioTab />}
        {tab === 'fm' && <FmTab />}
        {tab === 'plex' && <PlexTab />}
        {tab === 'local' && <LocalTab />}
      </div>
    </div>
  );
}

// ---- home: the source tiles ---------------------------------------------------------------

type PhoneNp = Pick<NowPlaying, 'app' | 'title' | 'artist'>;

/** One line under a source tile's name: what it is doing or what it needs. Pure. */
export function sourceLine(src: Source, ms: MediaStatus | null, phone: PhoneNp | null, playing: string | null): string {
  const onPhone = phonePlaying(src.handOff, phone);
  const what = (t: { title: string | null; artist: string | null }) => [t.title, t.artist].filter(Boolean).join(' · ');
  switch (src.id) {
    case 'spotify': {
      const sp = ms?.spotify;
      if (sp?.clientId && sp.connected) return sp.playback?.title ? `${sp.playback.playing ? 'Playing' : 'Paused'}: ${what(sp.playback)}` : `Connected${sp.user ? ` as ${sp.user}` : ''}`;
      if (onPhone) return `On the phone: ${what(onPhone)}`;
      return sp?.clientId ? 'Sign in on the settings page' : 'Plays from the phone';
    }
    case 'pandora': case 'ytmusic': case 'amazon':
      return onPhone ? `On the phone: ${what(onPhone)}` : 'Plays from the phone';
    case 'plex': return !ms ? '' : ms.plex.configured ? (playing === 'plex' ? 'Playing from your library' : 'Your music library') : 'Not set up yet';
    case 'radio': return ms?.radio.now ? `Playing ${ms.radio.now.name}` : 'Stations and favourites';
    case 'fm': return ms?.fm.tuner.state === 'present' ? 'Tuner and presets' : 'Presets (internet streams)';
    case 'local': return 'Music on the truck';
  }
}

function MediaHome({ pick }: { pick: (t: SourceId) => void }) {
  const ms = useStore(mediaStatusStore);
  const phone = useStore(nowPlayingStore);
  const p = useStore(playerStore);
  const playing = p.current?.source ?? null;
  const live = (s: Source) => playing === s.id || (s.id === 'spotify' && !!ms?.spotify.onTruck && !!ms.spotify.playback?.playing) || !!phonePlaying(s.handOff, phone);
  return (
    <div class="mpane">
      <div class="msrc" role="list" aria-label="Sources">
        {SOURCES.map((s) => (
          <button type="button" role="listitem" class={`msrc-tile ${live(s) ? 'sel' : ''}`} onClick={() => pick(s.id)}>
            <img src={s.art} alt="" />
            <span class="msrc-txt"><b>{s.label}</b><span class="dimtxt">{sourceLine(s, ms, phone, playing)}</span></span>
          </button>
        ))}
      </div>
      <div class="lbl">Saved</div>
      <ShortcutsTab stationTrack={stationTrack} plexTrack={plexTrack} />
    </div>
  );
}

function SourceHeader({ src, pick }: { src: Source; pick: (t: SourceId | 'home') => void }) {
  return (
    <div class="mhead">
      <button type="button" class="btn big" onClick={() => pick('home')}>← Sources</button>
      <img class="mhead-art" src={src.art} alt="" />
      <h3 class="mh grow ellip">{src.label}</h3>
      <div class="mswitch" role="tablist" aria-label="Switch source">
        {SOURCES.map((s) => <button type="button" role="tab" aria-selected={s.id === src.id} aria-label={s.label} title={s.label} onClick={() => pick(s.id)}><img src={s.art} alt="" /></button>)}
      </div>
    </div>
  );
}

// ---- hand-off sources (Pandora, YouTube Music, Amazon Music; Spotify without a Client ID) -----

function HandOffPane({ src, go, note }: { src: Source; go: (v: string) => void; note?: ComponentChildren }) {
  const h = src.handOff as HandOff;
  const cp = useStore(carplayStore);
  const np = phonePlaying(h, useStore(nowPlayingStore));
  const f = fully();
  const openApp = () => { try { player.stop(); f!.startApplication!(h.androidPackage); } catch (e) { toast((e as Error).message); } };
  return (
    <div class="mpane">
      <p class="handoff-why">{note ?? <>{h.why} So there are no buttons here pretending to control it: play {src.label} on your phone through <b>CarPlay</b> (or Bluetooth), and what's playing shows here when the phone reports it.</>}</p>
      {np ? (
        <div class="np">
          <img src={np.art ?? src.art} alt="" />
          <span class="grow npt"><b class="ellip">{np.title ?? '—'}</b><span class="ellip dimtxt">{[np.artist, np.album].filter(Boolean).join(' · ')}</span><span class="lbl">On the phone · {np.app}</span></span>
        </div>
      ) : <div class="dimtxt">{cp.status === 'connected' ? `Nothing from ${src.label} on the phone right now.` : `CarPlay isn't connected, so the cockpit can't see what the phone is playing.`}</div>}
      <div class="row wrap">
        <button class="btn big primary" type="button" onClick={() => { player.stop(); go('carplay'); }}>Open CarPlay</button>
        {f?.startApplication && <button class="btn big" type="button" onClick={openApp}>Open the {src.label} app</button>}
        <a class="btn big" href={h.web} target="_blank" rel="noopener noreferrer">Web player</a>
      </div>
      <div class="dimtxt" style="font-size:var(--fs-body-sm)">The web player opens in a new tab and plays from this screen, signed in with your own account; its controls stay in that tab.{f?.startApplication ? '' : ' On the tablet, turn on Fully Kiosk\'s JavaScript interface to get an "Open the app" button.'}</div>
    </div>
  );
}

/** "This will use data on Jeff's phone" before a stream starts on a hotspot. */
export function DataConfirm() {
  const p = useStore(playerStore);
  const s = useStore(stateStore);
  if (!p.confirm) return null;
  const t = p.confirm.track;
  return (
    <Modal title="Use phone data?" onClose={() => player.confirmData(false)}>
      <p style="margin:0;font-size:var(--fs-section)">The cockpit is online through <b>{s?.network?.label ?? 'a phone'}</b> with "save data" on. {t.title ?? 'This stream'} uses about <b>{mbPerHour(t.kbps)} MB an hour</b>{t.source === 'plex' ? ' (more for lossless files)' : ''}.</p>
      <div class="row wrap">
        <button class="btn big primary" type="button" onClick={() => player.confirmData(true)}>Play anyway</button>
        <button class="btn big" type="button" onClick={() => player.confirmData(false)}>Not now</button>
      </div>
      <div class="dimtxt" style="font-size:var(--fs-caption)">Asked once per connection. Turn it off on the settings page (Getting online).</div>
    </Modal>
  );
}

// ---- Spotify ------------------------------------------------------------------------

const settingsUrl = (hash: string) => `${location.origin}/settings#${hash}`;

function QrLink({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  return <div class="row" style="gap:var(--s2);align-items:flex-start"><div class="qr sm" dangerouslySetInnerHTML={{ __html: svg }} aria-label={label} /><div class="dimtxt" style="font-size:var(--fs-body-sm)">{label}<br /><code style="word-break:break-all">{url}</code></div></div>;
}

function SpotifyTab({ go }: { go: (v: string) => void }) {
  const ms = useStore(mediaStatusStore);
  const sp = ms?.spotify;
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<{ c: string; body?: Record<string, unknown> } | null>(null);
  const lists = useLoad(() => (sp?.connected ? api<SpotifyPlaylist[]>('/api/spotify/playlists') : Promise.resolve([])), [sp?.connected]);
  const cmd = async (c: string, body?: Record<string, unknown>, agreed = false) => {
    if (c === 'transfer' || c === 'playlist') {
      if (ms?.saveData && !agreed) { setAsk({ c, body }); return; }
      player.stop();
    }
    setBusy(c);
    try { await api(`/api/spotify/${c}`, { method: 'POST', body: JSON.stringify(body ?? {}) }); await refreshMediaStatus(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(''); }
  };
  if (!sp) return <div class="dimtxt">Asking the brain…</div>;
  if (!sp.clientId) {
    // No Client ID: a hand-off tile like the other services, with the one-line way to full control.
    return (
      <>
        <HandOffPane src={sourceById('spotify')!} go={go} note={<>Spotify plays from the app on your phone through <b>CarPlay</b>, and what's playing shows here. <span class="dimtxt">Full control here (play, skip, playlists, the truck as a speaker) needs Spotify Premium and your own Client ID pasted on the settings page.</span></>} />
        <details class="mmore"><summary>Set up full control</summary><QrLink url={settingsUrl('spotify')} label="Open the settings page on the phone (truck Wi-Fi or Tailscale)" /></details>
      </>
    );
  }
  if (!sp.connected) {
    return (
      <div class="mpane">
        <h3 class="mh">Sign in to Spotify</h3>
        <p class="dimtxt" style="margin:0">The Client ID is saved. Sign in to Spotify for this driver from your phone on the settings page (playback control needs Spotify Premium):</p>
        <QrLink url={settingsUrl('spotify')} label="Scan with the phone (on the truck's Wi-Fi or Tailscale)" />
        <LibrespotLine sp={sp} />
      </div>
    );
  }
  const p = sp.playback;
  return (
    <div class="mpane">
      {ask && (
        <Modal title="Use phone data?" onClose={() => setAsk(null)}>
          <p style="margin:0;font-size:var(--fs-section)">Spotify on the truck streams over {ms?.link === 'bt' ? 'Bluetooth tethering' : 'the phone hotspot'}: about {mbPerHour(160)} MB an hour at 160 kbps.</p>
          <div class="row wrap">
            <button class="btn big primary" type="button" onClick={() => { const a = ask; setAsk(null); void cmd(a.c, a.body, true); }}>Play anyway</button>
            <button class="btn big" type="button" onClick={() => setAsk(null)}>Not now</button>
          </div>
        </Modal>
      )}
      <div class="row between wrap">
        <div class="lbl">Spotify · {sp.user ?? 'connected'}{p?.device ? ` · on ${p.device.name}` : ''}</div>
        <LibrespotLine sp={sp} />
      </div>
      {p && (p.title || p.artist) ? (
        <div class="np">
          {p.art ? <img src={p.art} alt="" /> : <span class="noart" aria-hidden="true">♪</span>}
          <span class="grow npt"><b class="ellip">{p.title ?? '—'}</b><span class="ellip dimtxt">{[p.artist, p.album].filter(Boolean).join(' · ')}</span></span>
        </div>
      ) : <div class="dimtxt">Nothing playing on Spotify.</div>}
      <div class="row wrap">
        <button class="btn big" type="button" disabled={!!busy} onClick={() => void cmd('previous')} aria-label="Previous">⏮</button>
        <button class="btn big primary" type="button" disabled={!!busy} onClick={() => void cmd(p?.playing ? 'pause' : 'play')}>{p?.playing ? 'Pause' : 'Play'}</button>
        <button class="btn big" type="button" disabled={!!busy} onClick={() => void cmd('next')} aria-label="Next">⏭</button>
        {!sp.onTruck && <button class="btn big" type="button" disabled={!!busy} onClick={() => void cmd('transfer')}>Play on the truck</button>}
      </div>
      {sp.message && <div class="err">{sp.message}</div>}
      <div class="lbl">Playlists</div>
      {lists.error && <div class="err">{lists.error}</div>}
      <div class="mgrid">
        {(lists.data ?? []).slice(0, 40).map((pl) => (
          <button type="button" class="mtile" disabled={!!busy} onClick={() => void cmd('playlist', { uri: pl.uri })}>
            {pl.image ? <img src={pl.image} alt="" /> : <span class="noart">♪</span>}
            <b class="ellip">{pl.name}</b>
            <span class="dimtxt ellip">{pl.tracks !== null ? `${pl.tracks} songs` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LibrespotLine({ sp }: { sp: NonNullable<ReturnType<typeof mediaStatusStore.get>>['spotify'] }) {
  const m: Record<string, [string, string]> = {
    running: ['ok', `Speaker "${sp.deviceName}" is on`], starting: ['warn', 'Speaker starting'], off: ['dim', 'Speaker off (settings)'],
    'not-installed': ['warn', 'librespot not installed on this computer'], sim: ['dim', 'Simulated truck: no speaker'], crashed: ['bad', 'Speaker stopped: restarting'],
  };
  const [tone, text] = m[sp.librespot] ?? ['dim', sp.librespot];
  return <span class={`tag ${tone}`} title={sp.librespotError ?? ''}>{text}</span>;
}

// ---- internet radio -------------------------------------------------------------------

const GENRES = ['rock', 'classic rock', '80s', 'country', 'news', 'talk', 'jazz', 'classical', 'blues', 'oldies', 'alternative', 'hip hop'];

export const stationTrack = (st: RadioStation): Track => ({
  source: 'radio', id: st.id, url: `/api/media/radio/stream/${encodeURIComponent(st.id)}`, title: st.name, artist: null, album: st.name,
  art: st.favicon, live: true, dataHeavy: !/^http:\/\/192\.168\./.test(st.url), kbps: st.bitrate,
});

function StationRow({ st, fav, onFav }: { st: RadioStation; fav: boolean; onFav: (on: boolean) => void }) {
  const p = useStore(playerStore);
  const on = p.current?.source === 'radio' && p.current.id === st.id;
  return (
    <div class={`item row ${on ? 'sel' : ''}`}>
      {st.favicon ? <img class="mfav" src={st.favicon} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /> : <span class="mfav noart">📻</span>}
      <button type="button" class="grow mrow" onClick={() => (on ? player.toggle() : player.play(stationTrack(st)))}>
        <b class="ellip">{st.name}</b>
        <span class="dimtxt ellip" style="font-size:var(--fs-caption)">{[st.country, st.codec, st.bitrate ? `${st.bitrate} kbps` : null, ...st.tags.slice(0, 3)].filter(Boolean).join(' · ')}{st.hls ? ' · HLS (may not play)' : ''}</span>
      </button>
      <button type="button" class={`btn sm ${fav ? 'primary' : ''}`} aria-pressed={fav} title={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => onFav(!fav)}>{fav ? '★' : '☆'}</button>
      <button type="button" class="btn sm" onClick={() => (on ? player.toggle() : player.play(stationTrack(st)))}>{on && p.playing ? 'Pause' : 'Play'}</button>
    </div>
  );
}

function RadioTab() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<{ q?: string; tag?: string } | null>(null);
  const presets = useLoad(() => api<RadioStation[]>('/api/media/radio/presets'), []);
  const st = useStore(stateStore);
  const favs = useLoad(() => api<RadioStation[]>('/api/media/radio/favourites'), [st?.driver?.id]);
  const results = useLoad(() => (query ? api<RadioStation[]>(`/api/media/radio/search?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), ...(query.tag ? { tag: query.tag } : {}), country: 'US' })}`) : Promise.resolve(null)), [query?.q, query?.tag]);
  const favIds = new Set((favs.data ?? []).map((f) => f.id));
  const setFav = async (st: RadioStation, on: boolean) => {
    try {
      if (on) await api('/api/media/radio/favourites', { method: 'POST', body: JSON.stringify({ station: st }) });
      else await api(`/api/media/radio/favourites/${encodeURIComponent(st.id)}`, { method: 'DELETE' });
      favs.reload();
    } catch (e) { toast((e as Error).message); }
  };
  const p = useStore(playerStore);
  const rows = (list: RadioStation[]) => list.map((st) => <StationRow st={st} fav={favIds.has(st.id)} onFav={(on) => void setFav(st, on)} />);
  return (
    <div class="mpane">
      {p.current?.source === 'radio' && p.error && <div class="banner bad">{p.error}</div>}
      <div class="lbl">Presets</div>
      <div class="list">{rows(presets.data ?? [])}</div>
      <div class="lbl">Favourites{st?.driver ? ` · ${st.driver.name}` : ''}</div>
      {favs.data?.length ? <div class="list">{rows(favs.data)}</div> : <div class="dimtxt" style="font-size:var(--fs-body-sm)">Tap ☆ on a station to keep it here.</div>}
      <div class="lbl">Find a station (Radio Browser)</div>
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setQuery({ q: q.trim() }); }}>
        <input class="grow minput" type="search" placeholder="Station name, e.g. KJZZ" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="btn" type="submit">Search</button>
      </form>
      <div class="row wrap">{GENRES.map((g) => <button type="button" class={`btn sm ${query?.tag === g ? 'primary' : ''}`} onClick={() => setQuery({ tag: g })}>{g}</button>)}</div>
      {results.loading && query && <div class="dimtxt">Searching…</div>}
      {results.error && <div class="err">{results.error}</div>}
      {results.data && (results.data.length ? <div class="list">{rows(results.data.slice(0, 30))}</div> : <div class="dimtxt">No stations found.</div>)}
      <div class="attrib">Stations from radio-browser.info, a free community directory.</div>
    </div>
  );
}

// ---- AM/FM ------------------------------------------------------------------------------

// ---- Plex ----------------------------------------------------------------------------------

export const plexTrack = (t: PlexItem): Track => ({ source: 'plex', id: t.key, url: `/api/media/plex/track/${encodeURIComponent(t.key)}`, title: t.title, artist: t.artist, album: t.album, art: t.thumb, live: false, dataHeavy: true, kbps: 320 });

function PlexTab() {
  const ms = useStore(mediaStatusStore);
  const [mode, setMode] = useState<'artists' | 'recent' | 'playlists' | 'search'>('artists');
  const [stack, setStack] = useState<PlexItem[]>([]);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const sections = useLoad(() => (ms?.plex.configured ? api<PlexSection[]>('/api/media/plex/sections') : Promise.resolve([])), [ms?.plex.configured]);
  const [section, setSection] = useState<string | null>(null);
  const sec = section ?? sections.data?.[0]?.key ?? null;
  const top = stack[stack.length - 1] ?? null;
  const list = useLoad<PlexItem[]>(() => {
    if (!ms?.plex.configured) return Promise.resolve([]);
    if (top) return api(`/api/media/plex/children?key=${encodeURIComponent(top.key)}&type=${top.type}`);
    if (mode === 'playlists') return api('/api/media/plex/playlists');
    if (mode === 'search') return query ? api(`/api/media/plex/search?q=${encodeURIComponent(query)}`) : Promise.resolve([]);
    if (!sec) return Promise.resolve([]);
    return api(`/api/media/plex/${mode}?section=${encodeURIComponent(sec)}`);
  }, [ms?.plex.configured, top?.key, mode, sec, query]);
  if (!ms) return <div class="dimtxt">Asking the brain…</div>;
  if (!ms.plex.configured) return <div class="mpane"><h3 class="mh">Connect Plex</h3><p class="dimtxt" style="margin:0">Enter your Plex server address (LAN or Tailscale) and X-Plex-Token on the settings page.</p><QrLink url={settingsUrl('plex')} label="Open the settings page on the phone" /></div>;
  const items = list.data ?? [];
  const tracks = items.filter((i) => i.type === 'track');
  const open = (it: PlexItem) => {
    if (it.type === 'track') { const qd = tracks.map(plexTrack); player.play(plexTrack(it), qd); return; }
    setStack([...stack, it]);
  };
  return (
    <div class="mpane">
      <div class="row wrap">
        {(['artists', 'recent', 'playlists', 'search'] as const).map((m) => <button type="button" class={`btn sm ${mode === m && !stack.length ? 'primary' : ''}`} onClick={() => { setMode(m); setStack([]); }}>{m === 'recent' ? 'Recently added' : m}</button>)}
        {(sections.data?.length ?? 0) > 1 && <select value={sec ?? ''} onChange={(e) => { setSection((e.target as HTMLSelectElement).value); setStack([]); }}>{sections.data!.map((s) => <option value={s.key}>{s.title}</option>)}</select>}
      </div>
      {mode === 'search' && !stack.length && (
        <form class="row" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input class="grow minput" type="search" placeholder="Artist, album or song" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <button class="btn" type="submit">Search</button>
        </form>
      )}
      {stack.length > 0 && (
        <div class="row wrap">
          <button class="btn sm" type="button" onClick={() => setStack(stack.slice(0, -1))}>← Back</button>
          <b class="ellip">{stack.map((s) => s.title).join(' › ')}</b>
          {tracks.length > 0 && <button class="btn sm primary" type="button" onClick={() => player.play(plexTrack(tracks[0]), tracks.map(plexTrack), 0)}>Play all</button>}
        </div>
      )}
      {list.loading && <div class="dimtxt">Loading…</div>}
      {list.error && <div class="err">{list.error}</div>}
      <div class={tracks.length === items.length && items.length ? 'list' : 'mgrid'}>
        {items.slice(0, 200).map((it) => it.type === 'track' ? (
          <button type="button" class="item mrow" onClick={() => open(it)}><b class="ellip">{it.index ? `${it.index}. ` : ''}{it.title}</b><span class="dimtxt ellip" style="font-size:var(--fs-caption)">{it.subtitle ?? ''}{it.durationMs ? ` · ${Math.floor(it.durationMs / 60000)}:${String(Math.floor(it.durationMs / 1000) % 60).padStart(2, '0')}` : ''}</span></button>
        ) : (
          <button type="button" class="mtile" onClick={() => open(it)}>
            {it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <span class="noart">♪</span>}
            <b class="ellip">{it.title}</b><span class="dimtxt ellip">{it.subtitle ?? ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- local files ----------------------------------------------------------------------------

export const localTrack = (f: LocalTrack): Track => ({ source: 'local', id: f.path, url: `/api/media/local/file?path=${encodeURIComponent(f.path)}`, title: f.title, artist: f.artist, album: f.album, art: null, live: false, dataHeavy: false, kbps: null });

function LocalTab() {
  const [dir, setDir] = useState(() => lsGet('slate.local.dir') ?? '');
  const l = useLoad(() => api<LocalListing>(`/api/media/local?path=${encodeURIComponent(dir)}`), [dir]);
  const go = (d: string) => { setDir(d); lsSet('slate.local.dir', d); };
  const d = l.data;
  useEffect(() => { if (l.error && dir) go(''); }, [l.error, dir]); // a folder that went away: back to the top
  return (
    <div class="mpane">
      <div class="row wrap">
        {d?.parent !== null && d?.parent !== undefined && <button class="btn sm" type="button" onClick={() => go(d.parent!)}>← Up</button>}
        <b class="ellip">{d?.path ? d.path.split('/').join(' › ') : 'Music on the truck'}</b>
        {d && d.files.length > 0 && <button class="btn sm primary" type="button" onClick={() => player.play(localTrack(d.files[0]), d.files.map(localTrack), 0)}>Play all</button>}
      </div>
      {l.error && !dir && <div class="err">{l.error}</div>}
      {d && !d.dirs.length && !d.files.length && <div class="dimtxt">No music here yet. Copy files (mp3, m4a, flac, ogg, opus, wav) into <code>{d.root}</code> on the truck's SSD, in Artist/Album folders.</div>}
      <div class="mgrid">{d?.dirs.map((x) => <button type="button" class="mtile folder" onClick={() => go(x.path)}><span class="noart">📁</span><b class="ellip">{x.name}</b></button>)}</div>
      {d && d.files.length > 0 && (
        <div class="list">
          {d.files.map((f, i) => (
            <button type="button" class="item mrow" onClick={() => player.play(localTrack(f), d.files.map(localTrack), i)}>
              <b class="ellip">{f.title}</b><span class="dimtxt ellip" style="font-size:var(--fs-caption)">{[f.artist, f.album].filter(Boolean).join(' · ') || f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A slim "what the cockpit is playing" bar with transport, used by the now-playing card. */
export function PlayerControls() {
  const p = useStore(playerStore);
  const c = p.current;
  if (!c) return null;
  const pct = p.durationS && p.positionS !== null ? (p.positionS / p.durationS) * 100 : null;
  return (
    <div class="pctl">
      {p.error && <div class="err" style="font-size:var(--fs-caption)">{p.error}</div>}
      {pct !== null && !c.live && <div class="npbar" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); player.seek(((e.clientX - r.left) / r.width) * (p.durationS ?? 0)); }}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>}
      <div class="row wrap">
        {!c.live && <button class="btn" type="button" onClick={() => player.prev()} aria-label="Previous">⏮</button>}
        <button class="btn primary" type="button" onClick={() => player.toggle()}>{p.loading ? '…' : p.playing ? 'Pause' : 'Play'}</button>
        {!c.live && <button class="btn" type="button" disabled={p.index + 1 >= p.queue.length} onClick={() => player.next()} aria-label="Next">⏭</button>}
        <button class="btn" type="button" onClick={() => player.stop()}>Stop</button>
      </div>
    </div>
  );
}

/** Media view: hint card shown in place of the next-appointment card when nothing is configured. */
export function MediaHelp() {
  return <Card label="Media"><div class="dimtxt">Sources are set up on the settings page: Spotify, Plex, WOPR.</div></Card>;
}
