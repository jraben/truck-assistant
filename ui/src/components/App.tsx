import { useTabletGps } from '../lib/tabletGps.ts';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_LAYOUT } from '../../../brain/src/layout.ts';
import { activeDriver, linkStore, loadSettings, putDriver, settingsStore, stateStore, toast, toastStore, useStore, type Driver, type Layout, type State } from '../lib/brain.ts';
import { allThemes, isLight, paintTheme, pickTheme, type Theme } from '../lib/theme.ts';
import { carplay } from '../carplay/controller.ts';
import { V } from './common.tsx';
import { ChargePrompt } from './costs.tsx';
import { widgetFor } from './widgets.tsx';
import { DriverBadge, DriverPanel, DriverPrompt } from './drivers.tsx';
import { NetPanel } from './network.tsx';
import { HealthButton, HealthPanel } from './health.tsx';
import { WeatherOverlay, WeatherStrip } from '../drive/WeatherStrip.tsx';
import { MEDIA_ICON, TrackBOverlays, withMediaView } from '../media/trackb.tsx';
import { GaragePrompt, HOME_ICON, withHomeView } from '../home/Home.tsx';
import { ModeOverlays, PARKED_ICON, TabletHello, withParkedView } from '../parked/Parked.tsx';
import { MAP_ICON, withMapView } from '../map/MapView.tsx';
import { WoprButton } from '../wopr/WoprUi.tsx';
import { PROJECT } from '../../../brain/src/project.ts';
import { LogsPanel } from '../ops/OpsSettings.tsx';
import { DueCard } from '../ops/Maintenance.tsx';
import { SetupOverlay } from '../ops/Wizard.tsx';
import { TestPanel, useSimAvailable } from '../sim/TestPanel.tsx';
import { Rail, type RailEntry } from './Rail.tsx';
import { useStripFit } from '../lib/stripFit.ts';
import { RelayDots } from './RelayDots.tsx';
import { loadCache, mergeOrder, pickOrder, saveCache, type CachedOrder } from '../lib/railOrder.ts';

const ICONS: Record<string, string> = {
  drive: 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
  carplay: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 12h8M12 8v8',
  control: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8',
  charge: 'M13 2 4 14h7l-1 8 9-12h-7z',
  roadtrip: 'M4 20l4-16M20 20l-4-16M12 6v2M12 11v2M12 16v2',
  traffic: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 7a1.5 1.5 0 1 0 0 .01M12 12a1.5 1.5 0 1 0 0 .01M12 17a1.5 1.5 0 1 0 0 .01',
  trips: 'M5 19a2 2 0 1 0 0-.01M19 5a2 2 0 1 0 0-.01M7 19h7a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h7',
  cams: 'M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 11l5-3v8l-5-3',
  media: MEDIA_ICON,
  home: HOME_ICON,
  parked: PARKED_ICON,
  map: MAP_ICON,
};
const GEAR = 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';
const PALETTE = 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 12a1 1 0 1 0 0-.01M10 8a1 1 0 1 0 0-.01M14 8a1 1 0 1 0 0-.01';
const MIC = 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
const SIM_ICON = 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10';
const LOGS ='M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7';
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** Back from cams this long after reverse ends (the plan's 3 s). */
const REVERSE_RETURN_MS = 3000;

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return t;
}

function storage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

function viewFromHash(layout: Layout) {
  const h = location.hash.slice(1);
  return layout.views.some((v) => v.id === h) ? h : layout.views[0]?.id ?? 'drive';
}

