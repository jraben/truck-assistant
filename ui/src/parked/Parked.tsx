// PARKED: one view with tabs for the things you do while the truck is
// stopped or charging: Watch (Plex video + streaming apps), Games, Karaoke,
// Camp mode, Pet mode, Tow (trailer profiles) and Lights (WLED light show).
// Video, apps and lights stop the moment the truck moves; the brain enforces
// it too (brain/src/parked.ts, modes.ts, parkedRoutes.ts).
import { useEffect, useRef, useState } from 'preact/hooks';
import Hls from 'hls.js';
import type { Layout } from '../../../brain/src/types.ts';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import type { WP } from '../components/drive.tsx';
import './parked.css';

export const PARKED_ICON = 'M3 5h18v11H3zM8 20h8M12 16v4M10 8.5v4l3.5-2z';
export const PARKED_VIEW: Layout['views'][number] = { id: 'parked', label: 'Parked', widgets: [{ type: 'parked', col: 1, row: 1, w: 12, h: 2 }] };
export function withParkedView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'parked')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'home');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, PARKED_VIEW);
  return { ...layout, views };
}

type App = { id: string; label: string; kind: 'video' | 'games'; url: string | null; native?: string; note?: string; available: boolean };
type AppsResp = { apps: App[]; open: { id: string; label: string } | null; onScreen: boolean; moving: boolean };
type VideoItem = { key: string; type: 'movie' | 'show' | 'season' | 'episode'; title: string; subtitle: string | null; thumb: string | null; durationMs: number | null; viewOffsetMs: number | null; watched: boolean };
type Trailer = { id: string; name: string; lengthFt: number | null; weightLb: number | null; brakeGain: string | null; notes: string | null; service: { name: string; everyMonths: number; lastDone: string | null }[] };
type Modes = {
  camp: { on: boolean; relays: string[]; cutoffV: number; cutOffAt: string | null };
  pet: { on: boolean; message: string; alertF: number; fanRelay: string | null; fanOnF: number };
  trailers: Trailer[]; activeTrailer: string | null; checklist: string[]; light: { wledUrl: string | null };
};

const TABS = ['Watch', 'Games', 'Karaoke', 'Camp', 'Pet', 'Tow', 'Lights'] as const;
type Tab = (typeof TABS)[number];
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private */ } };
const useMoving = () => { const s = useStore(stateStore); return s?.drive?.lockout.locked ?? (s?.speedMph ?? 0) >= 2; };

function useModes(): [Modes | null, (m: Modes) => void, (patch: unknown) => Promise<void>] {
  const [m, setM] = useState<Modes | null>(null);
  useEffect(() => { api<Modes>('/api/modes').then(setM, () => {}); }, []);
  const patch = async (p: unknown) => { try { setM(await api<Modes>('/api/modes', { method: 'PATCH', body: JSON.stringify(p) })); } catch (e) { toast((e as Error).message); } };
  return [m, setM, patch];
}

/** Open an app: on the truck its own window; elsewhere a new tab. */
async function launch(id: string, q?: string) {
  try {
    const r = await api<{ opened: boolean; open?: string; label: string }>('/api/parked/launch', { method: 'POST', body: JSON.stringify({ id, q }) });
    if (!r.opened && r.open) window.open(r.open, '_blank', 'noopener');
    else toast(`Opening ${r.label}… (Close returns to the cockpit)`);
  } catch (e) { toast((e as Error).message); }
}

