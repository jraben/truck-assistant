import { useTabletGps } from '../lib/tabletGps.ts';
import type { ComponentChildren } from 'preact';
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
import { foldTrafficIntoMap, MAP_ICON, withMapView } from '../map/MapView.tsx';
import { GAUGES_ICON, withGaugesView } from '../gauges/logic.ts';
import { logsStore, mapTabStore } from '../lib/panels.ts';
import { WoprButton } from '../wopr/WoprUi.tsx';
import { PROJECT } from '../../../brain/src/project.ts';
import { LogsPanel } from '../ops/OpsSettings.tsx';
import { DueCard } from '../ops/Maintenance.tsx';
import { SetupOverlay } from '../ops/Wizard.tsx';
import { TestPanel, useSimAvailable } from '../sim/TestPanel.tsx';
import { Rail, type RailEntry } from './Rail.tsx';
import { VersionBar } from './VersionBar.tsx';
import { AskHost } from './Ask.tsx';
import { AlertBanner } from './AlertBanner.tsx';
import { StartupAssembly } from '../drive/StartupAssembly.tsx';
import { SideCam } from './SideCam.tsx';
import { camStatusStore, nextTrail, trailShowingStore, trailStore } from '../lib/cams.ts';
import { lowTires } from '../../../brain/src/vehicle.ts';
import { PickupBanner, PickupPill } from './PickupBanner.tsx';
import { askPassengerThen, PassengerAsk, PassengerPill } from '../drive/Passenger.tsx';
import { useStripFit } from '../lib/stripFit.ts';
import { RelayDots } from './RelayDots.tsx';
import { loadCache, mergeOrder, pickOrder, pinLast, saveCache, type CachedOrder } from '../lib/railOrder.ts';

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
  gauges: GAUGES_ICON,
};
const GEAR = 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';
const MIC = 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
const TRUCK_ICON = 'M2 16V9h10v7M12 11h5l3 3v2H12M6.5 16a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M16.5 16a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3';
const SIM_ICON = 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10';
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

/** Traffic lives in the Map screen's Traffic tab now (unless a layout kept its own Traffic view). */
function resolveView(layout: Layout, id: string): string {
  if (id === 'traffic' && !layout.views.some((v) => v.id === 'traffic') && layout.views.some((v) => v.id === 'map')) { mapTabStore.set('traffic'); return 'map'; }
  return id;
}

function viewFromHash(layout: Layout) {
  const h = resolveView(layout, location.hash.slice(1));
  return layout.views.some((v) => v.id === h) ? h : layout.views[0]?.id ?? 'drive';
}

/**
 * Another page (Settings, Truck) shown inside the cockpit: same top bar, rail,
 * theme, banners and version line; only the stage holds the page. Rail screens
 * then link back to the cockpit (/#map).
 */
export type AppPage = { id: '@settings' | '@truck'; label: string; node: ComponentChildren };

