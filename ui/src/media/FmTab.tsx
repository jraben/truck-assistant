// AM/FM: the tuner when one is plugged in, else the local stations' own
// internet streams (brain/src/media/airstreams.ts). With streams, Prev/Next
// walk the stations that have one, and a station missing from the list can be
// found by call sign and kept as a preset.
import { useEffect, useState } from 'preact/hooks';
import { api, toast, useStore } from '../lib/brain.ts';
import { player, playerStore, type Track } from './player.ts';
import type { MaskedMediaSettings } from './status.ts';

export type AirStation = { id: string; mhz: number; band: 'FM' | 'AM'; hd: string | null; name: string; slogan: string | null; image: string | null };
export type FmPreset = { mhz: number; name: string; streamId?: string | null; hd?: number | null };
export type FmSourceNow = 'tuner' | 'internet' | 'hdserver';
type FmStatus = { tuner: { state: string; message: string; hd?: boolean }; source: FmSourceNow; setting: string; hd?: { tuner: boolean; server: { configured: boolean; reachable: boolean } } };
/** What the HD decoder (truck tuner or HD Radio server) says is on: GET /api/media/fm/hd/now. */
export type HdNow = { via: 'tuner' | 'server'; mhz: number; hd: number; synced: boolean; station: string | null; slogan: string | null; title: string | null; artist: string | null; programs: { hd: number; type: string | null }[]; art: string | null; merDb: number | null; alert: string | null; fallback?: { since: string; retryAt: string | null; analog: boolean } | null };
/** GET /api/media/fm/hd/scan: which FM stations carry HD (truck tuner). */
export type HdFound = { mhz: number; hd: boolean; station: string | null; slogan: string | null; programs: { hd: number; type: string | null }[]; at: string };
type HdScan = { job: { running: boolean; done: number; total: number; current: number | null; error: string | null } | null; found: HdFound[] };
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const fmName = (mhz: number) => (mhz < 2 ? `${Math.round(mhz * 1000)} AM` : `${mhz.toFixed(1)} FM`);
export const fmTrack = (mhz: number, name?: string): Track => ({ source: 'fm', id: String(mhz), url: `/api/media/fm/stream?mhz=${mhz}`, title: name && name !== fmName(mhz) ? `${name} · ${fmName(mhz)}` : fmName(mhz), artist: null, album: 'AM/FM radio', art: null, live: true, dataHeavy: false, kbps: null });
export const fmNetTrack = (st: { id: string; mhz: number; name: string; image?: string | null }): Track => ({
  source: 'fm', id: st.id, url: `/api/media/fm/net/${encodeURIComponent(st.id)}`, title: st.mhz ? `${st.name} · ${fmName(st.mhz)}` : st.name,
  artist: null, album: 'AM/FM radio (internet stream)', art: st.image ?? null, live: true, dataHeavy: true, kbps: 128,
});
/** HD Radio channel `hd` (1-4) of an FM station, from the truck's tuner (nrsc5) or the HD Radio server. Song titles arrive by polling (player.ts). */
export const hdTrack = (mhz: number, hd: number, via: 'tuner' | 'server', name?: string): Track => ({
  source: 'fm', id: `hd:${via}:${mhz}:${hd}`,
  url: via === 'server' ? `/api/media/fm/hd/stream?mhz=${mhz}&hd=${hd}` : `/api/media/fm/stream?mhz=${mhz}&hd=${hd}`,
  title: `${name && name !== fmName(mhz) ? `${name} · ` : ''}${fmName(mhz)} HD${hd}`, artist: null, album: 'HD Radio', art: null, live: true,
  dataHeavy: via === 'server', kbps: via === 'server' ? 96 : null,
});
/**
 * A preset on the source in use: its saved internet stream with no tuner, an HD
 * channel through the tuner or the HD Radio server, else analog on the tuner.
 * (`true`/`false` = internet/tuner, the older call.)
 */
export const presetTrack = (x: FmPreset, src: FmSourceNow | boolean): Track => {
  const s: FmSourceNow = src === true ? 'internet' : src === false ? 'tuner' : src;
  if (s === 'internet') return x.streamId ? fmNetTrack({ id: x.streamId, mhz: x.mhz, name: x.name }) : fmTrack(x.mhz, x.name);
  if (s === 'hdserver' && x.mhz >= 87.5) return hdTrack(x.mhz, x.hd ?? 1, 'server', x.name);
  return x.hd && x.mhz >= 87.5 ? hdTrack(x.mhz, x.hd, 'tuner', x.name) : fmTrack(x.mhz, x.name);
};
const callSign = (name: string) => /\bK[A-Z]{3}\b/.exec(name)?.[0] ?? name;

