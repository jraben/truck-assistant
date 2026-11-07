// HOME: the garage door as a picture you tap, Home Assistant tiles in pages
// (copied from one of HA's dashboards, e.g. the garage one), and a prompt that
// offers Open on the way home and Close when you drive off with it open.
// Brain side: brain/src/ha/panel.ts (control limited to these entities).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Layout } from '../../../brain/src/types.ts';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import type { WP } from '../components/drive.tsx';
import './home.css';

type Tile = { entity: string; domain: string; name: string; state: string; unit: string | null; deviceClass: string | null; actions: string[]; brightness: number | null };
type GarageConfig = { cover: string | null; light: string | null; obstruction: string | null; ask: boolean; nearM: number };
type PanelConfig = { garage: GarageConfig; pages: { title: string; dashboard: string | null; entities: string[] }[] };
type PanelView = { config: PanelConfig; home: { lat: number; lon: number; radiusM: number } | null; garage: { door: Tile | null; light: Tile | null; obstruction: Tile | null }; pages: { title: string; dashboard: string | null; tiles: Tile[] }[] };

export const HOME_ICON = 'M3 11 12 4l9 7M5 10v10h14V10M9 20v-6h6v6';

export const HOME_VIEW: Layout['views'][number] = {
  id: 'home', label: 'Home', widgets: [
    { type: 'garage', col: 1, row: 1, w: 4, h: 2 },
    { type: 'haPanel', col: 5, row: 1, w: 8, h: 2 },
  ],
};
/** Saved layouts from before the Home view get it after Media (or at the end). Pure. */
export function withHomeView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'home')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'media');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, HOME_VIEW);
  return { ...layout, views };
}

const act = async (entity: string, action: string) => { await api('/api/ha/act', { method: 'POST', body: JSON.stringify({ entity, action }) }); };

/** The garage door picture: panels roll up as it opens; amber stripes while moving; red edge on an obstruction. */
export function GarageDoor({ state, obstructed, size = 220 }: { state: string; obstructed?: boolean; size?: number }) {
  const open = state === 'open', moving = state === 'opening' || state === 'closing';
  const shown = open ? 0.12 : state === 'opening' ? 0.45 : state === 'closing' ? 0.6 : 1;   // fraction of the door still down
  const h = 120 * shown;
  return (
    <svg class={`garage-svg ${moving ? 'moving' : ''} ${state}`} viewBox="0 0 200 170" width={size} height={size * 0.85} role="img" aria-label={`Garage door ${state}`}>
      <path d="M10 60 100 10l90 50v105H10z" class="g-house" />
      <rect x="30" y="40" width="140" height="125" class="g-opening" />
      {open && <g class="g-inside"><rect x="58" y="120" width="84" height="34" rx="8" /><circle cx="78" cy="156" r="8" /><circle cx="122" cy="156" r="8" /></g>}
      <g class="g-door" style={{ transform: `translateY(${0}px)` }}>
        <rect x="32" y="42" width="136" height={Math.max(4, h)} class="g-panel-bg" />
        {Array.from({ length: Math.max(1, Math.ceil(h / 24)) }, (_, i) => (
          <rect x="32" y={42 + h - (i + 1) * 24} width="136" height="22" class="g-panel" style={{ display: 42 + h - (i + 1) * 24 + 22 < 42 ? 'none' : undefined }} />
        ))}
        <rect x="32" y={40 + h} width="136" height="4" class={`g-edge ${obstructed ? 'bad' : ''}`} />
      </g>
    </svg>
  );
}

