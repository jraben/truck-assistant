// The MEDIA view: one screen, a tab per source. CarPlay and Apple Music hand
// over to the CarPlay view; Spotify controls the truck's Connect speaker; the
// rest play through the cockpit's own player (player.ts).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { carplayStore, nowPlayingStore } from '../carplay/controller.ts';
import { Card, Modal } from '../components/common.tsx';
import type { WP } from '../components/drive.tsx';
import { mbPerHour, player, playerStore, type Track } from './player.ts';
import { mediaStatusStore, pollMediaStatus, refreshMediaStatus, type LocalListing, type LocalTrack, type MaskedMediaSettings, type PlexItem, type PlexSection, type RadioStation, type SpotifyPlaylist } from './status.ts';
import './media.css';

export const TABS = [
  { id: 'carplay', label: 'CarPlay' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'radio', label: 'Radio' },
  { id: 'fm', label: 'AM/FM' },
  { id: 'plex', label: 'Plex' },
  { id: 'local', label: 'Files' },
  { id: 'apple', label: 'Apple Music' },
] as const;
type TabId = (typeof TABS)[number]['id'];
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

/** The Media view widget (type "media"). */
export function MediaW({ go }: WP) {
  const [tab, setTab] = useState<TabId>(() => (TABS.some((t) => t.id === lsGet(LS_TAB)) ? lsGet(LS_TAB) as TabId : 'radio'));
  useEffect(() => pollMediaStatus(true), []);
  const pick = (t: TabId) => { setTab(t); lsSet(LS_TAB, t); };
  const ms = useStore(mediaStatusStore);
  return (
    <div class="card media">
      <div class="mtabs" role="tablist" aria-label="Sources">
        {TABS.map((t) => <button type="button" role="tab" aria-selected={tab === t.id} onClick={() => pick(t.id)}>{t.label}</button>)}
      </div>
      {ms?.saveData && (tab === 'radio' || tab === 'spotify' || tab === 'plex') && <div class="banner" style="font-size:14px">On a phone hotspot with "save data" on: streaming asks first. AM/FM, Files and CarPlay use no truck data.</div>}
      <div class="mbody">
        {tab === 'carplay' && <CarPlayTab go={go} />}
        {tab === 'spotify' && <SpotifyTab />}
        {tab === 'radio' && <RadioTab />}
        {tab === 'fm' && <FmTab />}
        {tab === 'plex' && <PlexTab />}
        {tab === 'local' && <LocalTab />}
        {tab === 'apple' && <AppleTab go={go} />}
      </div>
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
      <p style="margin:0;font-size:18px">The cockpit is online through <b>{s?.network?.label ?? 'a phone'}</b> with "save data" on. {t.title ?? 'This stream'} uses about <b>{mbPerHour(t.kbps)} MB an hour</b>{t.source === 'plex' ? ' (more for lossless files)' : ''}.</p>
      <div class="row wrap">
        <button class="btn big primary" type="button" onClick={() => player.confirmData(true)}>Play anyway</button>
        <button class="btn big" type="button" onClick={() => player.confirmData(false)}>Not now</button>
      </div>
      <div class="dimtxt" style="font-size:13px">Asked once per connection. Turn it off on the settings page (Getting online).</div>
    </Modal>
  );
}

// ---- CarPlay and Apple Music ------------------------------------------------------

function CarPlayTab({ go }: { go: (v: string) => void }) {
  const cp = useStore(carplayStore);
  const np = useStore(nowPlayingStore);
  return (
    <div class="mpane">
      <div class="lbl">Apple Music, Spotify, podcasts and audiobooks on the iPhone play through CarPlay.</div>
      {np ? (
        <div class="np">
          {np.art ? <img src={np.art} alt="" /> : <span class="noart" aria-hidden="true">♪</span>}
          <span class="grow npt"><b class="ellip">{np.title ?? '—'}</b><span class="ellip dimtxt">{[np.artist, np.album].filter(Boolean).join(' · ')}</span>{np.app && <span class="lbl">{np.app}</span>}</span>
        </div>
      ) : <div class="dimtxt">{cp.status === 'connected' ? 'Nothing playing on the phone.' : 'CarPlay is not connected.'}</div>}
      <div class="row wrap"><button class="btn big primary" type="button" onClick={() => { player.stop(); go('carplay'); }}>Open CarPlay</button></div>
    </div>
  );
}