export function FmTab() {
  const p = useStore(playerStore);
  const [mhz, setMhz] = useState<number>(() => Number(lsGet('slate.fm.mhz')) || 91.5);
  const [settings, setSettings] = useState<MaskedMediaSettings | null>(null);
  const [status, setStatus] = useState<FmStatus | null>(null);
  const [stations, setStations] = useState<AirStation[]>([]);
  const [dialErr, setDialErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AirStation[] | null>(null);
  const [hd, setHd] = useState<number | null>(() => Number(lsGet('slate.fm.hd')) || null);
  const [hdNow, setHdNow] = useState<HdNow | null>(null);
  const [scan, setScan] = useState<HdScan | null>(null);

  useEffect(() => { api<MaskedMediaSettings>('/api/media/settings').then(setSettings).catch(() => {}); }, []);
  useEffect(() => { api<FmStatus>('/api/media/fm/status').then(setStatus).catch(() => {}); }, [settings?.fm.source]);
  const internet = status?.source === 'internet';
  const server = status?.source === 'hdserver';
  const src: FmSourceNow = status?.source ?? 'tuner';
  /** HD channels can be picked: the HD Radio server, or the truck's tuner with nrsc5. */
  const hdOk = server || (status?.source === 'tuner' && !!status.hd?.tuner);
  const hdSel = server ? hd ?? 1 : hdOk ? hd : null;
  useEffect(() => {
    if (!internet) return;
    setLoading(true); setDialErr(null);
    api<{ stations: AirStation[] }>('/api/media/fm/stations').then((r) => setStations(r.stations), (e: Error) => setDialErr(e.message)).finally(() => setLoading(false));
  }, [internet]);

  const band = mhz < 2 ? 'AM' : 'FM';
  const onBand = stations.filter((x) => x.band === band && !x.hd);
  const here = stations.find((x) => !x.hd && Math.abs(x.mhz - mhz) < 0.005) ?? null;
  const playing = p.current?.source === 'fm';
  const isOn = (id: string) => playing && p.current?.id === id;
  const onHd = playing && !!p.current?.id.startsWith('hd:');
  useEffect(() => {
    if (!onHd) { setHdNow(null); return; }
    let live = true;
    const read = () => api<HdNow | null>('/api/media/fm/hd/now').then((n) => { if (live) setHdNow(n); }, () => {});
    const t = window.setInterval(read, 5000);
    const first = window.setTimeout(read, 1500);
    return () => { live = false; clearInterval(t); clearTimeout(first); };
  }, [onHd, p.current?.id]);

  // The HD scan: what's already known on load, then progress every 2 s while it runs.
  const tunerHd = status?.source === 'tuner' && !!status.hd?.tuner;
  useEffect(() => { if (tunerHd) api<HdScan>('/api/media/fm/hd/scan').then(setScan).catch(() => {}); }, [tunerHd]);
  const scanning = !!scan?.job?.running;
  useEffect(() => {
    if (!scanning) return;
    const t = window.setInterval(() => api<HdScan>('/api/media/fm/hd/scan').then(setScan).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [scanning]);
  const startScan = async (scope: 'presets' | 'band') => {
    if (playing) player.stop();
    try { const r = await api<{ job: HdScan['job'] }>('/api/media/fm/hd/scan', { method: 'POST', body: JSON.stringify({ scope }) }); setScan((x) => ({ found: x?.found ?? [], job: r.job })); }
    catch (e) { toast((e as Error).message); }
  };
  const backToHd = () => api('/api/media/fm/hd/retry', { method: 'POST' }).then(() => toast('Trying HD again…'), (e: Error) => toast(e.message));
  const foundHere = scan?.found.find((x) => Math.abs(x.mhz - mhz) < 0.005) ?? null;

  const playStation = (st: AirStation) => { if (st.mhz) { setMhz(st.mhz); lsSet('slate.fm.mhz', String(st.mhz)); } player.play(fmNetTrack(st)); };
  const listen = (f: number, ch: number | null = hdSel) => {
    if (server) { if (f < 2) { toast('The HD Radio server is FM only'); return; } player.play(hdTrack(f, ch ?? 1, 'server')); return; }
    if (!internet) { player.play(ch && f >= 87.5 ? hdTrack(f, ch, 'tuner') : fmTrack(f)); return; }
    const st = stations.find((x) => !x.hd && Math.abs(x.mhz - f) < 0.005);
    if (st) playStation(st); else toast(`No internet stream for ${fmName(f)}: try Find below`);
  };
  const tune = (f: number) => {
    const n = Math.round(f * 100) / 100;
    const v = n < 2 ? Math.min(1.71, Math.max(0.53, n)) : Math.min(107.9, Math.max(87.9, n));
    setMhz(v); lsSet('slate.fm.mhz', String(v));
    if (playing) listen(v);
  };
  const next = (dir: 1 | -1) => {
    const list = dir === 1 ? onBand.filter((x) => x.mhz > mhz + 0.001) : onBand.filter((x) => x.mhz < mhz - 0.001).reverse();
    const st = list[0] ?? (dir === 1 ? onBand[0] : onBand[onBand.length - 1]);
    if (st) playStation(st); else toast(`No ${band} streams here`);
  };
  const pickHd = (ch: number | null) => {
    setHd(ch); lsSet('slate.fm.hd', String(ch ?? 0));
    if (playing) listen(mhz, ch);
  };
  const seek = async (dir: 1 | -1) => {
    if (internet) return next(dir);
    setSeeking(true);
    try { const r = await api<{ mhz: number | null }>('/api/media/fm/seek', { method: 'POST', body: JSON.stringify({ from: mhz, dir }) }); if (r.mhz) { setMhz(r.mhz); listen(r.mhz); } else toast('No strong stations found'); }
    catch (e) { toast((e as Error).message); } finally { setSeeking(false); }
  };
  const switchBand = () => {
    const to = band === 'AM' ? 'FM' : 'AM';
    const first = internet ? stations.find((x) => x.band === to && !x.hd)?.mhz : undefined;
    tune(first ?? (to === 'FM' ? 98.7 : 0.62));
  };

  const presets: FmPreset[] = settings?.fm.presets ?? [];
  const putSettings = async (fm: Record<string, unknown>, msg?: string) => {
    try { setSettings(await api<MaskedMediaSettings>('/api/media/settings', { method: 'PUT', body: JSON.stringify({ fm }) })); if (msg) toast(msg); }
    catch (e) { toast((e as Error).message); }
  };
  const savePreset = (st: AirStation | null) => {
    const f = st?.mhz ?? mhz;
    const ch = st ? null : f >= 87.5 ? hdSel : null;
    if (presets.some((x) => (st ? x.streamId === st.id : Math.abs(x.mhz - f) < 0.005 && (x.hd ?? null) === ch))) return toast('Already a preset');
    const station = !st && hdNow && hdNow.mhz === f && hdNow.station ? hdNow.station : null;
    const name = (st ? callSign(st.name) : station ? `${station}${ch && ch > 1 ? ` HD${ch}` : ''}` : `${fmName(f)}${ch ? ` HD${ch}` : ''}`).slice(0, 40);
    void putSettings({ presets: [...presets, { mhz: f, name, streamId: st?.id ?? null, ...(ch ? { hd: ch } : {}) }] }, `Saved ${name}`);
  };
  const find = async () => {
    try { setFound((await api<{ stations: AirStation[] }>(`/api/media/fm/find?q=${encodeURIComponent(q.trim())}`)).stations); } catch (e) { toast((e as Error).message); }
  };
  const row = (st: AirStation) => (
    <div class={`item row ${isOn(st.id) ? 'sel' : ''}`}>
      <button type="button" class="grow mrow" onClick={() => (isOn(st.id) ? player.toggle() : playStation(st))}>
        <b class="ellip">{st.mhz ? `${fmName(st.mhz)} · ` : ''}{st.name}</b>
        <span class="dimtxt ellip" style="font-size:13px">{st.slogan ?? ''}</span>
      </button>
      <button type="button" class="btn sm" title="Save as a preset" onClick={() => savePreset(st)}>☆</button>
    </div>
  );
  const tuner = status?.tuner;

  return (
    <div class="mpane">
      {status && !internet && !server && tuner && tuner.state !== 'present' && tuner.state !== 'busy' && <div class="banner">{tuner.message}</div>}
      {playing && p.error && <div class="banner bad">{p.error}</div>}
      <div class="row wrap" style="gap:18px">
        <div>
          <div class="fmfreq num" aria-live="polite">{mhz < 2 ? Math.round(mhz * 1000) : mhz.toFixed(1)}<small>{mhz < 2 ? 'kHz AM' : 'MHz FM'}</small></div>
          {internet && <div class="dimtxt ellip" style="max-width:380px">{here ? `${here.name}${here.slogan ? ` · ${here.slogan}` : ''}` : loading ? 'Loading local stations…' : 'No stream on this frequency'}</div>}
        </div>
        <div class="row wrap">
          {!server && <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(-1)} aria-label="Previous station">⏪ {internet ? 'Prev' : 'Seek'}</button>}
          {!internet && <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz - 0.01 : mhz - 0.2)} aria-label="Down one step">−</button>}
          {!internet && <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz + 0.01 : mhz + 0.2)} aria-label="Up one step">+</button>}
          {!server && <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(1)} aria-label="Next station">{internet ? 'Next' : 'Seek'} ⏩</button>}
          <button class="btn big primary" type="button" onClick={() => (playing && p.playing ? player.stop() : listen(mhz))}>{playing && p.playing ? 'Stop' : 'Listen'}</button>
          {!server && <button class="btn big" type="button" onClick={switchBand}>{band === 'AM' ? 'FM' : 'AM'}</button>}
        </div>
      </div>
      {hdOk && band === 'FM' && (
        <div class="row wrap" style="align-items:center">
          <span class="lbl">HD Radio</span>
          {!server && <button type="button" class={`btn sm ${hdSel === null ? 'primary' : ''}`} onClick={() => pickHd(null)}>Analog</button>}
          {[1, 2, 3, 4].map((n) => {
            const progs = hdNow?.mhz === mhz && hdNow.programs.length ? hdNow.programs : foundHere?.hd ? foundHere.programs : [];
            const type = progs.find((x) => x.hd === n)?.type;
            const known = progs.length > 0;
            return <button type="button" class={`btn sm ${hdSel === n ? 'primary' : ''}`} style={known && !type ? 'opacity:.5' : ''} onClick={() => pickHd(n)}>HD{n}{type ? <small class="dimtxt"> {type}</small> : null}</button>;
          })}
        </div>
      )}
      {onHd && hdNow?.fallback && (
        <div class="banner row between" style="align-items:center">
          <span>{hdNow.fallback.analog
            ? `HD signal lost: playing the station’s analog signal${hdNow.fallback.retryAt ? `. Trying HD again at ${clock(hdNow.fallback.retryAt)}` : ''}.`
            : 'Trying the HD signal again (a few seconds of quiet)…'}</span>
          {hdNow.fallback.analog && <button type="button" class="btn sm" onClick={() => void backToHd()}>Back to HD</button>}
        </div>
      )}
      {onHd && hdNow?.alert && <div class="banner bad">Emergency alert: {hdNow.alert}</div>}
      {onHd && (
        <div class="row" style="gap:12px;align-items:center">
          {hdNow?.art && <img src={hdNow.art} alt="" width={64} height={64} style="border-radius:8px;object-fit:cover" />}
          <div class="dimtxt ellip" style="max-width:520px">
            {hdNow?.title ? `${hdNow.title}${hdNow.artist ? ` · ${hdNow.artist}` : ''}` : hdNow?.fallback?.analog ? 'Analog signal: no song titles' : hdNow?.synced ? 'HD signal locked: waiting for the song title…' : 'Looking for the HD signal (a few seconds; it needs a strong station)…'}
            {hdNow && (hdNow.station || hdNow.slogan || hdNow.merDb !== null) && <div style="font-size:13px">{[hdNow.station, hdNow.slogan, hdNow.merDb !== null ? `signal ${hdNow.merDb} dB` : null].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
      )}
      {seeking && <div class="dimtxt">Scanning the band (a few seconds)…</div>}
      <div class="row between"><span class="lbl">Presets</span>
        <button class="btn sm" type="button" disabled={internet && !here} onClick={() => savePreset(internet ? here : null)}>+ Save {internet && here ? callSign(here.name) : `${fmName(mhz)}${hdSel && band === 'FM' ? ` HD${hdSel}` : ''}`}</button>
      </div>
      <div class="row wrap">
        {presets.length ? presets.map((x, i) => (
          <span class="row" style="gap:2px">
            <button type="button" class={`btn big ${isOn(presetTrack(x, src).id) ? 'primary' : ''}`} onClick={() => { if (x.mhz) setMhz(x.mhz); if (x.hd) { setHd(x.hd); lsSet('slate.fm.hd', String(x.hd)); } player.play(presetTrack(x, src)); }}>{x.name}{x.mhz && x.name !== fmName(x.mhz) ? <small class="dimtxt"> {fmName(x.mhz)}{x.hd ? ` HD${x.hd}` : ''}</small> : null}</button>
            <button type="button" class="btn sm" aria-label={`Remove ${x.name}`} onClick={() => void putSettings({ presets: presets.filter((_, j) => j !== i) }, `Removed ${x.name}`)}>✕</button>
          </span>
        )) : <span class="dimtxt" style="font-size:14px">No presets yet: pick a station, then Save.</span>}
      </div>
      {internet && (
        <>
          <div class="lbl">Stations here · {onBand.length} {band}</div>
          {dialErr && <div class="err">{dialErr}</div>}
          <div class="list">{onBand.map(row)}</div>
          <div class="lbl">Find a station that isn't listed</div>
          <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 1) void find(); }}>
            <input class="grow minput" type="search" placeholder="Call sign or name, e.g. KTAR" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <button class="btn" type="submit">Find</button>
          </form>
          {found && (found.length ? <div class="list">{found.map(row)}</div> : <div class="dimtxt">Nothing found.</div>)}
        </>
      )}
      {tunerHd && (
        <>
          <div class="row between" style="align-items:center">
            <span class="lbl">HD stations{scan?.found.some((x) => x.hd) ? ` · ${scan.found.filter((x) => x.hd).length} found` : ''}</span>
            <span class="row" style="gap:6px">
              <button type="button" class="btn sm" disabled={scanning || !presets.some((x) => x.mhz >= 87.5)} onClick={() => void startScan('presets')}>Check presets</button>
              <button type="button" class="btn sm" disabled={scanning} onClick={() => void startScan('band')}>Scan the band</button>
            </span>
          </div>
          {scanning && scan?.job && <div class="dimtxt">Listening for HD on {scan.job.current ? fmName(scan.job.current) : '…'} ({scan.job.done + 1} of {scan.job.total}): the radio is off while it looks, up to 15 s a station.</div>}
          {!scanning && scan?.job?.error && <div class="dimtxt">{scan.job.error}</div>}
          {scan?.found.some((x) => x.hd) ? (
            <div class="list">{scan.found.filter((x) => x.hd).map((x) => (
              <div class="item row wrap" style="gap:6px;align-items:center">
                <b class="grow ellip">{fmName(x.mhz)}{x.station ? ` · ${x.station}` : ''}{x.slogan ? <small class="dimtxt"> {x.slogan}</small> : null}</b>
                {x.programs.map((g) => {
                  const t = hdTrack(x.mhz, g.hd, 'tuner', x.station ?? undefined);
                  return <button type="button" class={`btn sm ${isOn(t.id) ? 'primary' : ''}`} onClick={() => { setMhz(x.mhz); lsSet('slate.fm.mhz', String(x.mhz)); setHd(g.hd); lsSet('slate.fm.hd', String(g.hd)); player.play(t); }}>HD{g.hd}{g.type ? <small class="dimtxt"> {g.type}</small> : null}</button>;
                })}
              </div>
            ))}</div>
          ) : !scanning && <div class="dimtxt" style="font-size:14px">{scan?.found.length ? `No HD heard on ${scan.found.map((x) => x.mhz.toFixed(1)).join(', ')}.` : 'Find out which stations here broadcast in HD, and what’s on their HD2-HD4.'}</div>}
          {!scanning && !!scan?.found.length && scan.found.some((x) => x.hd) && scan.found.some((x) => !x.hd) && <div class="dimtxt" style="font-size:13px">No HD on {scan.found.filter((x) => !x.hd).map((x) => x.mhz.toFixed(1)).join(', ')}.</div>}
        </>
      )}
      <div class="row wrap" style="align-items:center">
        <span class="lbl">Play AM/FM through</span>
        {(['auto', 'internet', 'tuner', ...(status?.hd?.server.configured ? ['hdserver' as const] : [])] as const).map((s) => (
          <button type="button" class={`btn sm ${(settings?.fm.source ?? 'auto') === s ? 'primary' : ''}`} onClick={() => void putSettings({ source: s })}>{s === 'auto' ? 'Auto' : s === 'internet' ? 'Internet streams' : s === 'tuner' ? 'Tuner' : 'HD Radio server'}</button>
        ))}
      </div>
      {server && status?.hd && !status.hd.server.reachable && <div class="banner">The HD Radio server isn't answering: it's usually only reachable on home Wi-Fi or over Tailscale.</div>}
      <div class="attrib">{server
        ? 'HD Radio from your nrsc5-webplayer (its own RTL-SDR tuner, e.g. at home): the truck tunes it and plays its stream, about 43 MB an hour over cellular. Everyone listening to that server hears the same station.'
        : internet
        ? 'The local stations’ own internet streams (via TuneIn and radio-browser.info): about 58 MB an hour of data. A few chains (iHeart) stream only in their own app; use CarPlay for those.'
        : 'Over-the-air radio through an RTL-SDR USB tuner: no data used. AM needs the RTL-SDR Blog V4 (or a long-wire antenna) and is experimental.'}</div>
    </div>
  );
}