// The mailbox, drawn like WOPR's: the box body is the light (red = no mail yet
// today, green = USPS says it's delivered), the flag stays yellow. Tap once
// you've brought the mail in. Data: WOPR's /api/usps (Informed Delivery).
type Usps = { delivered?: boolean; expected?: boolean; collected?: boolean; mailCount?: number | null; packageCount?: number | null };
export function Mailbox({ delivered, size = 96 }: { delivered: boolean; size?: number }) {
  const col = delivered ? 'var(--ok, #30a46c)' : 'var(--bad, #e5484d)';
  return (
    <svg viewBox="0 0 60 44" width={size} height={size * 0.73} aria-hidden="true" style="display:block">
      <path d="M46 14 V3" stroke="rgba(255,255,255,0.5)" stroke-width="1.6" stroke-linecap="round" />
      <path d="M46 2.5 L56 5.5 L46 8.5 Z" fill="var(--warn, #f5a524)" />
      {delivered && <path d="M22 12 H46 a12 12 0 0 1 12 12 V42 H22 Z" fill={col} opacity="0.12" />}
      <path d="M4 40 V24 a10 10 0 0 1 20 0 V40 Z" fill="none" stroke={col} stroke-width="1.5" stroke-linejoin="round" />
      <path d="M7.5 40 V24 a6.5 6.5 0 0 1 13 0 V40 Z" fill="rgba(0,0,0,0.55)" stroke={col} stroke-width="0.8" opacity="0.9" />
      <path d="M24 14 H46 a10 10 0 0 1 10 10 V40 H24" fill="none" stroke={col} stroke-width="1.5" stroke-linejoin="round" />
      <text x="40" y="33" text-anchor="middle" font-size="8" font-weight="700" letter-spacing="1.5" fill={col}>MAIL</text>
      <path d="M2 40 H58" stroke={col} stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function MailboxStatus() {
  const [d, setD] = useState<Usps | null>(null);
  const load = () => api<Usps>('/api/wopr/usps').then(setD, () => setD(null));
  useEffect(() => { void load(); const t = window.setInterval(load, 600_000); return () => clearInterval(t); }, []);
  if (!d) return null;   // WOPR not connected: no mailbox rather than a wrong one
  const has = d.delivered === true, coming = d.expected === true;
  const parts: string[] = [];
  if (d.mailCount != null) parts.push(`${d.mailCount} letter${d.mailCount === 1 ? '' : 's'}`);
  if (d.packageCount) parts.push(`${d.packageCount} package${d.packageCount === 1 ? '' : 's'}`);
  const label = has ? (parts.join(' · ') || 'Mail delivered') : coming ? `${parts.join(' · ') || 'Mail'} coming today` : d.collected ? 'Collected' : 'No mail yet';
  const collect = async () => {
    if (!has) return;
    setD({ ...d, delivered: false, collected: true });
    try { await api('/api/wopr/usps/collected', { method: 'POST', body: '{}' }); } catch { /* next poll re-syncs */ }
    void load();
  };
  return (
    <button type="button" class={`mailbox-btn ${has ? 'has' : ''}`} disabled={!has} onClick={() => void collect()} title={has ? 'Tap once you’ve brought the mail in' : label}>
      <Mailbox delivered={has} size={56} />
      <span class="mailbox-txt">
        <b class={has ? 'okc' : coming ? 'warnc' : ''}>{label}</b>
        {has && <span class="dimtxt">Tap once it’s brought in</span>}
      </span>
    </button>
  );
}

function usePanel(poll = 0): { v: PanelView | null; err: string | null; reload: () => void } {
  const [v, setV] = useState<PanelView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<PanelView>('/api/ha/panel').then((x) => { if (alive) { setV(x); setErr(null); } }, (e: Error) => { if (alive) setErr(e.message); });
    void load();
    const t = poll ? window.setInterval(load, poll) : undefined;
    return () => { alive = false; clearInterval(t); };
  }, [n, poll]);
  return { v, err, reload: () => setN((x) => x + 1) };
}

