// Settings portal: Media and WOPR (Track B). Its own store on the brain
// (/api/media/settings, DATA_DIR/media.json), so each section saves itself.
import { useEffect, useState } from 'preact/hooks';
import { api, type Settings } from '../lib/brain.ts';
import type { FmPreset, MaskedMediaSettings, MediaStatus } from '../../../brain/src/media/types.ts';
import { ReceiptImport } from '../receipts/Receipts.tsx';

type Msg = { ok: boolean; text: string } | null;

function Section({ id, title, help, children }: { id: string; title: string; help?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return <section class="card" id={id}><h2>{title}</h2>{help && <p class="help">{help}</p>}{children}</section>;
}

function Secret({ label, set, value, placeholder, onInput, onClear }: { label: string; set: string | undefined; value: string; placeholder?: string; onInput: (v: string) => void; onClear: () => void }) {
  return (
    <div class="form" style="gap:6px">
      <label class="f"><span>{label}</span>
        <input type="password" autocomplete="off" value={value} placeholder={set ? `set (${set}); type to replace` : placeholder ?? 'not set'} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      </label>
      {set && <button class="btn sm danger" type="button" onClick={onClear}>Remove</button>}
    </div>
  );
}

const Note = ({ m }: { m: Msg }) => (m ? <span class={m.ok ? 'okmsg' : 'err'}>{m.text}</span> : null);

/** Where Spotify sends the phone back. Spotify only allows https, or http on the loopback address 127.0.0.1. */
export function spotifyRedirect(loc: { protocol: string; origin: string; port: string }): { uri: string; paste: boolean } {
  if (loc.protocol === 'https:') return { uri: `${loc.origin}/api/spotify/callback`, paste: false };
  return { uri: `http://127.0.0.1:${loc.port || '80'}/api/spotify/callback`, paste: true };
}

export function TrackBSections({ settings }: { settings: Settings }) {
  const [m, setM] = useState<MaskedMediaSettings | null>(null);
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const load = () => {
    api<MaskedMediaSettings>('/api/media/settings').then(setM).catch(() => {});
    api<MediaStatus>('/api/media/status').then(setStatus).catch(() => {});
  };
  useEffect(load, []);
  if (!m) return <section class="card"><h2>Media and WOPR</h2><p class="help">Loading…</p></section>;
  const put = async (patch: Record<string, unknown>): Promise<Msg> => {
    try { setM(await api<MaskedMediaSettings>('/api/media/settings', { method: 'PUT', body: JSON.stringify(patch) })); load(); return { ok: true, text: 'Saved.' }; }
    catch (e) { return { ok: false, text: (e as Error).message }; }
  };
  return (
    <>
      <WoprSection m={m} put={put} />
      <SpotifySection m={m} put={put} settings={settings} status={status} reload={load} />
      <PlexSection m={m} put={put} />
      <RadioSection m={m} put={put} />
      <FmSection m={m} put={put} status={status} />
      <LocalSection m={m} put={put} status={status} />
      <Section id="receipts" title="Charging receipts" help="Public charging receipts become draft charge sessions you confirm with one tap (here, or on the cockpit).">
        <ReceiptImport />
      </Section>
    </>
  );
}

type SP = { m: MaskedMediaSettings; put: (p: Record<string, unknown>) => Promise<Msg> };

function WoprSection({ m, put }: SP) {
  const [url, setUrl] = useState(m.wopr.url ?? '');
  const [user, setUser] = useState(m.wopr.username);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [test, setTest] = useState<Msg>(null);
  const save = async () => { setMsg(await put({ wopr: { url: url.trim() || null, username: user.trim(), ...(pw ? { password: pw } : {}) } })); setPw(''); };
  const run = async () => { setTest(null); try { const r = await api<{ ok: boolean; message: string }>('/api/wopr/test', { method: 'POST' }); setTest({ ok: r.ok, text: r.message }); } catch (e) { setTest({ ok: false, text: (e as Error).message }); } };
  return (
    <Section id="wopr" title="WOPR" help="Jeff's home AI. The WOPR button on the rail talks to it (speech in, WOPR's answer spoken back), the next calendar appointment comes from it, and so do gate codes when the truck stops somewhere it knows. Needs the internet; the login stays on the truck.">
      <div class="fields form">
        <label class="f"><span>WOPR address</span><input type="url" value={url} placeholder="https://wopr.example.com" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Username</span><input type="text" autocomplete="off" value={user} onInput={(e) => setUser((e.target as HTMLInputElement).value)} /></label>
        <Secret label="Password (WOPR's APP_PASSWORD)" set={m.wopr.password} value={pw} onInput={setPw} onClear={() => void put({ wopr: { password: '' } }).then(setMsg)} />
      </div>
      <div class="row wrap">
        <button class="btn primary" type="button" onClick={() => void save()}>Save WOPR</button>
        <button class="btn" type="button" disabled={!m.wopr.url || !m.wopr.password} onClick={() => void run()}>Test</button>
        <Note m={msg} /><Note m={test} />
      </div>
      <p class="help">Away from home use the public address (the gate asks for this login); at home the LAN address (http://192.168.1.20:3940) also works. Gate codes are read when the truck parks and kept only in memory: never saved on the truck and never sent to Home Assistant.</p>
    </Section>
  );
}

function SpotifySection({ m, put, settings, status, reload }: SP & { settings: Settings; status: MediaStatus | null; reload: () => void }) {
  const [cid, setCid] = useState(m.spotify.clientId ?? '');
  const [name, setName] = useState(m.spotify.deviceName);
  const [connect, setConnect] = useState(m.spotify.connect);
  const [bitrate, setBitrate] = useState(m.spotify.bitrate);
  const [msg, setMsg] = useState<Msg>(null);
  const [paste, setPaste] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const red = spotifyRedirect(location);
  const save = async () => setMsg(await put({ spotify: { clientId: cid.trim() || null, deviceName: name, connect, bitrate } }));
  const start = async (driverId: string) => {
    setMsg(null);
    try {
      const r = await api<{ url: string }>('/api/spotify/auth/start', { method: 'POST', body: JSON.stringify({ driverId, redirectUri: red.uri }) });
      setPending(driverId);
      if (red.paste) window.open(r.url, '_blank', 'noopener'); else location.href = r.url;
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const finish = async () => {
    try { const r = await api<{ user: string | null }>('/api/spotify/auth/finish', { method: 'POST', body: JSON.stringify({ url: paste }) }); setMsg({ ok: true, text: `Connected${r.user ? ` as ${r.user}` : ''}.` }); setPaste(''); setPending(null); reload(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const drop = async (id: string) => { await api(`/api/spotify/auth/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {}); reload(); };
  const sp = status?.spotify;
  return (
    <Section id="spotify" title="Spotify" help={<>The truck becomes a Spotify Connect speaker ("{m.spotify.deviceName}", librespot on the Pi), and the Media view shows what's playing, skips, and plays your playlists on it. Playback control needs Spotify Premium.</>}>
      <ol class="help" style="margin:0;padding-left:20px;display:grid;gap:4px">
        <li>On developer.spotify.com/dashboard, create an app (free). Tick "Web API".</li>
        <li>Add this Redirect URI to the app: <code style="word-break:break-all">{red.uri}</code>{red.paste ? ' (Spotify only allows https, or http on 127.0.0.1)' : ''}.</li>
        <li>In the app's User Management, add the email of every Spotify account that will connect. An app in development mode serves at most <b>5 Spotify accounts</b>.</li>
        <li>Paste its Client ID below, save, then press Connect for each driver.</li>
      </ol>
      <div class="fields form">
        <label class="f"><span>Client ID</span><input type="text" autocomplete="off" value={cid} placeholder="32 characters from the app's settings" onInput={(e) => setCid((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Speaker name (Spotify Connect)</span><input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Stream quality</span><select value={String(bitrate)} onChange={(e) => setBitrate(Number((e.target as HTMLSelectElement).value) as 96 | 160 | 320)}><option value="96">96 kbps (least data)</option><option value="160">160 kbps</option><option value="320">320 kbps</option></select></label>
      </div>
      <label class="check"><input type="checkbox" checked={connect} onChange={(e) => setConnect((e.target as HTMLInputElement).checked)} /> Run the Spotify Connect speaker on the truck (librespot)</label>
      <div class="row wrap"><button class="btn primary" type="button" onClick={() => void save()}>Save Spotify</button><Note m={msg} />{sp && <span class="dimtxt" style="font-size:14px">Speaker: {sp.librespot}{sp.librespotError ? ` (${sp.librespotError})` : ''}</span>}</div>
      <div class="list">
        {settings.drivers.filter((d) => !d.guest).map((d) => {
          const c = m.spotify.connected[d.id];
          return (
            <div class="item row between wrap">
              <span><b>{d.name}</b> <span class="dimtxt">{c ? `connected${c.user ? ` as ${c.user}` : ''}` : 'not connected'}</span></span>
              {c ? <button class="btn sm danger" type="button" onClick={() => void drop(d.id)}>Disconnect</button>
                : <button class="btn sm primary" type="button" disabled={!m.spotify.clientId} onClick={() => void start(d.id)}>Connect</button>}
            </div>
          );
        })}
      </div>
      {red.paste && pending && (
        <div class="form">
          <label class="f"><span>After signing in, Spotify opens an address starting with http://127.0.0.1 that won't load on the phone. Copy that whole address from the browser bar and paste it here:</span>
            <input type="url" value={paste} placeholder="http://127.0.0.1:8080/api/spotify/callback?code=…" onInput={(e) => setPaste((e.target as HTMLInputElement).value)} />
          </label>
          <div><button class="btn primary" type="button" disabled={!paste.includes('code=')} onClick={() => void finish()}>Finish connecting</button></div>
        </div>
      )}
    </Section>
  );
}

function PlexSection({ m, put }: SP) {
  const [url, setUrl] = useState(m.plex.url ?? '');
  const [tok, setTok] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const save = async () => { setMsg(await put({ plex: { url: url.trim() || null, ...(tok ? { token: tok } : {}) } })); setTok(''); };
  const test = async () => { try { const s = await api<{ title: string }[]>('/api/media/plex/sections'); setMsg({ ok: true, text: s.length ? `Plex answered: ${s.map((x) => x.title).join(', ')}` : 'Plex answered, but has no music library.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  return (
    <Section id="plex" title="Plex" help="Your own music library, played in the Media view. Away from home the truck reaches it over Tailscale (or Plex remote access).">
      <div class="fields form">
        <label class="f"><span>Plex server address</span><input type="url" value={url} placeholder="http://192.168.1.20:32400" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
        <Secret label="X-Plex-Token" set={m.plex.token} value={tok} placeholder="see support.plex.tv: Finding an authentication token" onInput={setTok} onClear={() => void put({ plex: { token: '' } }).then(setMsg)} />
      </div>
      <div class="row wrap"><button class="btn primary" type="button" onClick={() => void save()}>Save Plex</button><button class="btn" type="button" disabled={!m.plex.url || !m.plex.token} onClick={() => void test()}>Test</button><Note m={msg} /></div>
    </Section>
  );
}

function RadioSection({ m, put }: SP) {
  const [url, setUrl] = useState(m.radio.kjefUrl);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Section id="radio" title="Internet radio" help="Stations come from radio-browser.info (free, no key). Each driver keeps their own favourites (star them in the Media view). KJEF is a preset.">
      <div class="fields form">
        <label class="f"><span>KJEF stream (SUB/WAVE)</span><input type="url" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap"><button class="btn primary" type="button" onClick={() => void put({ radio: { kjefUrl: url.trim() } }).then(setMsg)}>Save</button><Note m={msg} /></div>
      <p class="help">Public: https://radio.jeffraben.com/stream.mp3 (open to listeners since 2026-11-03; if the station's listener password comes back on, this preset stops working until it's off again). At home: http://192.168.1.30:7700/stream.mp3 straight from NOMAD, no internet needed.</p>
    </Section>
  );
}

function FmSection({ m, put, status }: SP & { status: MediaStatus | null }) {
  const [presets, setPresets] = useState<FmPreset[]>(m.fm.presets);
  const [ppm, setPpm] = useState(m.fm.ppm);
  const [gain, setGain] = useState<string>(m.fm.gain === null ? '' : String(m.fm.gain));
  const [msg, setMsg] = useState<Msg>(null);
  const t = status?.fm.tuner;
  return (
    <Section id="fm" title="AM/FM radio" help="Real over-the-air radio, no data, through an optional RTL-SDR USB tuner (RTL-SDR Blog V4 with its dipole antenna kit, about $30-40). FM works best; AM needs the V4 (its built-in upconverter) and a long wire, and is experimental.">
      {t && <div class={`banner ${t.state === 'present' ? 'ok' : ''}`}>Tuner: {t.message}</div>}
      <div class="list">
        {presets.map((p, i) => (
          <div class="row wrap">
            <input type="number" step="0.1" style="width:110px" value={p.mhz} onInput={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, mhz: Number((e.target as HTMLInputElement).value) } : x)))} />
            <input type="text" value={p.name} onInput={(e) => setPresets(presets.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
            <button class="btn sm danger" type="button" onClick={() => setPresets(presets.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div><button class="btn sm" type="button" onClick={() => setPresets([...presets, { mhz: 91.5, name: 'KJZZ' }])}>+ Add preset</button></div>
      </div>
      <div class="fields form">
        <label class="f"><span>Frequency correction (ppm)</span><input type="number" value={ppm} onInput={(e) => setPpm(Number((e.target as HTMLInputElement).value))} /></label>
        <label class="f"><span>Gain dB (empty = automatic)</span><input type="number" value={gain} onInput={(e) => setGain((e.target as HTMLInputElement).value)} /></label>
      </div>
      <p class="help">AM presets are written in MHz: 620 kHz = 0.62.</p>
      <div class="row wrap"><button class="btn primary" type="button" onClick={() => void put({ fm: { presets, ppm, gain: gain.trim() === '' ? null : Number(gain) } }).then(setMsg)}>Save AM/FM</button><Note m={msg} /></div>
    </Section>
  );
}

function LocalSection({ m, put, status }: SP & { status: MediaStatus | null }) {
  const [folder, setFolder] = useState(m.local.folder ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Section id="files" title="Music files on the truck" help="Plays offline. Copy music onto the Pi's SSD in Artist/Album folders (mp3, m4a, flac, ogg, opus, wav), e.g. with scp or a USB stick.">
      <div class="fields form">
        <label class="f"><span>Folder (empty = the data folder's music/)</span><input type="text" value={folder} placeholder={status?.local.root ?? '/var/lib/slate-cockpit/music'} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap"><button class="btn primary" type="button" onClick={() => void put({ local: { folder: folder.trim() || null } }).then(setMsg)}>Save</button><Note m={msg} />{status && <span class="dimtxt" style="font-size:14px">Now reading {status.local.root}</span>}</div>
    </Section>
  );
}
