// TEST PANEL (SIM=1 only): drive the simulated truck by hand and watch the
// cockpit react. A side panel, so the screen behind it stays visible.
//   Drive    gear, ignition, speed, which leg, auto loop vs manual
//   Charge   plug in at home or a DC fast charger (sped up), unplug, set the level
//   Truck    cabin heat, aux battery, a flat tire, the Five Switch, a bump, a tow-away
//   Cameras  every desk camera live, and the desk camera set back
//   CarPlay  the simulator on or off (remembered in this browser)
// The brain refuses all of it on a real truck (brain/src/simRoutes.ts answers 404).
import { useEffect, useState } from 'preact/hooks';
import type { SimControl, SimStatus as SimTruckStatus } from '../../../brain/src/sim.ts';

type SimStatus = SimTruckStatus & { soc: number | null; rangeMi: number | null };
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { useCamStatus } from '../lib/cams.ts';
import { CamPlayer } from '../components/camplayer.tsx';
import { carplaySimWanted, setCarplaySim } from '../carplay/sim.ts';
import './sim.css';

const LS_OPEN = 'slate.simPanel';
type Tab = 'drive' | 'charge' | 'truck' | 'cams' | 'carplay';

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

/** Is this brain simulated? Asked once per page. */
let simKnown: Promise<boolean> | null = null;
export function isSimBrain(): Promise<boolean> {
  simKnown ??= fetch('/api/sim').then((r) => r.ok).catch(() => false);
  return simKnown;
}

export function useSimAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { void isSimBrain().then(setOk); }, []);
  return ok;
}