/** The garage widget. */
export function GarageW() {
  const { v, err, reload } = usePanel(4000);
  const [busy, setBusy] = useState(false);
  const door = v?.garage.door ?? null;
  const press = async (entity: string, action: string) => {
    setBusy(true);
    try { await act(entity, action); setTimeout(reload, 800); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  // Home Assistant not connected or not answering: one card across the whole
  // screen says so (the tiles panel steps aside, see .ha-off), not two red errors.
  if (err) {
    const setup = /settings page/i.test(err);
    return (
      <div class="card home-off">
        <div class="home-off-body">
          <GarageDoor state="closed" size={150} />
          <b>{setup ? 'Connect Home Assistant' : 'Home Assistant isn’t answering'}</b>
          <span class="dimtxt">{setup ? 'Add its address and a long-lived access token in Settings to see the garage door and your house here.' : err}</span>
          <div class="row wrap" style="justify-content:center">
            {setup ? <a class="btn big primary" href="/settings#ha">Open settings</a> : <button class="btn big" type="button" onClick={reload}>Try again</button>}
          </div>
        </div>
        <MailboxStatus />
      </div>
    );
  }
  if (!v) return <div class="card"><span class="lbl">Garage</span><div class="dimtxt">Asking Home Assistant…</div></div>;
  if (!door) {
    return (
      <div class="card garage-card">
        <span class="lbl">Garage</span>
        <div class="home-off-body">
          <span class="dimtxt">No garage door picked yet.</span>
          <a class="btn big" href="/settings#ha">Pick one in Settings</a>
        </div>
        <MailboxStatus />
      </div>
    );
  }
  const obstructed = v.garage.obstruction?.state === 'on';
  const isOpen = door.state === 'open' || door.state === 'opening';
  const moving = door.state === 'opening' || door.state === 'closing';
  return (
    <div class="card garage-card">
      <div class="row between"><span class="lbl">Garage</span><span class={`tag ${door.state === 'closed' ? 'dim' : 'warn'}`}>{door.state}</span></div>
      <button type="button" class="garage-btn" disabled={busy} onClick={() => void press(door.entity, isOpen ? 'close' : 'open')} aria-label={isOpen ? 'Close the garage' : 'Open the garage'}>
        <GarageDoor state={door.state} obstructed={obstructed} />
      </button>
      {obstructed && <div class="banner bad">Something is blocking the door sensor.</div>}
      <div class="garage-actions">
        <button class="btn big primary" type="button" disabled={busy} onClick={() => void press(door.entity, isOpen ? 'close' : 'open')}>{isOpen ? 'Close' : 'Open'}</button>
        {moving && <button class="btn big" type="button" onClick={() => void press(door.entity, 'stop')}>Stop</button>}
        {v.garage.light && <button class={`btn big ${v.garage.light.state === 'on' ? 'primary' : ''}`} type="button" aria-pressed={v.garage.light.state === 'on'} onClick={() => void press(v.garage.light!.entity, 'toggle')}>💡 Light</button>}
      </div>
      <MailboxStatus />
    </div>
  );
}

function TileBtn({ t, onDone, edit, onRemove }: { t: Tile; onDone: () => void; edit: boolean; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);
  const on = ['on', 'open', 'unlocked', 'playing', 'home'].includes(t.state);
  const main = t.actions[0];
  const tap = async () => {
    if (edit) return onRemove();
    if (!main) return;
    let action = main;
    if (t.domain === 'cover') action = t.state === 'open' || t.state === 'opening' ? 'close' : 'open';
    if (t.domain === 'lock') {
      action = t.state === 'locked' ? 'unlock' : 'lock';
      if (action === 'unlock' && !confirm(`Unlock ${t.name}?`)) return;
    }
    setBusy(true);
    try { await act(t.entity, action); setTimeout(onDone, 700); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const value = t.domain === 'sensor' ? `${t.state}${t.unit ? ` ${t.unit}` : ''}` : t.brightness !== null && on ? `${t.state} · ${t.brightness}%` : t.state;
  return (
    <button type="button" class={`ha-tile ${on ? 'on' : ''} ${main || edit ? '' : 'ro'} ${edit ? 'edit' : ''}`} disabled={busy} onClick={() => void tap()}>
      <span class="ha-ico" aria-hidden="true">{edit ? '✕' : ICON[t.domain] ?? '•'}</span>
      <b class="ha-name">{t.name}</b>
      <span class="dimtxt ellip num">{value}</span>
    </button>
  );
}
const ICON: Record<string, string> = { light: '💡', switch: '⏻', fan: '🌀', cover: '🚪', lock: '🔒', scene: '🎬', script: '▶', button: '◉', input_button: '◉', input_boolean: '⏻', sensor: '🌡', binary_sensor: '◐', media_player: '♪', climate: '❄' };

/** Home Assistant tiles, a tab per page. */
export function HaPanelW() {
  const { v, err, reload } = usePanel(8000);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Tile[] | null>(null);
  const [dash, setDash] = useState('room-garage');
  const save = async (c: PanelConfig) => { try { await api('/api/ha/panel', { method: 'PUT', body: JSON.stringify(c) }); reload(); } catch (e) { toast((e as Error).message); } };
  if (err) return <div class="ha-off" />;   // the garage card shows the one message, across the screen
  if (!v) return <div class="card" />;
  const c = v.config;
  const cur = v.pages[Math.min(page, v.pages.length - 1)];
  const importDash = async () => {
    try {
      const r = await api<{ entities: string[] }>(`/api/ha/dashboard?dashboard=${encodeURIComponent(dash.trim())}`);
      if (!r.entities.length) return toast('That dashboard has no entities');
      const title = dash.replace(/^room-/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      await save({ ...c, pages: [...c.pages.filter((p) => p.dashboard !== dash.trim()), { title, dashboard: dash.trim(), entities: r.entities.slice(0, 48) }] });
      setPage(c.pages.length);
      toast(`Added ${title}: ${Math.min(48, r.entities.length)} tiles`);
    } catch (e) { toast((e as Error).message); }
  };
  const search = async () => { try { setHits(await api<Tile[]>(`/api/ha/entities?q=${encodeURIComponent(q.trim())}`)); } catch (e) { toast((e as Error).message); } };
  const pageIdx = Math.min(page, c.pages.length - 1);
  return (
    <div class="card ha-panel">
      <div class="ha-head">
        {v.pages.length > 1
          ? <div class="mtabs" role="tablist">{v.pages.map((p, i) => <button type="button" role="tab" aria-selected={i === pageIdx} onClick={() => setPage(i)}>{p.title}</button>)}</div>
          : <span class="lbl">{cur?.title ?? 'Home Assistant'}</span>}
        {(v.pages.length > 0 || edit) && <button class={`btn ha-editbtn ${edit ? 'primary' : ''}`} type="button" onClick={() => { setEdit(!edit); setHits(null); }}>{edit ? 'Done' : 'Edit'}</button>}
      </div>
      {!v.pages.length && !edit && (
        <div class="home-off-body">
          <b>No tiles yet</b>
          <span class="dimtxt">Copy one of your Home Assistant dashboards (like the garage one), or pick devices one by one.</span>
          <button class="btn big primary" type="button" onClick={() => setEdit(true)}>Set up tiles</button>
        </div>
      )}
      {cur && !cur.tiles.length && !edit && <div class="dimtxt">This page is empty. Tap Edit to add devices.</div>}
      {cur && (
        <div class="ha-grid">
          {cur.tiles.map((t) => <TileBtn t={t} onDone={reload} edit={edit} onRemove={() => void save({ ...c, pages: c.pages.map((p, i) => (i === pageIdx ? { ...p, entities: p.entities.filter((e) => e !== t.entity) } : p)) })} />)}
        </div>
      )}
      {edit && (
        <div class="ha-edit">
          {cur && <span class="dimtxt">Tap a tile to take it off {cur.title}.</span>}
          {cur && (
            <form class="ha-edit-row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void search(); }}>
              <span class="lbl">Add to {cur.title}</span>
              <input class="minput" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="Search devices, e.g. porch" />
              <button class="btn" type="submit">Search</button>
            </form>
          )}
          {hits && <div class="row wrap">{hits.length ? hits.map((t) => <button type="button" class="btn" onClick={() => void save({ ...c, pages: c.pages.map((p, i) => (i === pageIdx ? { ...p, entities: [...new Set([...p.entities, t.entity])] } : p)) })}>+ {t.name}</button>) : <span class="dimtxt">Nothing matches “{q.trim()}”.</span>}</div>}
          <form class="ha-edit-row" onSubmit={(e) => { e.preventDefault(); void importDash(); }}>
            <span class="lbl">New page from an HA dashboard</span>
            <input class="minput" value={dash} onInput={(e) => setDash((e.target as HTMLInputElement).value)} placeholder="room-garage" />
            <button class="btn" type="submit">Copy</button>
          </form>
          <div class="ha-edit-row">
            <span class="lbl">Garage prompt</span>
            <label class="check"><input type="checkbox" checked={c.garage.ask} onChange={(e) => void save({ ...c, garage: { ...c.garage, ask: (e.target as HTMLInputElement).checked } })} /> Offer Open when arriving, Close when leaving it open</label>
          </div>
          <div class="row wrap" style="justify-content:flex-end">
            {!cur && <button class="btn" type="button" onClick={() => void save({ ...c, pages: [...c.pages, { title: 'Home', dashboard: null, entities: [] }] })}>+ Empty page</button>}
            {cur && <button class="btn danger" type="button" onClick={() => { if (!confirm(`Remove the ${cur.title} page?`)) return; void save({ ...c, pages: c.pages.filter((_, i) => i !== pageIdx) }); setPage(0); }}>Remove {cur.title} page</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
};

/**
 * Over every view: on the way home (crossing inside nearM of HA's zone.home,
 * while driving) with the door closed, a big "Open the garage" card; driving
 * away (past nearM) with it open, "Close the garage". One tap, auto-hides.
 */
export function GaragePrompt() {
  const s = useStore(stateStore);
  const [cfg, setCfg] = useState<{ home: PanelView['home']; garage: GarageConfig } | null>(null);
  const [door, setDoor] = useState<string | null>(null);
  const [ask, setAsk] = useState<'open' | 'close' | null>(null);
  const last = useRef<number | null>(null);
  useEffect(() => { api<PanelView>('/api/ha/panel').then((v) => setCfg({ home: v.home, garage: v.config.garage }), () => {}); }, []);
  const pos = s?.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null;
  const d = cfg?.home && pos ? distM(pos, cfg.home) : null;
  const near = d !== null && cfg ? d < cfg.garage.nearM * 4 : false;
  useEffect(() => {   // watch the door only while near home
    if (!near || !cfg?.garage.cover) return;
    const load = () => api<{ door: Tile } | null>('/api/ha/garage').then((g) => setDoor(g?.door.state ?? null), () => {});
    void load();
    const t = window.setInterval(load, 5000);
    return () => clearInterval(t);
  }, [near, cfg?.garage.cover]);
  useEffect(() => {
    if (d === null || !cfg?.garage.ask || !cfg.garage.cover) return;
    const prev = last.current;
    last.current = d;
    if (prev === null) return;
    const R = cfg.garage.nearM;
    const moving = (s?.speedMph ?? 0) > 3;
    if (prev >= R && d < R && moving && door === 'closed') setAsk('open');
    if (prev <= R && d > R && door === 'open') setAsk('close');
  }, [d, door]);
  useEffect(() => { if (!ask) return; const t = window.setTimeout(() => setAsk(null), 60_000); return () => clearTimeout(t); }, [ask]);
  useEffect(() => { if (ask === 'open' && (door === 'open' || door === 'opening')) setAsk(null); if (ask === 'close' && (door === 'closed' || door === 'closing')) setAsk(null); }, [door]);
  if (!ask || !cfg?.garage.cover) return null;
  const go = async () => { try { await act(cfg.garage.cover!, ask); } catch (e) { toast((e as Error).message); } };
  return (
    <div class="card garage-prompt" role="dialog" aria-label={ask === 'open' ? 'Open the garage?' : 'Close the garage?'}>
      <GarageDoor state={door ?? 'closed'} size={150} />
      <div class="grow">
        <b style="font-size:24px">{ask === 'open' ? 'Almost home' : 'The garage is still open'}</b>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn big primary" type="button" onClick={() => void go()}>{ask === 'open' ? 'Open the garage' : 'Close the garage'}</button>
          <button class="btn big" type="button" onClick={() => setAsk(null)}>Not now</button>
        </div>
      </div>
    </div>
  );
}

export const HOME_WIDGETS: Record<string, (p: WP) => preact.JSX.Element | null> = { garage: GarageW, haPanel: HaPanelW };