function AppleTab({ go }: { go: (v: string) => void }) {
  return (
    <div class="mpane">
      <h3 class="mh">Apple Music plays through CarPlay</h3>
      <p class="dimtxt" style="margin:0">Apple only lets Apple Music play in a browser with MusicKit, which needs a paid Apple Developer membership and a signed developer token, so the cockpit doesn't play it directly. On the iPhone it works as usual through CarPlay, with Siri and your library.</p>
      <div class="row wrap"><button class="btn big primary" type="button" onClick={() => { player.stop(); go('carplay'); }}>Open CarPlay</button></div>
    </div>
  );
}

// ---- Spotify ------------------------------------------------------------------------

const settingsUrl = (hash: string) => `${location.origin}/settings#${hash}`;

function QrLink({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  return <div class="row" style="gap:16px;align-items:flex-start"><div class="qr sm" dangerouslySetInnerHTML={{ __html: svg }} aria-label={label} /><div class="dimtxt" style="font-size:14px">{label}<br /><code style="word-break:break-all">{url}</code></div></div>;
}

function SpotifyTab() {
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
  if (!sp.clientId || !sp.connected) {
    return (
      <div class="mpane">
        <h3 class="mh">Connect Spotify</h3>
        <p class="dimtxt" style="margin:0">{!sp.clientId ? 'Spotify needs your own free developer app (5 Spotify accounts per app). Set it up from your phone on the settings page:' : 'Sign in to Spotify for this driver from your phone on the settings page:'}</p>
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
          <p style="margin:0;font-size:18px">Spotify on the truck streams over {ms?.link === 'bt' ? 'Bluetooth tethering' : 'the phone hotspot'}: about {mbPerHour(160)} MB an hour at 160 kbps.</p>
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
        <span class="dimtxt ellip" style="font-size:13px">{[st.country, st.codec, st.bitrate ? `${st.bitrate} kbps` : null, ...st.tags.slice(0, 3)].filter(Boolean).join(' · ')}{st.hls ? ' · HLS (may not play)' : ''}</span>
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
      {favs.data?.length ? <div class="list">{rows(favs.data)}</div> : <div class="dimtxt" style="font-size:14px">Tap ☆ on a station to keep it here.</div>}
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

const fmName = (mhz: number) => (mhz < 2 ? `${Math.round(mhz * 1000)} AM` : `${mhz.toFixed(1)} FM`);
export const fmTrack = (mhz: number, name?: string): Track => ({ source: 'fm', id: String(mhz), url: `/api/media/fm/stream?mhz=${mhz}`, title: name && name !== fmName(mhz) ? `${name} · ${fmName(mhz)}` : fmName(mhz), artist: null, album: 'AM/FM radio', art: null, live: true, dataHeavy: false, kbps: null });

function FmTab() {
  const ms = useStore(mediaStatusStore);
  const p = useStore(playerStore);
  const [mhz, setMhz] = useState<number>(() => Number(lsGet('slate.fm.mhz')) || 91.5);
  const [settings, setSettings] = useState<MaskedMediaSettings | null>(null);
  const [seeking, setSeeking] = useState(false);
  useEffect(() => { api<MaskedMediaSettings>('/api/media/settings').then(setSettings).catch(() => {}); }, []);
  const tuner = ms?.fm.tuner;
  const playing = p.current?.source === 'fm';
  const tune = (f: number) => {
    const n = Math.round(f * 10) / 10;
    const v = n < 2 ? Math.min(1.71, Math.max(0.53, n)) : Math.min(107.9, Math.max(87.9, n));
    setMhz(v); lsSet('slate.fm.mhz', String(v));
    if (playing) player.play(fmTrack(v));
  };
  const seek = async (dir: 1 | -1) => {
    setSeeking(true);
    try { const r = await api<{ mhz: number | null }>('/api/media/fm/seek', { method: 'POST', body: JSON.stringify({ from: mhz, dir }) }); if (r.mhz) { setMhz(r.mhz); player.play(fmTrack(r.mhz)); } else toast('No strong stations found'); }
    catch (e) { toast((e as Error).message); } finally { setSeeking(false); }
  };
  const presets = settings?.fm.presets ?? [];
  const savePreset = async () => {
    if (presets.some((x) => Math.abs(x.mhz - mhz) < 0.05)) return toast('Already a preset');
    try { setSettings(await api<MaskedMediaSettings>('/api/media/settings', { method: 'PUT', body: JSON.stringify({ fm: { presets: [...presets, { mhz }] } }) })); toast(`Saved ${fmName(mhz)}`); }
    catch (e) { toast((e as Error).message); }
  };
  const ok = tuner?.state === 'present' || tuner?.state === 'busy';
  return (
    <div class="mpane">
      {tuner && !ok && <div class={`banner ${tuner.state === 'sim' ? 'ok' : ''}`}>{tuner.message}{tuner.state === 'none' && ' Details: deploy/pi/README.md (AM/FM).'}</div>}
      {playing && p.error && <div class="banner bad">{p.error}</div>}
      <div class="row wrap" style="gap:18px">
        <div class="fmfreq num" aria-live="polite">{mhz < 2 ? Math.round(mhz * 1000) : mhz.toFixed(1)}<small>{mhz < 2 ? 'kHz AM' : 'MHz FM'}</small></div>
        <div class="row wrap">
          <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(-1)} aria-label="Seek down">⏪ Seek</button>
          <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz - 0.01 : mhz - 0.2)} aria-label="Down one step">−</button>
          <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz + 0.01 : mhz + 0.2)} aria-label="Up one step">+</button>
          <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(1)} aria-label="Seek up">Seek ⏩</button>
          <button class="btn big primary" type="button" onClick={() => (playing && p.playing ? player.stop() : player.play(fmTrack(mhz)))}>{playing && p.playing ? 'Stop' : 'Listen'}</button>
          <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? 98.7 : 0.62)}>{mhz < 2 ? 'FM' : 'AM'}</button>
        </div>
      </div>
      {seeking && <div class="dimtxt">Scanning the band (a few seconds)…</div>}
      <div class="row between"><span class="lbl">Presets</span><button class="btn sm" type="button" onClick={() => void savePreset()}>+ Save {fmName(mhz)}</button></div>
      <div class="row wrap">
        {presets.length ? presets.map((x) => <button type="button" class={`btn big ${playing && p.current?.id === String(x.mhz) ? 'primary' : ''}`} onClick={() => { setMhz(x.mhz); player.play(fmTrack(x.mhz, x.name)); }}>{x.name}</button>) : <span class="dimtxt" style="font-size:14px">No presets yet: tune, then Save.</span>}
      </div>
      <div class="attrib">Over-the-air radio through an RTL-SDR USB tuner: no data used. AM needs the RTL-SDR Blog V4 (or a long-wire antenna) and is experimental.</div>
    </div>
  );
}

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
          <button type="button" class="item mrow" onClick={() => open(it)}><b class="ellip">{it.index ? `${it.index}. ` : ''}{it.title}</b><span class="dimtxt ellip" style="font-size:13px">{it.subtitle ?? ''}{it.durationMs ? ` · ${Math.floor(it.durationMs / 60000)}:${String(Math.floor(it.durationMs / 1000) % 60).padStart(2, '0')}` : ''}</span></button>
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
              <b class="ellip">{f.title}</b><span class="dimtxt ellip" style="font-size:13px">{[f.artist, f.album].filter(Boolean).join(' · ') || f.name}</span>
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
      {p.error && <div class="err" style="font-size:13px">{p.error}</div>}
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