export function App({ page }: { page?: AppPage } = {}) {
  const s = useStore(stateStore);
  const link = useStore(linkStore);
  const settings = useStore(settingsStore);
  const toastMsg = useStore(toastStore);
  const driver = activeDriver(settings, s);
  useTabletGps(!page); // the dash tablet's own GPS, when there's no puck (lib/tabletGps.ts); never from another page
  const base = driver?.layout?.views?.length ? driver.layout : DEFAULT_LAYOUT;
  const layout = useMemo(() => foldTrafficIntoMap(withGaugesView(withMapView(withParkedView(withHomeView(withMediaView(base)))))), [base]);
  const [view, setView] = useState(() => viewFromHash(layout));
  const [picker, setPicker] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const logs = useStore(logsStore);
  const setLogs = (v: null | 'mileage' | 'maintenance') => logsStore.set(v);
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

  const go = (raw: string) => { if (page) { location.href = `/#${raw}`; return; } const id = resolveView(layout, raw); if (id === 'map' && raw === 'map') mapTabStore.set('map'); setView(id); history.replaceState(null, '', `#${id}`); };
  useEffect(() => { const f = () => setView(viewFromHash(layout)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, [layout]);

  // Reverse: jump to Cams, return to where we were a moment after it ends.
  const before = useRef<string | null>(null);
  const backTimer = useRef<number | undefined>(undefined);
  const reverse = s?.reverse === true;
  useEffect(() => {
    const hasCams = layout.views.some((v) => v.id === 'cams');
    if (!hasCams || page) return;
    if (reverse) {
      clearTimeout(backTimer.current);
      if (before.current === null) before.current = view === 'cams' ? null : view;
      if (view !== 'cams') setView('cams');
    } else if (before.current !== null) {
      const back = before.current;
      backTimer.current = window.setTimeout(() => { before.current = null; go(back); }, REVERSE_RETURN_MS);
    }
  }, [reverse]);

  // Trail view (Cams › Trail view on): the front camera takes the screen at low speed, then
  // back to where we were, like reverse. Speed limit from Settings › Cameras (default 10 mph).
  const trailOn = useStore(trailStore);
  const trailMph = useStore(camStatusStore)?.trailMph ?? 10;
  const trailShowing = useStore(trailShowingStore);
  const beforeTrail = useRef<string | null>(null);
  useEffect(() => {
    const next = nextTrail(trailShowing, trailOn, s, trailMph);
    if (next !== trailShowing) trailShowingStore.set(next);
  }, [trailOn, s?.speedMph, s?.ignition, s?.reverse, trailMph]);
  useEffect(() => {
    if (page || !layout.views.some((v) => v.id === 'cams')) return;
    if (trailShowing) { if (beforeTrail.current === null) beforeTrail.current = view === 'cams' ? null : view; if (view !== 'cams') setView('cams'); }
    else if (beforeTrail.current !== null && !reverse) { const back = beforeTrail.current; beforeTrail.current = null; go(back); }
  }, [trailShowing]);

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
    ...layout.views.map((v): RailEntry => ({ id: v.id, label: v.label, icon: v.id === 'control' ? <RelayDots relays={s?.relays} online={!!s?.truckbox} /> : <Ico d={ICONS[v.id] ?? ICONS.drive} />,
      ...(page ? { href: `/#${v.id}` } : { href: `#${v.id}`, current: v.id === cur.id, onTap: () => go(v.id) }) })),
    { id: '@wopr', label: 'WOPR voice', short: 'WOPR', icon: <Ico d={MIC} />, cls: 'voice', live: <WoprButton />, holdToEdit: false },
    { id: '@driver', label: s?.driver ? `Driver: ${s.driver.name}` : 'Pick the driver', short: s?.driver?.name ?? 'Driver', icon: <DriverBadge d={s?.driver ?? null} size={30} />, pressed: driverOpen, current: driverOpen, onTap: () => { setDriverOpen(!driverOpen); setPicker(false); } },
    // Theme is in the driver's panel (themes are per driver); the logs are on the Trips screen.
    ...(simAvailable ? [{ id: '@sim', parkOnly: false /* only exists in SIM, where nobody is really driving: it must stay reachable at speed to stop the truck */, label: 'Test panel (SIM)', short: 'Test', icon: <Ico d={SIM_ICON} />, pressed: simOpen, current: simOpen, onTap: () => { closePanels(); setSimOpen(!simOpen); } }] : []),
    { id: '@settings', parkOnly: true, label: 'Settings', icon: <Ico d={GEAR} />, href: '/settings', current: page?.id === '@settings' },
    // The Truck page (/truck) is for phones; it gets a rail spot only while it is the page showing.
    ...(page?.id === '@truck' ? [{ id: '@truck', label: 'Truck', icon: <Ico d={TRUCK_ICON} />, href: '/truck', current: true }] : []),
  ];
  const byId = new Map(entries.map((e) => [e.id, e]));
  // The driver's profile always sits last on the rail, whatever order the rest are dragged into.
  const order = pinLast(mergeOrder(pickOrder({ driver: driver?.id ?? null, driverOrder: driver?.railOrder ?? null, draft, cache }), entries.map((e) => e.id)), '@driver');
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

  // Glass themes use the GlassDash frame: no top bar or left rail, one dock along the bottom
  // (the car for Drive, the weather, the screens as app tiles, then status and the clock).
  const docked = !!shown.current?.glass;
  const clock = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const railEl = (
    <Rail entries={order.filter((id) => !(docked && id === 'drive')).map((id) => byId.get(id)!)} editing={editing} onEdit={setEditing} onReorder={(next) => reorder(docked && order.includes('drive') ? ['drive', ...next] : next)}
      locked={!!s?.drive?.lockout.bigTargets} horizontal={docked} maxTiles={8}
      parkLocked={!!s?.drive?.lockout.locked && !s.drive.lockout.passenger} onParkLocked={askPassengerThen} />
  );

  return (
    <div class={`app ${docked ? 'docked' : ''} ${docked && cur.id === 'drive' && !page ? 'on-drive' : ''} ${s?.drive?.lockout.bigTargets ? 'at-speed' : ''} ${s?.drive?.lockout.passenger ? 'passenger' : ''} ${s?.drive?.lockout.locked ? 'moving' : ''} ${s?.drive && s.drive.heat.level !== 'ok' ? 'calm' : ''}`}>
      {!docked && <header class="strip" ref={stripRef}>
        <span class="brand"><img class="brand-mark" src="/icon.svg" alt="" /><span class="brand-name">{PROJECT.shortName}</span></span>
        {editing
          ? <span class="rail-edit"><b>Arrange icons</b><button type="button" class="btn sm" onClick={resetOrder}>Reset</button><button type="button" class="btn sm primary" onClick={() => setEditing(false)}>Done</button></span>
          : <h1 class="screen-title">{page ? page.label : cur.label}</h1>}
        <HealthButton s={s} connected={link.connected} open={healthOpen} onClick={() => { setHealthOpen(!healthOpen); setNetOpen(false); }} />
        {s?.place && <span class="pill place hide-sm" title={`Stopped since ${new Date(s.place.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}>{s.place.name ?? s.area ?? 'Unnamed stop'}</span>}
        {!s?.place && s?.area && <span class="pill place hide-sm">{s.area}</span>}
        {/* Moving: a way in for the passenger (Settings steps aside at speed); on: the way out. */}
        {s?.drive?.lockout.passenger ? <PassengerPill /> : s?.drive?.lockout.locked ? <PassengerAsk /> : null}
        <PickupPill s={s} />
        <span class="sp" />
        <WeatherStrip s={s} />
        <span class="clock num">{clock}</span>
      </header>}

      {docked ? (
        <footer class="dock">
          <div class="dock-l">
            <a class={`dock-car ${cur.id === 'drive' && !page ? 'on' : ''}`} href={page ? '/#drive' : '#drive'} aria-label="Drive"
              aria-current={cur.id === 'drive' && !page ? 'page' : undefined}
              onClick={(e) => { if (!page) { e.preventDefault(); go('drive'); } }}>
              <svg viewBox="0 0 48 24" aria-hidden="true"><path d="M4 17c0-3 1-5 4-6l6-5c2-1.5 4-2 7-2h6c3 0 5 1 7 3l4 4c4 .5 6 2.5 6 6v1H4z" /><circle cx="13" cy="18" r="3.5" /><circle cx="36" cy="18" r="3.5" /></svg>
            </a>
            <WeatherStrip s={s} />
          </div>
          {railEl}
          <div class="dock-r">
            {editing
              ? <span class="rail-edit"><button type="button" class="btn sm" onClick={resetOrder}>Reset</button><button type="button" class="btn sm primary" onClick={() => setEditing(false)}>Done</button></span>
              : <>
                {s?.drive?.lockout.passenger ? <PassengerPill /> : s?.drive?.lockout.locked ? <PassengerAsk /> : null}
                <PickupPill s={s} />
                <HealthButton s={s} connected={link.connected} open={healthOpen} onClick={() => { setHealthOpen(!healthOpen); setNetOpen(false); }} />
                <span class="clock num">{clock}</span>
              </>}
          </div>
        </footer>
      ) : railEl}

      {page ? <main class="stage page-stage">{page.node}</main> : <main class="stage">
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
      </main>}

      {cur.id === 'drive' && !page && <DriverPrompt />}
      <GaragePrompt />
      <ModeOverlays />
      <TabletHello />
      {driverOpen && <DriverPanel onClose={() => setDriverOpen(false)} onTheme={driver ? () => { setDriverOpen(false); setPicker(true); } : undefined} />}
      {healthOpen && <HealthPanel s={s} connected={link.connected} onClose={() => setHealthOpen(false)} onNetwork={() => { setHealthOpen(false); setNetOpen(true); }} />}
      {netOpen && <NetPanel s={s} onClose={() => setNetOpen(false)} />}
      {picker && driver && <ThemePicker driver={driver} shown={shown.current!} onClose={() => setPicker(false)} />}
      <VersionBar quiet={!!s?.drive?.lockout.bigTargets} />
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
      {cur.id === 'drive' && !page && !logs && <DueCard onOpen={() => setLogs('maintenance')} />}
      {logs && <LogsPanel initial={logs} onClose={() => setLogs(null)} />}
      <SetupOverlay />
      {simAvailable && <TestPanel open={simOpen} onClose={() => setSimOpen(false)} go={go} />}
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
      <AskHost />
      {!page && <SideCam s={s} />}
      {!page && <StartupAssembly />}
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

/** Below this a tire is low: the phone alert's default (alertMeta.tirePressure). */
const LOW_TIRE_PSI = 30;
/** A low tire on the dash itself, not only on the phone and the tire widget. */
function TireBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  // Under the floor, or 25% under its pressure at the last Reset system (Settings, Vehicle settings).
  const base = useStore(settingsStore)?.vehicle?.tpmsBaseline ?? null;
  const low = lowTires(s?.tpms ?? null, base, LOW_TIRE_PSI);
  if (!low.length) return null;
  return <AlertBanner id={`tire:${low.join(',')}`} tone="bad" title="Tire low" onOpen={() => go('control')}>{low.map((w) => `${w.toUpperCase()} ${Math.round(s!.tpms![w].psi!)} psi`).join(', ')}</AlertBanner>;
}

/** A crash or closure close ahead, or an enforcement camera coming up. */
function TrafficBanner({ s, go }: { s: State | null; go: (v: string) => void }) {
  const t = s?.traffic ?? (s?.hazard ? { kind: 'hazard' as const, text: s.hazard.text } : null);
  if (!t || s?.roadTrip?.alert || (s?.roadTrip?.coach && (s.roadTrip.coach.state === 'go' || s.roadTrip.coach.state === 'slow'))) return null;
  return <AlertBanner id={`traffic:${t.kind}:${t.text}`} tone={t.kind === 'camera' ? 'warn' : 'bad'} title={t.kind === 'camera' ? 'Camera' : t.kind === 'hazard' ? 'Ahead' : 'Traffic'} onOpen={() => go('traffic')}>{t.text}</AlertBanner>;
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
    return <AlertBanner id={`coach:${c.state}`} tone={c.state === 'slow' ? 'bad' : 'ok'} title={c.state === 'go' ? 'GO' : 'Slow stall'} onOpen={() => go('roadtrip')}>{c.message.replace(/^GO:\s*/, '')}</AlertBanner>;
  }
  if (rt.alert) return <AlertBanner id={`trip:${rt.alert.kind}:${rt.alert.message}`} tone={rt.alert.kind === 'full' ? 'bad' : 'warn'} title="Road trip" onOpen={() => go('roadtrip')}>{rt.alert.message}</AlertBanner>;
  return null;
}

/** Charging at home during on-peak (red), or plugged in just before it (amber). Every view. */
function PeakBanner({ s }: { s: State | null }) {
  const cp = s?.chargePeak;
  if (cp?.onPeak) return <AlertBanner id={`peak:${cp.title}`} tone="bad" title={cp.title} alert>{cp.message}</AlertBanner>;
  if (cp?.headsUp) return <AlertBanner id={`peakSoon:${cp.headsUpTitle}`} tone="warn" title={cp.headsUpTitle}>{cp.headsUp}</AlertBanner>;
  return null;
}
