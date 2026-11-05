import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_LAYOUT } from '../../../brain/src/layout.ts';
import { activeDriver, linkStore, loadSettings, putDriver, settingsStore, stateStore, toast, toastStore, useStore, type Driver, type Layout, type State } from '../lib/brain.ts';
import { allThemes, isLight, paintTheme, pickTheme, type Theme } from '../lib/theme.ts';
import { carplay } from '../carplay/controller.ts';
import { V } from './common.tsx';
import { ChargePrompt } from './costs.tsx';
import { widgetFor } from './widgets.tsx';
import { DriverBadge, DriverPanel, DriverPrompt } from './drivers.tsx';
import { NetPanel, NetPill } from './network.tsx';
import { WeatherOverlay, WeatherStrip } from '../drive/WeatherStrip.tsx';
import { MEDIA_ICON, TrackBOverlays, withMediaView } from '../media/trackb.tsx';
import { WoprButton } from '../wopr/WoprUi.tsx';

const ICONS: Record<string, string> = {
  drive: 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
  carplay: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 12h8M12 8v8',
  control: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8',
  charge: 'M13 2 4 14h7l-1 8 9-12h-7z',
  trips: 'M5 19a2 2 0 1 0 0-.01M19 5a2 2 0 1 0 0-.01M7 19h7a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h7',
  cams: 'M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 11l5-3v8l-5-3',
  media: MEDIA_ICON,
};
const GEAR = 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';
const PALETTE = 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.7-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 12a1 1 0 1 0 0-.01M10 8a1 1 0 1 0 0-.01M14 8a1 1 0 1 0 0-.01';
const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** Back from cams this long after reverse ends (the plan's 3 s). */
const REVERSE_RETURN_MS = 3000;

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return t;
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
  const base = driver?.layout?.views?.length ? driver.layout : DEFAULT_LAYOUT;
  const layout = useMemo(() => withMediaView(base), [base]);
  const [view, setView] = useState(() => viewFromHash(layout));
  const [picker, setPicker] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
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
  const cols = Math.max(1, ...cur.widgets.map((w) => w.col + w.w - 1));
  const rows = Math.max(1, ...cur.widgets.map((w) => w.row + w.h - 1));

  return (
    <div class={`app ${s?.drive?.lockout.bigTargets ? 'at-speed' : ''} ${s?.drive && s.drive.heat.level !== 'ok' ? 'calm' : ''}`}>
      <header class="strip">
        <span class="brand">SLATE</span>
        <span class="pill" title={link.connected ? 'Connected to the brain' : 'Reconnecting to the brain…'}><span class={`dot ${link.connected ? 'ok' : 'bad'}`} />{link.connected ? 'Brain' : 'Reconnecting'}</span>
        <span class="pill hide-sm" title={s?.truckbox ? 'Truck box online' : 'Truck box offline: relays and sensors unavailable'}><span class={`dot ${s?.truckbox ? 'ok' : 'warn'}`} />Truck box {s?.truckbox ? 'online' : 'offline'}</span>
        <span class="pill hide-sm" title={s?.gps?.fix ? 'GPS fix' : 'No GPS fix'}><span class={`dot ${s?.gps?.fix ? 'ok' : 'warn'}`} />GPS</span>
        <NetPill s={s} open={netOpen} onClick={() => setNetOpen(!netOpen)} />
        {s?.place && <span class="pill hide-sm" title={`Stopped since ${new Date(s.place.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}>{s.place.name ?? 'Unnamed stop'}</span>}
        <span class="sp" />
        <WeatherStrip s={s} />
        <span class="clock num">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </header>

      <nav class="rail" aria-label="Views">
        {layout.views.map((v) => (
          <a href={`#${v.id}`} aria-current={v.id === cur.id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(v.id); }}>
            <Ico d={ICONS[v.id] ?? ICONS.drive} />{v.label}
          </a>
        ))}
        <WoprButton />
        <button type="button" aria-expanded={driverOpen} title={s?.driver ? `Driver: ${s.driver.name}` : 'Pick the driver'} onClick={() => { setDriverOpen(!driverOpen); setPicker(false); }}><DriverBadge d={s?.driver ?? null} size={30} />{s?.driver?.name ?? 'Driver'}</button>
        <button type="button" aria-expanded={picker} onClick={() => { setPicker(!picker); setDriverOpen(false); }}><Ico d={PALETTE} />Theme</button>
        <a href="/settings" class={s?.drive?.lockout.locked ? 'locked' : undefined} aria-disabled={s?.drive?.lockout.locked || undefined} title={s?.drive?.lockout.locked ? 'Settings open when the truck stops' : undefined}><Ico d={GEAR} />Settings</a>
      </nav>

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
      {driverOpen && <DriverPanel onClose={() => setDriverOpen(false)} />}
      {netOpen && <NetPanel s={s} onClose={() => setNetOpen(false)} />}
      {picker && driver && <ThemePicker driver={driver} shown={shown.current!} onClose={() => setPicker(false)} />}
      <ChargePrompt />
      <WeatherOverlay s={s} />
      <TrackBOverlays />
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
        <Swatch t={shown} /><span><b>Auto</b> <span class="dimtxt" style="font-size:13px">sunrise/sunset · {allThemes(ts).find((x) => x.id === ts.auto.day)?.name} / {allThemes(ts).find((x) => x.id === ts.auto.night)?.name}</span></span>
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
