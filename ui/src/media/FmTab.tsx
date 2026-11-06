// AM/FM: the tuner when one is plugged in, else the local stations' own
// internet streams (brain/src/media/airstreams.ts). With streams, Prev/Next
// walk the stations that have one, and a station missing from the list can be
// found by call sign and kept as a preset.
import { useEffect, useState } from 'preact/hooks';
import { api, toast, useStore } from '../lib/brain.ts';
import { player, playerStore, type Track } from './player.ts';
import type { MaskedMediaSettings } from './status.ts';

export type AirStation = { id: string; mhz: number; band: 'FM' | 'AM'; hd: string | null; name: string; slogan: string | null; image: string | null };
export type FmPreset = { mhz: number; name: string; streamId?: string | null };
type FmStatus = { tuner: { state: string; message: string }; source: 'tuner' | 'internet'; setting: string };

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export const fmName = (mhz: number) => (mhz < 2 ? `${Math.round(mhz * 1000)} AM` : `${mhz.toFixed(1)} FM`);
export const fmTrack = (mhz: number, name?: string): Track => ({ source: 'fm', id: String(mhz), url: `/api/media/fm/stream?mhz=${mhz}`, title: name && name !== fmName(mhz) ? `${name} · ${fmName(mhz)}` : fmName(mhz), artist: null, album: 'AM/FM radio', art: null, live: true, dataHeavy: false, kbps: null });
export const fmNetTrack = (st: { id: string; mhz: number; name: string; image?: string | null }): Track => ({
  source: 'fm', id: st.id, url: `/api/media/fm/net/${encodeURIComponent(st.id)}`, title: st.mhz ? `${st.name} · ${fmName(st.mhz)}` : st.name,
  artist: null, album: 'AM/FM radio (internet stream)', art: st.image ?? null, live: true, dataHeavy: true, kbps: 128,
});
/** A preset plays its saved stream when there's no tuner, else the tuner. */
export const presetTrack = (x: FmPreset, internet: boolean): Track => (internet && x.streamId ? fmNetTrack({ id: x.streamId, mhz: x.mhz, name: x.name }) : fmTrack(x.mhz, x.name));
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

  useEffect(() => { api<MaskedMediaSettings>('/api/media/settings').then(setSettings).catch(() => {}); }, []);
  useEffect(() => { api<FmStatus>('/api/media/fm/status').then(setStatus).catch(() => {}); }, [settings?.fm.source]);
  const internet = status?.source === 'internet';
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

  const playStation = (st: AirStation) => { if (st.mhz) { setMhz(st.mhz); lsSet('slate.fm.mhz', String(st.mhz)); } player.play(fmNetTrack(st)); };
  const listen = (f: number) => {
    if (!internet) { player.play(fmTrack(f)); return; }
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
  const seek = async (dir: 1 | -1) => {
    if (internet) return next(dir);
    setSeeking(true);
    try { const r = await api<{ mhz: number | null }>('/api/media/fm/seek', { method: 'POST', body: JSON.stringify({ from: mhz, dir }) }); if (r.mhz) { setMhz(r.mhz); player.play(fmTrack(r.mhz)); } else toast('No strong stations found'); }
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
    if (presets.some((x) => (st ? x.streamId === st.id : Math.abs(x.mhz - f) < 0.005))) return toast('Already a preset');
    const name = (st ? callSign(st.name) : fmName(f)).slice(0, 40);
    void putSettings({ presets: [...presets, { mhz: f, name, streamId: st?.id ?? null }] }, `Saved ${name}`);
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
      {status && !internet && tuner && tuner.state !== 'present' && tuner.state !== 'busy' && <div class="banner">{tuner.message}</div>}
      {playing && p.error && <div class="banner bad">{p.error}</div>}
      <div class="row wrap" style="gap:18px">
        <div>
          <div class="fmfreq num" aria-live="polite">{mhz < 2 ? Math.round(mhz * 1000) : mhz.toFixed(1)}<small>{mhz < 2 ? 'kHz AM' : 'MHz FM'}</small></div>
          {internet && <div class="dimtxt ellip" style="max-width:380px">{here ? `${here.name}${here.slogan ? ` · ${here.slogan}` : ''}` : loading ? 'Loading local stations…' : 'No stream on this frequency'}</div>}
        </div>
        <div class="row wrap">
          <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(-1)} aria-label="Previous station">⏪ {internet ? 'Prev' : 'Seek'}</button>
          {!internet && <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz - 0.01 : mhz - 0.2)} aria-label="Down one step">−</button>}
          {!internet && <button class="btn big" type="button" onClick={() => tune(mhz < 2 ? mhz + 0.01 : mhz + 0.2)} aria-label="Up one step">+</button>}
          <button class="btn big" type="button" disabled={seeking} onClick={() => void seek(1)} aria-label="Next station">{internet ? 'Next' : 'Seek'} ⏩</button>
          <button class="btn big primary" type="button" onClick={() => (playing && p.playing ? player.stop() : listen(mhz))}>{playing && p.playing ? 'Stop' : 'Listen'}</button>
          <button class="btn big" type="button" onClick={switchBand}>{band === 'AM' ? 'FM' : 'AM'}</button>
        </div>
      </div>
      {seeking && <div class="dimtxt">Scanning the band (a few seconds)…</div>}
      <div class="row between"><span class="lbl">Presets</span>
        <button class="btn sm" type="button" disabled={internet && !here} onClick={() => savePreset(internet ? here : null)}>+ Save {internet && here ? callSign(here.name) : fmName(mhz)}</button>
      </div>
      <div class="row wrap">
        {presets.length ? presets.map((x, i) => (
          <span class="row" style="gap:2px">
            <button type="button" class={`btn big ${isOn(x.streamId && internet ? x.streamId : String(x.mhz)) ? 'primary' : ''}`} onClick={() => { if (x.mhz) setMhz(x.mhz); player.play(presetTrack(x, internet)); }}>{x.name}{x.mhz && x.name !== fmName(x.mhz) ? <small class="dimtxt"> {fmName(x.mhz)}</small> : null}</button>
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
      <div class="row wrap" style="align-items:center">
        <span class="lbl">Play AM/FM through</span>
        {(['auto', 'internet', 'tuner'] as const).map((s) => (
          <button type="button" class={`btn sm ${(settings?.fm.source ?? 'auto') === s ? 'primary' : ''}`} onClick={() => void putSettings({ source: s })}>{s === 'auto' ? 'Auto' : s === 'internet' ? 'Internet streams' : 'Tuner'}</button>
        ))}
      </div>
      <div class="attrib">{internet
        ? 'The local stations’ own internet streams (via TuneIn and radio-browser.info): about 58 MB an hour of data. A few chains (iHeart) stream only in their own app; use CarPlay for those.'
        : 'Over-the-air radio through an RTL-SDR USB tuner: no data used. AM needs the RTL-SDR Blog V4 (or a long-wire antenna) and is experimental.'}</div>
    </div>
  );
}