export function ParkedW(_: WP) {
  const [tab, setTab] = useState<Tab>(() => (TABS.includes(lsGet('slate.parked.tab') as Tab) ? lsGet('slate.parked.tab') as Tab : 'Watch'));
  const moving = useMoving();
  const pick = (t: Tab) => { setTab(t); lsSet('slate.parked.tab', t); };
  const parkedOnly = tab === 'Watch' || tab === 'Games' || tab === 'Karaoke' || tab === 'Lights';
  return (
    <div class="card parked">
      <div class="mtabs" role="tablist">{TABS.map((t) => <button type="button" role="tab" aria-selected={tab === t} onClick={() => pick(t)}>{t}</button>)}</div>
      <div class="pbody">
        {moving && parkedOnly ? <div class="parked-lock">🅿️ Parked only<span class="dimtxt">Video, games and lights come back when you stop.</span></div> : (
          <>
            {tab === 'Watch' && <WatchTab />}
            {tab === 'Games' && <GamesTab />}
            {tab === 'Karaoke' && <KaraokeTab />}
            {tab === 'Camp' && <CampTab />}
            {tab === 'Pet' && <PetTab />}
            {tab === 'Tow' && <TowTab />}
            {tab === 'Lights' && <LightsTab />}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Watch ------------------------------------------------------------------------

function AppTiles({ kind }: { kind: 'video' | 'games' }) {
  const [r, setR] = useState<AppsResp | null>(null);
  const load = () => api<AppsResp>('/api/parked/apps').then(setR, () => {});
  useEffect(() => { void load(); const t = window.setInterval(load, 4000); return () => clearInterval(t); }, []);
  if (!r) return null;
  return (
    <>
      {r.open && <div class="banner ok row between"><span>{r.open.label} is open on the screen.</span><button class="btn" type="button" onClick={() => void api('/api/parked/close', { method: 'POST', body: '{}' }).then(load)}>Close it</button></div>}
      <div class="app-grid">
        {r.apps.filter((a) => a.kind === kind).map((a) => (
          <button type="button" class={`app-tile app-${a.id}`} disabled={!a.available} onClick={() => void launch(a.id)} title={a.note ?? a.label}>
            <b>{a.label}</b>
            <span class="dimtxt">{!a.available ? (a.native ? `Install ${a.native} on the Pi` : '') : a.note ?? (r.onScreen ? 'Opens full screen' : 'Opens in a new tab')}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function VideoPlayer({ item, onClose }: { item: VideoItem; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let hls: Hls | null = null, session = '', alive = true;
    const v = ref.current!;
    const report = (state: 'playing' | 'paused' | 'stopped') => session && void api('/api/media/plex/video/timeline', { method: 'POST', body: JSON.stringify({ key: item.key, state, timeMs: v.currentTime * 1000 + (item.viewOffsetMs ?? 0), durationMs: item.durationMs ?? 0, session }) }).catch(() => {});
    api<{ url: string; session: string }>('/api/media/plex/video/start', { method: 'POST', body: JSON.stringify({ key: item.key, offsetMs: item.viewOffsetMs ?? 0 }) }).then((s) => {
      if (!alive) return;
      session = s.session;
      if (Hls.isSupported()) {
        hls = new Hls({ maxBufferLength: 30 });
        hls.loadSource(s.url); hls.attachMedia(v);
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setErr(`Plex stream failed (${d.details})`); });
      } else v.src = s.url;
      void v.play().catch(() => {});
    }, (e: Error) => setErr(e.message));
    const tick = window.setInterval(() => report(v.paused ? 'paused' : 'playing'), 10_000);
    return () => { alive = false; clearInterval(tick); report('stopped'); hls?.destroy(); };
  }, [item.key]);
  const moving = useMoving();
  useEffect(() => { if (moving) onClose(); }, [moving]);
  return (
    <div class="vplayer">
      <video ref={ref} controls autoPlay playsInline />
      <div class="row between"><b class="ellip">{item.title}{item.subtitle ? ` · ${item.subtitle}` : ''}</b><button class="btn" type="button" onClick={onClose}>Close</button></div>
      {err && <div class="err">{err}</div>}
    </div>
  );
}

function WatchTab() {
  const [mode, setMode] = useState<'apps' | 'plex'>('apps');
  return (
    <div class="mpane">
      <div class="row wrap">
        <button class={`btn sm ${mode === 'apps' ? 'primary' : ''}`} type="button" onClick={() => setMode('apps')}>Streaming apps</button>
        <button class={`btn sm ${mode === 'plex' ? 'primary' : ''}`} type="button" onClick={() => setMode('plex')}>Plex</button>
      </div>
      {mode === 'apps' ? (
        <>
          <AppTiles kind="video" />
          <div class="attrib">Each app signs in once with your own account. On the truck they open full screen over the cockpit and close the moment you drive off. About 1–3 GB an hour of data: home Wi-Fi or a charger's Wi-Fi is best.</div>
        </>
      ) : <PlexVideoBrowser />}
    </div>
  );
}

function PlexVideoBrowser() {
  const [sections, setSections] = useState<{ key: string; title: string; type: string }[]>([]);
  const [sec, setSec] = useState<string>('deck');
  const [stack, setStack] = useState<VideoItem[]>([]);
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { api<typeof sections>('/api/media/plex/video/sections').then(setSections, (e: Error) => setErr(e.message)); }, []);
  const top = stack[stack.length - 1];
  useEffect(() => {
    setItems(null); setErr(null);
    const p = top ? `/api/media/plex/video/children?key=${top.key}` : sec === 'deck' ? '/api/media/plex/video/ondeck' : sec.startsWith('q:') ? `/api/media/plex/video/search?q=${encodeURIComponent(sec.slice(2))}` : `/api/media/plex/video/recent?section=${sec}`;
    api<VideoItem[]>(p).then(setItems, (e: Error) => setErr(e.message));
  }, [sec, top?.key]);
  if (playing) return <VideoPlayer item={playing} onClose={() => setPlaying(null)} />;
  const open = (it: VideoItem) => (it.type === 'movie' || it.type === 'episode' ? setPlaying(it) : setStack([...stack, it]));
  return (
    <>
      <div class="row wrap">
        <button class={`btn sm ${sec === 'deck' && !top ? 'primary' : ''}`} type="button" onClick={() => { setSec('deck'); setStack([]); }}>Continue watching</button>
        {sections.map((s) => <button class={`btn sm ${sec === s.key && !top ? 'primary' : ''}`} type="button" onClick={() => { setSec(s.key); setStack([]); }}>{s.title}</button>)}
        <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { setSec(`q:${q.trim()}`); setStack([]); } }}>
          <input class="minput" type="search" placeholder="Search Plex" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </form>
      </div>
      {top && <div class="row"><button class="btn sm" type="button" onClick={() => setStack(stack.slice(0, -1))}>← Back</button><b class="ellip">{stack.map((s) => s.title).join(' › ')}</b></div>}
      {err && <div class="err">{err}</div>}
      {!items && !err && <div class="dimtxt">Loading…</div>}
      <div class="mgrid">
        {(items ?? []).slice(0, 120).map((it) => (
          <button type="button" class="mtile" onClick={() => open(it)}>
            {it.thumb ? <img src={it.thumb} alt="" loading="lazy" /> : <span class="noart">🎬</span>}
            <b class="ellip">{it.title}</b>
            <span class="dimtxt ellip">{it.subtitle ?? ''}{it.viewOffsetMs ? ' · resume' : it.watched ? ' · ✓' : ''}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ---- Games / Karaoke --------------------------------------------------------------------

function GamesTab() {
  return (
    <div class="mpane">
      <AppTiles kind="games" />
      <div class="attrib">Pair a Bluetooth game controller once in the Pi's Bluetooth settings. Moonlight plays PC games from a gaming PC at home; RetroArch plays classic console games.</div>
    </div>
  );
}

function KaraokeTab() {
  const [q, setQ] = useState('');
  const picks = ['Bohemian Rhapsody', 'Friends in Low Places', "Don't Stop Believin'", 'Sweet Caroline', 'Livin\' on a Prayer', 'Wagon Wheel'];
  return (
    <div class="mpane">
      <form class="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void launch('karaoke', q); }}>
        <input class="grow minput" type="search" placeholder="Song or artist" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button class="btn big primary" type="submit">Sing</button>
      </form>
      <div class="row wrap">{picks.map((p) => <button class="btn" type="button" onClick={() => void launch('karaoke', p)}>{p}</button>)}</div>
      <div class="attrib">Karaoke videos with on-screen lyrics from YouTube. To hear yourself through the speakers, plug a USB microphone into the Pi (about $20).</div>
    </div>
  );
}

// ---- Camp / Pet ------------------------------------------------------------------------------

function RelayPick({ value, onChange, multi }: { value: string[]; onChange: (v: string[]) => void; multi: boolean }) {
  const s = useStore(stateStore);
  const relays = Object.entries(s?.relays ?? {});
  return (
    <div class="row wrap">
      {relays.map(([id, r]) => {
        const on = value.includes(id);
        return <button type="button" class={`btn sm ${on ? 'primary' : ''}`} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== id) : [...value, id]) : on ? [] : [id])}>{r.name || id}</button>;
      })}
    </div>
  );
}

function CampTab() {
  const [m, setM, patch] = useModes();
  const s = useStore(stateStore);
  if (!m) return <div class="dimtxt">Loading…</div>;
  const toggle = async () => { try { setM(await api<Modes>('/api/modes/camp', { method: 'POST', body: JSON.stringify({ on: !m.camp.on }) })); } catch (e) { toast((e as Error).message); } };
  return (
    <div class="mpane">
      <div class="row wrap" style="align-items:center">
        <button class={`btn big ${m.camp.on ? 'primary' : ''}`} type="button" onClick={() => void toggle()}>{m.camp.on ? '⛺ Camp mode is ON: end it' : '⛺ Start camp mode'}</button>
        <span class="dimtxt">12V {s?.aux12v?.toFixed(2) ?? '—'} V · Cab {s?.cabinTempF !== null && s?.cabinTempF !== undefined ? Math.round(s.cabinTempF) : '—'}°F · Level: pitch {s?.tilt?.pitch?.toFixed(1) ?? '—'}° roll {s?.tilt?.roll?.toFixed(1) ?? '—'}°</span>
      </div>
      {m.camp.cutOffAt && <div class="banner bad">12V dropped below {m.camp.cutoffV} V, so camp mode switched its relays off.</div>}
      <div class="lbl">Turn these on with camp mode</div>
      <RelayPick value={m.camp.relays} multi onChange={(v) => void patch({ camp: { relays: v } })} />
      <label class="f" style="max-width:260px"><span>Switch them off below (V)</span><input type="number" step="0.1" value={m.camp.cutoffV} onChange={(e) => void patch({ camp: { cutoffV: Number((e.target as HTMLInputElement).value) } })} /></label>
      <div class="attrib">Camp mode dims the screen to a clock, mutes chimes, runs the relays you pick (bed lights, fan, fridge) and protects the 12V battery. It ends when you drive. The truck's own heat and A/C can't be run from here.</div>
    </div>
  );
}

function PetTab() {
  const [m, setM, patch] = useModes();
  if (!m) return <div class="dimtxt">Loading…</div>;
  const toggle = async () => { try { setM(await api<Modes>('/api/modes/pet', { method: 'POST', body: JSON.stringify({ on: !m.pet.on }) })); } catch (e) { toast((e as Error).message); } };
  return (
    <div class="mpane">
      <button class={`btn big ${m.pet.on ? 'primary' : ''}`} type="button" onClick={() => void toggle()}>{m.pet.on ? '🐕 Pet mode is ON: end it' : '🐕 Start pet mode'}</button>
      <label class="f"><span>Message on the screen</span><input type="text" maxLength={120} value={m.pet.message} onChange={(e) => void patch({ pet: { message: (e.target as HTMLInputElement).value } })} /></label>
      <div class="row wrap">
        <label class="f"><span>Push to my phone at (°F)</span><input type="number" value={m.pet.alertF} onChange={(e) => void patch({ pet: { alertF: Number((e.target as HTMLInputElement).value) } })} /></label>
        <label class="f"><span>Run the fan above (°F)</span><input type="number" value={m.pet.fanOnF} onChange={(e) => void patch({ pet: { fanOnF: Number((e.target as HTMLInputElement).value) } })} /></label>
      </div>
      <div class="lbl">Fan relay</div>
      <RelayPick value={m.pet.fanRelay ? [m.pet.fanRelay] : []} multi={false} onChange={(v) => void patch({ pet: { fanRelay: v[0] ?? null } })} />
      <div class="banner">The truck's A/C can't be kept running from here, so pet mode is a warning and a fan, not air conditioning. In Phoenix heat, don't count on it to keep them cool.</div>
    </div>
  );
}

// ---- Tow ------------------------------------------------------------------------------------

function TowTab() {
  const [m, , patch] = useModes();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Trailer | null>(null);
  if (!m) return <div class="dimtxt">Loading…</div>;
  const active = m.trailers.find((t) => t.id === m.activeTrailer) ?? null;
  const save = (t: Trailer) => { void patch({ trailers: m.trailers.some((x) => x.id === t.id) ? m.trailers.map((x) => (x.id === t.id ? t : x)) : [...m.trailers, t] }); setEdit(null); };
  const today = new Date().toISOString().slice(0, 10);
  if (edit) return <TrailerForm t={edit} onSave={save} onCancel={() => setEdit(null)} onDelete={() => { void patch({ trailers: m.trailers.filter((x) => x.id !== edit.id) }); setEdit(null); }} />;
  return (
    <div class="tow">
      <div class="mpane">
        <div class="row wrap">
          <button class={`btn ${!active ? 'primary' : ''}`} type="button" onClick={() => void patch({ activeTrailer: null })}>No trailer</button>
          {m.trailers.map((t) => <button class={`btn ${active?.id === t.id ? 'primary' : ''}`} type="button" onClick={() => { void patch({ activeTrailer: t.id }); setChecked(new Set()); }}>{t.name}</button>)}
          <button class="btn" type="button" onClick={() => setEdit({ id: `t${Date.now().toString(36)}`, name: '', lengthFt: null, weightLb: null, brakeGain: null, notes: null, service: [{ name: 'Wheel bearings', everyMonths: 12, lastDone: null }, { name: 'Tires', everyMonths: 60, lastDone: null }] })}>+ Trailer</button>
        </div>
        {active && (
          <>
            <div class="row wrap"><b style="font-size:22px">{active.name}</b><span class="dimtxt">{[active.lengthFt && `${active.lengthFt} ft`, active.weightLb && `${active.weightLb.toLocaleString()} lb`, active.brakeGain && `brake gain ${active.brakeGain}`].filter(Boolean).join(' · ')}</span><button class="btn sm" type="button" onClick={() => setEdit(active)}>Edit</button></div>
            {active.notes && <div class="dimtxt">{active.notes}</div>}
            <div class="lbl">Service</div>
            {active.service.map((s, i) => {
              const due = s.lastDone ? (() => { const d = new Date(`${s.lastDone}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + s.everyMonths); return d.toISOString().slice(0, 10); })() : null;
              return (
                <div class="row between item">
                  <span>{s.name} <span class={`dimtxt ${due && due <= today ? 'badc' : ''}`}>{due ? (due <= today ? `due since ${due}` : `next ${due}`) : 'never logged'}</span></span>
                  <button class="btn sm" type="button" onClick={() => save({ ...active, service: active.service.map((x, j) => (j === i ? { ...x, lastDone: today } : x)) })}>Done today</button>
                </div>
              );
            })}
          </>
        )}
      </div>
      <div class="mpane">
        <div class="row between"><span class="lbl">Hookup checklist {checked.size}/{m.checklist.length}</span><button class="btn sm" type="button" onClick={() => setChecked(new Set())}>Reset</button></div>
        <div class="checklist">
          {m.checklist.map((c, i) => (
            <button type="button" class={`item ${checked.has(i) ? 'sel' : ''}`} onClick={() => { const n = new Set(checked); if (n.has(i)) n.delete(i); else n.add(i); setChecked(n); }}>{checked.has(i) ? '✅' : '⬜'} {c}</button>
          ))}
        </div>
        <div class="attrib">For the lights, have someone stand behind the trailer, or check them on the rear and hitch cameras (Cams).</div>
      </div>
    </div>
  );
}

function TrailerForm({ t, onSave, onCancel, onDelete }: { t: Trailer; onSave: (t: Trailer) => void; onCancel: () => void; onDelete: () => void }) {
  const [d, setD] = useState<Trailer>(t);
  const f = (k: keyof Trailer) => (e: Event) => setD({ ...d, [k]: (e.target as HTMLInputElement).value || null });
  return (
    <div class="mpane">
      <div class="fields form" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        <label class="f"><span>Name</span><input type="text" value={d.name} onInput={f('name')} placeholder="Utility 5x8" /></label>
        <label class="f"><span>Length (ft)</span><input type="number" value={d.lengthFt ?? ''} onInput={(e) => setD({ ...d, lengthFt: Number((e.target as HTMLInputElement).value) || null })} /></label>
        <label class="f"><span>Loaded weight (lb)</span><input type="number" value={d.weightLb ?? ''} onInput={(e) => setD({ ...d, weightLb: Number((e.target as HTMLInputElement).value) || null })} /></label>
        <label class="f"><span>Brake gain</span><input type="text" value={d.brakeGain ?? ''} onInput={f('brakeGain')} placeholder="5.5" /></label>
      </div>
      <label class="f"><span>Notes</span><input type="text" value={d.notes ?? ''} onInput={f('notes')} placeholder="Tire size, plate, ball size…" /></label>
      <div class="lbl">Service intervals</div>
      {d.service.map((s, i) => (
        <div class="row wrap">
          <input class="minput" value={s.name} onInput={(e) => setD({ ...d, service: d.service.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
          <label class="f"><span>every (months)</span><input type="number" style="width:90px" value={s.everyMonths} onInput={(e) => setD({ ...d, service: d.service.map((x, j) => (j === i ? { ...x, everyMonths: Number((e.target as HTMLInputElement).value) || 12 } : x)) })} /></label>
          <button class="btn sm" type="button" onClick={() => setD({ ...d, service: d.service.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <div class="row wrap">
        <button class="btn sm" type="button" onClick={() => setD({ ...d, service: [...d.service, { name: 'Service', everyMonths: 12, lastDone: null }] })}>+ Interval</button>
        <span class="sp" />
        <button class="btn danger" type="button" onClick={onDelete}>Delete</button>
        <button class="btn" type="button" onClick={onCancel}>Cancel</button>
        <button class="btn primary" type="button" disabled={!d.name.trim()} onClick={() => onSave(d)}>Save</button>
      </div>
    </div>
  );
}

// ---- Lights ----------------------------------------------------------------------------------

type Light = { on: boolean; bri: number; preset: number; fx: number; pal: number; effects: string[]; palettes: string[]; presets: { id: number; name: string }[] };
const SHOW_FX = ['Rainbow', 'Colorloop', 'Chase Rainbow', 'Fireworks', 'Twinkle', 'Fire 2012', 'Pacifica', 'Lake', 'Meteor', 'Police', 'Running', 'Theater'];

function LightsTab() {
  const [m, , patch] = useModes();
  const [l, setL] = useState<Light | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const load = () => api<Light>('/api/light').then((x) => { setL(x); setErr(null); }, (e: Error) => setErr(e.message));
  useEffect(() => { if (m?.light.wledUrl) void load(); }, [m?.light.wledUrl]);
  const set = async (b: Record<string, unknown>) => { try { setL(await api<Light>('/api/light', { method: 'POST', body: JSON.stringify(b) })); } catch (e) { toast((e as Error).message); } };
  if (!m) return <div class="dimtxt">Loading…</div>;
  if (!m.light.wledUrl) {
    return (
      <div class="mpane">
        <p style="margin:0">The light show runs an LED strip (bed lights or underglow) with a WLED controller, about $50. Enter its address once it's on the truck's Wi-Fi:</p>
        <form class="row" onSubmit={(e) => { e.preventDefault(); void patch({ light: { wledUrl: url.trim() } }); }}>
          <input class="minput" placeholder="http://192.168.4.50" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
          <button class="btn" type="submit">Save</button>
        </form>
      </div>
    );
  }
  return (
    <div class="mpane">
      {err && <div class="err">{err}</div>}
      {l && (
        <>
          <div class="row wrap" style="align-items:center">
            <button class={`btn big ${l.on ? 'primary' : ''}`} type="button" onClick={() => void set({ on: !l.on })}>{l.on ? 'Lights on: turn off' : 'Turn on'}</button>
            <label class="f grow"><span>Brightness</span><input type="range" min={1} max={255} value={l.bri} onChange={(e) => void set({ bri: Number((e.target as HTMLInputElement).value) })} /></label>
          </div>
          {l.presets.length > 0 && <><div class="lbl">Shows (WLED presets)</div><div class="row wrap">{l.presets.map((p) => <button class={`btn ${l.preset === p.id ? 'primary' : ''}`} type="button" onClick={() => void set({ ps: p.id, on: true })}>{p.name}</button>)}</div></>}
          <div class="lbl">Effects</div>
          <div class="row wrap">{SHOW_FX.map((n) => ({ n, i: l.effects.indexOf(n) })).filter((x) => x.i >= 0).map((x) => <button class={`btn sm ${l.fx === x.i ? 'primary' : ''}`} type="button" onClick={() => void set({ fx: x.i, on: true })}>{x.n}</button>)}</div>
        </>
      )}
      <div class="row wrap"><span class="dimtxt">Strip: {m.light.wledUrl}</span><button class="btn sm" type="button" onClick={() => void patch({ light: { wledUrl: null } })}>Change</button></div>
      <div class="attrib">Parked only: the strip switches off when you drive (Arizona doesn't allow flashing or colored lights on the road). For lights that pulse to the music, use a WLED controller with a microphone (WLED's sound-reactive mode).</div>
    </div>
  );
}

// ---- Overlays: pet mode message, camp mode dim ---------------------------------------------------

export function ModeOverlays() {
  const s = useStore(stateStore);
  const [m, setM] = useState<Modes | null>(null);
  const [wake, setWake] = useState(0);
  useEffect(() => { const load = () => api<Modes>('/api/modes').then(setM, () => {}); void load(); const t = window.setInterval(load, 5000); return () => clearInterval(t); }, []);
  if (!m) return null;
  const t = s?.cabinTempF ?? null;
  if (m.pet.on) {
    const hot = t !== null && t >= m.pet.alertF, warm = t !== null && t >= m.pet.fanOnF;
    return (
      <div class={`pet-screen ${hot ? 'hot' : warm ? 'warm' : ''}`}>
        <div class="pet-temp num">{t !== null ? `${Math.round(t)}°F` : '—'}</div>
        <div class="pet-msg">🐕 {m.pet.message}</div>
        <div class="dimtxt">Pet mode · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{m.pet.fanRelay ? ' · fan on when it warms up' : ''}</div>
        <button class="btn" type="button" onClick={() => void api<Modes>('/api/modes/pet', { method: 'POST', body: '{"on":false}' }).then(setM)}>End pet mode</button>
      </div>
    );
  }
  if (m.camp.on && Date.now() > wake) {
    return (
      <button type="button" class="camp-screen" onClick={() => setWake(Date.now() + 60_000)} aria-label="Camp mode: tap to wake the screen">
        <span class="num camp-clock">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span>⛺ Camp mode · 12V {s?.aux12v?.toFixed(1) ?? '—'} V · Cab {t !== null ? Math.round(t) : '—'}°F · tap to wake</span>
      </button>
    );
  }
  return null;
}

export const PARKED_WIDGETS: Record<string, (p: WP) => preact.JSX.Element | null> = { parked: ParkedW };