/** The panel, mounted once in App. Opens from More › Test panel; stays open across reloads. */
export function TestPanel({ open, onClose, go }: { open: boolean; onClose: () => void; go: (view: string) => void }) {
  const [tab, setTab] = useState<Tab>((lsGet(`${LS_OPEN}.tab`) as Tab) || 'drive');
  const [st, setSt] = useState<SimStatus | null>(null);
  const [small, setSmall] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const f = () => api<SimStatus>('/api/sim').then((s) => { if (alive) setSt(s); }).catch(() => { /* brain restarting */ });
    f();
    const id = setInterval(f, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [open]);

  if (!open) return null;
  const pick = (t: Tab) => { setTab(t); lsSet(`${LS_OPEN}.tab`, t); };
  const set = async (patch: Partial<SimControl>) => {
    try { setSt(await api<SimStatus>('/api/sim', { method: 'POST', body: JSON.stringify(patch) })); }
    catch (e) { toast(`Sim: ${(e as Error).message}`); }
  };
  const post = async (path: string, body: unknown = {}) => {
    try { const r = await api<SimStatus>(path, { method: 'POST', body: JSON.stringify(body) }); if (r && 'mode' in r) setSt(r); return true; }
    catch (e) { toast(`Sim: ${(e as Error).message}`); return false; }
  };

  if (small) {
    return <button type="button" class="simpanel-tab" onClick={() => setSmall(false)} title="Open the test panel">SIM {st ? `${Math.round(st.speedMph)} mph` : ''}</button>;
  }

  return (
    <aside class="card simpanel" aria-label="Test panel">
      <div class="row between">
        <b class="lbl">TEST PANEL · SIM</b>
        <span>
          <button type="button" class="btn sm" onClick={() => setSmall(true)} title="Shrink to a tab">–</button>{' '}
          <button type="button" class="btn sm" onClick={onClose}>Close</button>
        </span>
      </div>
      <div class="simseg simtabs" role="tablist">
        {(['drive', 'charge', 'truck', 'cams', 'carplay'] as Tab[]).map((t) => (
          <button type="button" role="tab" aria-selected={tab === t} class={tab === t ? 'sel' : ''} onClick={() => pick(t)}>{t === 'cams' ? 'Cameras' : t === 'carplay' ? 'CarPlay' : t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div class="simbody">
        {!st ? <div class="dimtxt">Asking the brain…</div>
          : tab === 'drive' ? <DriveTab st={st} set={set} post={post} />
          : tab === 'charge' ? <ChargeTab st={st} set={set} post={post} />
          : tab === 'truck' ? <TruckTab st={st} set={set} post={post} />
          : tab === 'cams' ? <CamsTab st={st} set={set} post={post} go={go} />
          : <CarPlayTab go={go} />}
      </div>
    </aside>
  );
}

type TabProps = { st: SimStatus; set: (p: Partial<SimControl>) => Promise<void>; post: (path: string, body?: unknown) => Promise<boolean> };

function Readout({ st }: { st: SimStatus }) {
  const s = useStore(stateStore);
  return (
    <div class="simread">
      <span class="num simspeed">{Math.round(st.speedMph)}<small> mph</small></span>
      <span class={`tag ${st.ignitionOn ? 'ok' : 'dim'}`}>IGN {st.ignitionOn ? 'ON' : 'OFF'}</span>
      {st.reverseOn && <span class="tag warn">REVERSE</span>}
      {st.soc !== null && <span class={`tag ${st.soc <= 10 ? 'bad' : st.soc <= 20 ? 'warn' : 'dim'}`}>{Math.round(st.soc)}%</span>}
      {st.charging && <span class="tag ok">CHARGING</span>}
      {st.towing && <span class="tag bad">BEING TOWED</span>}
      {st.arrived && <span class="tag">ARRIVED</span>}
      <span class="dimtxt">{st.legs[st.leg]}{s?.drive?.lockout.locked ? ' · lockout on' : ''}</span>
    </div>
  );
}

function DriveTab({ st, set, post }: TabProps) {
  const manual = st.mode === 'manual';
  return (
    <div class="simgrid">
      <Readout st={st} />
      <div class="simrow"><span class="lbl">Who drives</span>
        <div class="simseg">
          <button type="button" class={!manual ? 'sel' : ''} onClick={() => void set({ mode: 'auto' })} title="The built-in loop: park 200 s, back out, drive a leg, arrive">Auto loop</button>
          <button type="button" class={manual ? 'sel' : ''} onClick={() => void set({ mode: 'manual' })}>Me</button>
        </div>
      </div>
      <div class="simrow"><span class="lbl">Gear</span>
        <div class="simseg gears">
          {(['park', 'reverse', 'drive'] as const).map((g) => <button type="button" class={manual && st.gear === g ? 'sel' : ''} onClick={() => void set({ gear: g })}>{g[0].toUpperCase()}</button>)}
        </div>
        <button type="button" class={`btn sm ${st.ignitionOn ? 'primary' : ''}`} disabled={manual && st.gear !== 'park'} onClick={() => void set({ ignition: !st.ignition })}>Ignition {st.ignition && manual ? 'on' : 'off'}</button>
      </div>
      <div class="simrow col"><span class="lbl">Speed in D: {st.targetMph} mph</span>
        <input type="range" min={0} max={85} step={5} value={st.targetMph} onChange={(e) => void set({ targetMph: Number((e.target as HTMLInputElement).value) })} />
        <div class="row">
          {[0, 15, 35, 45, 65, 80].map((v) => <button type="button" class={`btn sm ${st.targetMph === v ? 'primary' : ''}`} onClick={() => void set({ targetMph: v, gear: 'drive' })}>{v}</button>)}
        </div>
      </div>
      <div class="simrow col"><span class="lbl">Route</span>
        {st.legs.map((name, i) => (
          <div class="row between">
            <span class={i === st.leg ? '' : 'dimtxt'}>{i === st.leg ? '▶ ' : ''}{name}</span>
            <button type="button" class="btn sm" disabled={st.speedMph > 1} onClick={() => void post('/api/sim/jump', { leg: i })} title={st.speedMph > 1 ? 'Stop first' : 'Put the truck at the start of this leg'}>Go to start</button>
          </div>
        ))}
        <label class="row"><input type="checkbox" checked={st.loop} onChange={(e) => void set({ loop: (e.target as HTMLInputElement).checked })} /> Keep going at the end of a leg (off: stop and arrive)</label>
      </div>
      <div class="row">
        <button type="button" class="btn" onClick={() => void set({ gear: 'reverse' }).then(() => setTimeout(() => void set({ gear: 'drive', targetMph: 35 }), 5000))}>Back out and drive</button>
        <button type="button" class="btn" onClick={() => void set({ gear: 'park', ignition: false })}>Park and switch off</button>
      </div>
      {st.speedup > 1 && <div class="dimtxt">Time runs {st.speedup}× (SIM_SPEEDUP).</div>}
    </div>
  );
}

function ChargeTab({ st, post }: TabProps) {
  const [target, setTarget] = useState(80);
  const p = st.charging;
  const plug = (kind: 'home' | 'fast') => void post('/api/sim/charge', { kind, target });
  return (
    <div class="simgrid">
      <Readout st={st} />
      <div class="simrow"><span class="lbl">Charge</span>
        <span class="num simspeed">{st.soc === null ? '–' : Math.round(st.soc)}<small>%</small></span>
        <span class="dimtxt">{st.rangeMi === null ? '' : `${Math.round(st.rangeMi)} mi range`}</span>
      </div>
      <div class="simrow"><span class="lbl">Charge to</span>
        <div class="simseg">
          {[80, 90, 100].map((v) => <button type="button" class={target === v ? 'sel' : ''} onClick={() => setTarget(v)}>{v}%</button>)}
        </div>
      </div>
      {p ? (
        <div class="simrow col">
          <span>Plugged in: {p.kind === 'home' ? 'home wall charger' : 'DC fast charger'}, {p.kw} kW, to {p.targetPct}%.</span>
          <button type="button" class="btn primary" onClick={() => void post('/api/sim/unplug')}>Unplug</button>
        </div>
      ) : (
        <div class="row">
          <button type="button" class="btn primary" disabled={st.speedMph > 1} onClick={() => plug('home')}>Plug in at home (7.2 kW)</button>
          <button type="button" class="btn" disabled={st.speedMph > 1} onClick={() => plug('fast')}>DC fast charge (150 kW)</button>
        </div>
      )}
      <div class="simrow col"><span class="lbl">Set the level now</span>
        <div class="row">
          {[5, 20, 50, 80, 100].map((v) => <button type="button" class="btn sm" onClick={() => void post('/api/sim/soc', { value: v })}>{v}%</button>)}
        </div>
        <span class="dimtxt">Like the cockpit's own slider: a jump up while parked is logged as a charge.</span>
      </div>
      <span class="dimtxt">Sped up: home charging runs 60× (an hour a minute), DC fast 10× and tapers past 80%. Plugging in parks the truck and switches it off; putting it in gear unplugs it. A home charge counts for the on-peak warning, and each charge shows in the charge history.</span>
    </div>
  );
}

function TruckTab({ st, set, post }: TabProps) {
  return (
    <div class="simgrid">
      <Readout st={st} />
      <div class="simrow"><span class="lbl">Cabin</span>
        <div class="simseg">
          <button type="button" class={st.cabinF === null ? 'sel' : ''} onClick={() => void set({ cabinF: null })}>Normal</button>
          <button type="button" class={st.cabinF === 88 ? 'sel' : ''} onClick={() => void set({ cabinF: 88 })}>Warm 88°</button>
          <button type="button" class={st.cabinF === 120 ? 'sel' : ''} onClick={() => void set({ cabinF: 120 })}>Hot 120°</button>
          <button type="button" class={st.cabinF === 30 ? 'sel' : ''} onClick={() => void set({ cabinF: 30 })}>Cold 30°</button>
        </div>
      </div>
      <div class="simrow"><span class="lbl">12V battery</span>
        <div class="simseg">
          <button type="button" class={st.auxV === null ? 'sel' : ''} onClick={() => void set({ auxV: null })}>Normal</button>
          <button type="button" class={st.auxV === 11.8 ? 'sel' : ''} onClick={() => void set({ auxV: 11.8 })}>Low 11.8 V</button>
          <button type="button" class={st.auxV === 10.9 ? 'sel' : ''} onClick={() => void set({ auxV: 10.9 })}>Flat 10.9 V</button>
        </div>
      </div>
      <div class="simrow"><span class="lbl">Low tire (22 psi)</span>
        <div class="simseg">
          {([null, 'fl', 'fr', 'rl', 'rr'] as const).map((w) => <button type="button" class={st.lowTire === w ? 'sel' : ''} onClick={() => void set({ lowTire: w })}>{w ? w.toUpperCase() : 'None'}</button>)}
        </div>
      </div>
      <div class="simrow"><span class="lbl">Five Switch</span>
        <div class="simseg">
          {st.switches.map((on, i) => <button type="button" class={on ? 'sel' : ''} onClick={() => void set({ switches: st.switches.map((v, j) => (j === i ? !v : v)) })}>{i + 1}</button>)}
        </div>
      </div>
      <div class="simrow col"><span class="lbl">Events</span>
        <div class="row">
          <button type="button" class="btn" onClick={() => void post('/api/sim/bump').then((ok) => ok && toast('Bumped the truck box (vibration)'))}>Bump the truck</button>
          <button type="button" class="btn" onClick={() => void post('/api/sim/tow', { seconds: 90 }).then((ok) => ok && toast('Towing it away: the theft alert fires past the alert radius'))}>Tow it away</button>
        </div>
        <span class="dimtxt">Alerts from a simulated truck are logged, not sent to the phone, unless SIM_ALERTS=1.</span>
      </div>
    </div>
  );
}

function CamsTab({ st, set, post, go }: TabProps & { go: (v: string) => void }) {
  const { status, error, reload } = useCamStatus(5000);
  const cams = status?.cameras.filter((c) => c.enabled) ?? [];
  return (
    <div class="simgrid">
      <div class="row">
        <button type="button" class={`btn sm ${st.reverseOn ? 'primary' : ''}`} onClick={() => void set({ gear: st.gear === 'reverse' ? 'park' : 'reverse' })}>{st.reverseOn ? 'Out of reverse' : 'Reverse (rear camera takes over)'}</button>
        <button type="button" class="btn sm" onClick={() => go('cams')}>Open Cams view</button>
        <button type="button" class="btn sm" onClick={() => void post('/api/sim/cameras').then((ok) => { if (ok) { toast('Desk cameras: rear, front, hitch, bed, 360'); reload(); } })}>Reset desk cameras</button>
      </div>
      {error && <div class="banner">{error}</div>}
      {status?.backend === 'off' && <div class="banner">{status.why}</div>}
      {status && !cams.length && <div class="dimtxt">No cameras switched on. Reset desk cameras adds the five test cameras.</div>}
      <div class="simcams">
        {status && cams.map((c) => <CamPlayer cam={c} backend={status.backend} guides={status.guides} />)}
      </div>
      <span class="dimtxt">Desk cameras are moving test patterns (a different colour each). On the truck the same tiles show the AHD cameras.</span>
    </div>
  );
}

function CarPlayTab({ go }: { go: (v: string) => void }) {
  const on = carplaySimWanted();
  return (
    <div class="simgrid">
      <div class="simrow"><span class="lbl">CarPlay simulator</span><span class={`tag ${on ? 'ok' : 'dim'}`}>{on ? 'ON' : 'OFF'}</span></div>
      <p class="dimtxt">On: the CarPlay view plays a recorded CarPlay screen with fake now-playing tracks, through the same decode, touch and now-playing path as the Carlinkit dongle. Off: it waits for the real dongle. The page reloads to switch.</p>
      <div class="row">
        <button type="button" class="btn primary" onClick={() => setCarplaySim(!on)}>{on ? 'Turn the simulator off' : 'Turn the simulator on'}</button>
        <button type="button" class="btn" onClick={() => go('carplay')}>Open CarPlay view</button>
      </div>
    </div>
  );
}