export function App() {
  const s = useStore(stateStore);
  const link = useStore(linkStore);
  const settings = useStore(settingsStore);
  const toastMsg = useStore(toastStore);
  const driver = activeDriver(settings, s);
  useTabletGps(); // the dash tablet's own GPS, when there's no puck (lib/tabletGps.ts)
  const base = driver?.layout?.views?.length ? driver.layout : DEFAULT_LAYOUT;
  const layout = useMemo(() => withMapView(withParkedView(withHomeView(withMediaView(base)))), [base]);
  const [view, setView] = useState(() => viewFromHash(layout));
  const [picker, setPicker] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [logs, setLogs] = useState<null | 'mileage' | 'maintenance'>(null);
  const [editing, setEditing] = useState(false);
  const stripRef = useRef<HTMLElement>(null);
  useStripFit(stripRef);
  // Rail order: the active driver's (on the brain); a local draft while a save is in flight.
  const [cache] = useState(() => loadCache(storage()));
  const [draft, setDraft] = useState<CachedOrder | null>(null);
  const pending = useRef<{ t: number; d: CachedOrder } | null>(null);
  const simAvailable = useSimAvailable();
  const [simOpen, setSimOpenRaw] = useState(() => { try { return localStorage.getItem('slate.simPanel') === '1'; } catch { return false; } });
  const setSimOpen = (on: boolean) => { setSimOpenRaw(on); try { if (on) localStorage.setItem('slate.simPanel', '1'); else localStorage.removeItem('slate.simPanel'); } catch { /* private window */ } };
  const now = useClock();

  const go = (id: string) => { setView(id); history.replaceState(null, '', `#${id}`); };
  useEffect(() => { const f = () => setView(viewFromHash(layout)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, [layout]);

  // Reverse: jump to Cams, return to where we were a moment after it ends.
  const before = useRef<string | null>(null);
  const backTimer = useRef<number | undefined>(undefined);
  const reverse = s?.reverse === true;
  useEffect(() => {
    const hasCams = layout.views.some((v) => v.id === 'cams');
    if (!hasCams) return;
    if (reverse) {
      clearTimeout(backTimer.current);
      if (before.current === null) before.current = view === 'cams' ? null : view;
      if (view !== 'cams') setView('cams');
    } else if (before.current !== null) {
      const back = before.current;
      backTimer.current = window.setTimeout(() => { before.current = null; go(back); }, REVERSE_RETURN_MS);
    }
  }, [reverse]);

  // Theme: auto or chosen; frozen while reversing so the camera view never flips mid-manoeuvre.
  const gpsPos = s?.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null;
  const shown = useRef<Theme | null>(null);
  const want = pickTheme(driver?.theme, gpsPos, now);
  if (!reverse || !shown.current) shown.current = want;
  useEffect(() => { paintTheme(shown.current!); carplay.setNight(!isLight(shown.current!.colors.bg)); }, [shown.current]);

  const cur = layout.views.find((v) => v.id === view) ?? layout.views[0];

  // Every screen and tool has an icon on the rail; there is no "More".
  const closePanels = () => { setDriverOpen(false); setPicker(false); };
  const entries: RailEntry[] = [
    ...layout.views.map((v): RailEntry => ({ id: v.id, label: v.label, icon: v.id === 'control' ? <RelayDots relays={s?.relays} online={!!s?.truckbox} /> : <Ico d={ICONS[v.id] ?? ICONS.drive} />, href: `#${v.id}`, current: v.id === cur.id, onTap: () => go(v.id) })),
    { id: '@wopr', label: 'WOPR voice', short: 'WOPR', icon: <Ico d={MIC} />, cls: 'voice', live: <WoprButton />, holdToEdit: false },
    { id: '@driver', label: s?.driver ? `Driver: ${s.driver.name}` : 'Pick the driver', short: s?.driver?.name ?? 'Driver', icon: <DriverBadge d={s?.driver ?? null} size={30} />, pressed: driverOpen, current: driverOpen, onTap: () => { setDriverOpen(!driverOpen); setPicker(false); } },
    { id: '@theme', parkOnly: true, label: 'Theme', icon: <Ico d={PALETTE} />, pressed: picker, current: picker, onTap: () => { setPicker(!picker); setDriverOpen(false); } },
    { id: '@logs', parkOnly: true, label: 'Mileage & maintenance', short: 'Logs', icon: <Ico d={LOGS} />, pressed: !!logs, current: !!logs, onTap: () => { closePanels(); setLogs(logs ? null : 'mileage'); } },
    ...(simAvailable ? [{ id: '@sim', parkOnly: true, label: 'Test panel (SIM)', short: 'Test', icon: <Ico d={SIM_ICON} />, pressed: simOpen, current: simOpen, onTap: () => { closePanels(); setSimOpen(!simOpen); } }] : []),
    { id: '@settings', parkOnly: true, label: 'Settings', icon: <Ico d={GEAR} />, href: '/settings' },
  ];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const order = mergeOrder(pickOrder({ driver: driver?.id ?? null, driverOrder: driver?.railOrder ?? null, draft, cache }), entries.map((e) => e.id));
  const persist = (d: CachedOrder) => {
    saveCache(storage(), d);
    const send = (x: CachedOrder) => {
      putDriver(x.driver, { railOrder: x.order })
        .then(() => setDraft((cur) => (cur === x ? null : cur)))
        .catch((e: Error) => { toast(`Icon order not saved: ${e.message}`); setDraft((cur) => (cur === x ? null : cur)); });
    };
    // Dragging reorders on every slot crossed: save once it settles. Another driver's pending save goes now.
    const p = pending.current;
    if (p) { clearTimeout(p.t); if (p.d.driver !== d.driver) send(p.d); }
    pending.current = { d, t: window.setTimeout(() => { pending.current = null; send(d); }, 700) };
  };
  const reorder = (next: string[]) => { if (!driver) return; const d = { driver: driver.id, order: next }; setDraft(d); persist(d); };
  const resetOrder = () => { if (!driver) return; const d = { driver: driver.id, order: null }; setDraft(d); persist(d); };
  // A driver change: their own order, and out of edit mode.
  useEffect(() => {
    setEditing(false);
    if (driver) saveCache(storage(), { driver: driver.id, order: driver.railOrder ?? null });
  }, [driver?.id]);
  useEffect(() => { if (driver && !draft) saveCache(storage(), { driver: driver.id, order: driver.railOrder ?? null }); }, [driver?.railOrder]);
  const cols = Math.max(1, ...cur.widgets.map((w) => w.col + w.w - 1));
  const rows = Math.max(1, ...cur.widgets.map((w) => w.row + w.h - 1));

  return (
    <div class={`app ${s?.drive?.lockout.bigTargets ? 'at-speed' : ''} ${s?.drive && s.drive.heat.level !== 'ok' ? 'calm' : ''}`}>
      <header class="strip" ref={stripRef}>
        <span class="brand"><img class="brand-mark" src="/icon.svg" alt="" /><span class="brand-name">{PROJECT.shortName}</span></span>
        {editing
          ? <span class="rail-edit"><b>Arrange icons</b><button type="button" class="btn sm" onClick={resetOrder}>Reset</button><button type="button" class="btn sm primary" onClick={() => setEditing(false)}>Done</button></span>
          : <h1 class="screen-title">{cur.label}</h1>}
        <HealthButton s={s} connected={link.connected} open={healthOpen} onClick={() => { setHealthOpen(!healthOpen); setNetOpen(false); }} />
        {s?.place && <span class="pill place hide-sm" title={`Stopped since ${new Date(s.place.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}>{s.place.name ?? s.area ?? 'Unnamed stop'}</span>}
        {!s?.place && s?.area && <span class="pill place hide-sm">{s.area}</span>}
        <span class="sp" />
        <WeatherStrip s={s} />
        <span class="clock num">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </header>

      <Rail entries={order.map((id) => byId.get(id)!)} editing={editing} onEdit={setEditing} onReorder={reorder} locked={!!s?.drive?.lockout.bigTargets} />

      <main class="stage">
        <div class="grid" style={{ '--cols': cols, '--rows': rows } as Record<string, number>}>
          {cur.widgets.map((w) => {
            const W = widgetFor(w.type);
            return (
              <div class="cell" style={{ gridColumn: `${w.col} / span ${w.w}`, gridRow: `${w.row} / span ${w.h}` }}>
                <W s={s} props={{ type: w.type, ...(w.props ?? {}) }} go={go} />
              </div>
            );
          })}
        </div>
      </main>

      {cur.id === 'drive' && <DriverPrompt />}
      <GaragePrompt />
      <ModeOverlays />
      <TabletHello />
      {driverOpen && <DriverPanel onClose={() => setDriverOpen(false)} />}
      {healthOpen && <HealthPanel s={s} connected={link.connected} onClose={() => setHealthOpen(false)} onNetwork={() => { setHealthOpen(false); setNetOpen(true); }} />}
      {netOpen && <NetPanel s={s} onClose={() => setNetOpen(false)} />}
      {picker && driver && <ThemePicker driver={driver} shown={shown.current!} onClose={() => setPicker(false)} />}
      <div class="banners">
        {/* Most urgent first: only the first is shown in full, the rest as one line each (styles.css .banners). */}
        <TireBanner s={s} go={go} />
        <TrafficBanner s={s} go={go} />
        <TripBanner s={s} go={go} />
        <PeakBanner s={s} />
        <PickupBanner s={s} go={go} />
      </div>
      <ChargePrompt />
      <WeatherOverlay s={s} />
      <TrackBOverlays />
      {cur.id === 'drive' && !logs && <DueCard onOpen={() => setLogs('maintenance')} />}
      {logs && <LogsPanel initial={logs} onClose={() => setLogs(null)} />}
      <SetupOverlay />
      {simAvailable && <TestPanel open={simOpen} onClose={() => setSimOpen(false)} go={go} />}
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function Swatch({ t }: { t: Theme }) {
  return <span class="swatch" aria-hidden="true">{[t.colors.bg, t.colors.panel, t.colors.accent, t.colors.ok].map((c) => <i style={{ background: c }} />)}</span>;
}

/** Quick theme switch from the cockpit. Picking one turns auto off; "Auto" turns it back on. */
function ThemePicker({ driver, shown, onClose }: { driver: Driver; shown: Theme; onClose: () => void }) {
  const ts = driver.theme;
  const save = async (patch: Partial<Driver['theme']>) => {
    try { await putDriver(driver.id, { theme: patch }); }
    catch (e) { toast(`Theme not saved: ${(e as Error).message}`); void loadSettings(); }
  };
  return (
    <div class="card picker" role="dialog" aria-label="Theme">
      <div class="row between"><span class="lbl">Theme · {driver.name}</span><button class="btn sm" type="button" onClick={onClose}>Close</button></div>
      <button type="button" class={`item ${ts.auto.enabled ? 'sel' : ''}`} onClick={() => void save({ auto: { ...ts.auto, enabled: true } })}>
        <Swatch t={shown} /><span><b>Auto</b> <span class="dimtxt" style="font-size:var(--fs-caption)">sunrise/sunset · {allThemes(ts).find((x) => x.id === ts.auto.day)?.name} / {allThemes(ts).find((x) => x.id === ts.auto.night)?.name}</span></span>
      </button>
      <div class="list">
        {allThemes(ts).map((t) => (
          <button type="button" class={`item ${!ts.auto.enabled && ts.active === t.id ? 'sel' : ''}`} onClick={() => void save({ active: t.id, auto: { ...ts.auto, enabled: false } })}>
            <Swatch t={t} /><b>{t.name}</b>
          </button>
        ))}
      </div>
      <a class="btn" href="/settings#themes">Edit themes…</a>
    </div>
  );
}

export type { State };

/** Airport pickup: shown the whole time one is on (it used to appear only at "leave now",
 *  taxiing or at the gate, so a pickup set mid-drive showed nothing until then). */
function PickupBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const p = s?.pickup;
  if (!p) return null;
  const urgent = p.leaveNow || p.phase === 'taxiing' || p.phase === 'at-gate';
  return <button type="button" class={`banner ${p.leaveNow ? '' : urgent ? 'ok' : 'calm'} peakbanner tripbanner`} role="status" onClick={() => go('roadtrip')}><b>{p.leaveNow ? 'Leave now' : 'Pickup'}</b><span>{p.line}</span></button>;
}

/** Below this a tire is low: the phone alert's default (alertMeta.tirePressure). */
const LOW_TIRE_PSI = 30;
/** A low tire on the dash itself, not only on the phone and the tire widget. */
function TireBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const low = s?.tpms ? (Object.entries(s.tpms) as [string, { psi: number | null }][]).filter(([, t]) => t.psi !== null && t.psi < LOW_TIRE_PSI) : [];
  if (!low.length) return null;
  return <button type="button" class="banner bad peakbanner tripbanner" role="status" onClick={() => go('control')}><b>Tire low</b><span>{low.map(([w, t]) => `${w.toUpperCase()} ${Math.round(t.psi!)} psi`).join(', ')}</span></button>;
}

/** A crash or closure close ahead, or an enforcement camera coming up. */
function TrafficBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const t = s?.traffic ?? (s?.hazard ? { kind: 'hazard' as const, text: s.hazard.text } : null);
  if (!t || s?.roadTrip?.alert || (s?.roadTrip?.coach && (s.roadTrip.coach.state === 'go' || s.roadTrip.coach.state === 'slow'))) return null;
  return <button type="button" class={`banner ${t.kind === 'camera' ? '' : 'bad'} peakbanner tripbanner`} role="status" onClick={() => go('traffic')}><b>{t.kind === 'camera' ? 'Camera' : t.kind === 'hazard' ? 'Ahead' : 'Traffic'}</b><span>{t.text}</span></button>;
}

/**
 * Road trip: a stop that was full and switched, a replan, or the coach saying
 * GO / slow stall, on every view for a while (the Road trip screen has the rest).
 */
function TripBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const rt = s?.roadTrip;
  if (!rt) return null;
  const c = rt.coach;
  if (c && (c.state === 'go' || c.state === 'slow')) {
    return <button type="button" class={`banner ${c.state === 'slow' ? 'bad' : 'ok'} peakbanner tripbanner`} role="status" onClick={() => go('roadtrip')}><b>{c.state === 'go' ? 'GO' : 'Slow stall'}</b><span>{c.message.replace(/^GO:\s*/, '')}</span></button>;
  }
  if (rt.alert) return <button type="button" class={`banner ${rt.alert.kind === 'full' ? 'bad' : ''} peakbanner tripbanner`} role="status" onClick={() => go('roadtrip')}><b>Road trip</b><span>{rt.alert.message}</span></button>;
  return null;
}

/** Charging at home during on-peak (red), or plugged in just before it (amber). Every view. */
function PeakBanner({ s }: { s: State | null }) {
  const cp = s?.chargePeak;
  if (cp?.onPeak) return <div class="banner bad peakbanner" role="alert"><b>{cp.title}</b><span>{cp.message}</span></div>;
  if (cp?.headsUp) return <div class="banner peakbanner" role="status"><b>{cp.headsUpTitle}</b><span>{cp.headsUp}</span></div>;
  return null;
}
