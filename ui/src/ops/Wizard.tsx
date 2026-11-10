// First-boot setup, on the cockpit screen and in /settings. Every step can be
// skipped; progress is kept on the brain, so it resumes where it was left.
import { useEffect, useState } from 'preact/hooks';
import { api, loadSettings, settingsStore, stateStore, toast, useStore, type CompareVehicle, type Driver, type Settings } from '../lib/brain.ts';
import { VehiclePicker } from '../settings/VehiclePicker.tsx';
import { truckOf, truckPhotoUrl } from '../drive/hooks.ts';
import { PROJECT } from '../../../brain/src/project.ts';
import { errText, post, put, type SetupResp } from './api.ts';
import './ops.css';

const TITLES: Record<string, string> = { password: 'Admin password', ap: "Truck Wi-Fi password", truck: 'Truck', home: 'Home', drivers: 'Drivers', ha: 'Home Assistant', hotspot: 'Phone hotspots', vehicle: 'Gas comparison' };

type StepProps = { setup: SetupResp; settings: Settings; next: () => Promise<void> };

export function SetupWizard({ portal = false, onClose }: { portal?: boolean; onClose?: () => void }) {
  const settings = useStore(settingsStore);
  const [setup, setSetup] = useState<SetupResp | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const load = async () => { const s = await api<SetupResp>('/api/setup'); setSetup(s); return s; };
  useEffect(() => { void load().then((s) => setCur(s.stepsList.find((k) => !s.steps[k]) ?? s.stepsList[0])).catch(() => {}); }, []);
  if (!setup || !settings || !cur) return <div class={portal ? 'wiz wiz-portal' : 'wiz'}>Loading setup…</div>;

  const mark = async (status: 'done' | 'skipped') => {
    const s = await put<SetupResp>('/api/setup', { step: cur, status });
    setSetup(s);
    const after = s.stepsList.slice(s.stepsList.indexOf(cur) + 1).find((k) => !s.steps[k]) ?? s.stepsList.find((k) => !s.steps[k]);
    if (!after) { toast('Setup finished'); onClose?.(); return; }
    setCur(after);
  };
  const Step = STEPS[cur];
  return (
    <div class={portal ? 'wiz wiz-portal' : 'wiz'} role={portal ? undefined : 'dialog'} aria-label="Setup">
      <div class="row between wrap">
        <h2>{portal ? 'Setup' : `Set up ${PROJECT.name}`} · {TITLES[cur]}</h2>
        {!portal && <button class="btn" type="button" onClick={onClose}>Finish later</button>}
      </div>
      <div class="dots">{setup.stepsList.map((k) => <button type="button" class={`${k === cur ? 'cur' : ''} ${setup.steps[k] ?? ''}`} onClick={() => setCur(k)}>{setup.steps[k] === 'done' ? '✓ ' : ''}{TITLES[k]}</button>)}</div>
      <Step setup={setup} settings={settings} next={() => mark('done')} />
      <div class="row wrap">
        <button class="btn" type="button" onClick={() => void mark('skipped')}>Skip this step</button>
        {!setup.done && <button class="btn" type="button" onClick={async () => { await put('/api/setup', { done: true }); toast('Setup closed: run it again from Settings, Setup'); onClose?.(); }}>Skip the rest</button>}
        {setup.done && portal && <button class="btn sm" type="button" onClick={async () => { await put('/api/setup', { reset: true }); await load(); setCur(setup.stepsList[0]); }}>Start over</button>}
      </div>
    </div>
  );
}

function useSave(next: () => Promise<void>) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); await loadSettings(); await next(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return { err, busy, run };
}
const Err = ({ e }: { e: string | null }) => (e ? <span class="err">{e}</span> : null);
const val = (e: Event) => (e.target as HTMLInputElement).value;

function PasswordStep({ setup, next }: StepProps) {
  const [cur, setCurPw] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const { err, busy, run } = useSave(next);
  return (
    <div class="form">
      <p class="help">Protects /settings and the Truck page when they're opened from a phone or over Tailscale. This screen on the dash stays open. At least 8 characters.</p>
      <div class="fields form">
        {setup.passwordSet && <label class="f"><span>Current password</span><input type="password" autocomplete="current-password" value={cur} onInput={(e) => setCurPw(val(e))} /></label>}
        <label class="f"><span>{setup.passwordSet ? 'New password' : 'Password'}</span><input type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw(val(e))} /></label>
        <label class="f"><span>Again</span><input type="password" autocomplete="new-password" value={pw2} onInput={(e) => setPw2(val(e))} /></label>
      </div>
      <div class="row wrap"><button class="btn big primary" type="button" disabled={busy || !pw || pw !== pw2} onClick={() => void run(() => post('/api/auth/password', { current: cur || undefined, next: pw }))}>{setup.passwordSet ? 'Change password' : 'Set password'}</button>
        {setup.passwordSet && <span class="okmsg">A password is already set.</span>}{pw && pw2 && pw !== pw2 && <span class="err">They don't match</span>}<Err e={err} /></div>
    </div>
  );
}

function ApStep({ setup, next }: StepProps) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const { err, busy, run } = useSave(next);
  return (
    <div class="form">
      <p class="help">The truck's own Wi-Fi, "slate-truck": the truck box and a phone opening Settings join it. 8 to 63 characters. Afterwards put the same password in the truck box's ESPHome secrets (wifi_password).</p>
      {setup.apInitialPassword && <div class="banner">The password it came with: <b class="num">{setup.apInitialPassword}</b>. Change it now.</div>}
      <label class="f"><span>New Wi-Fi password</span><input type="text" autocomplete="off" value={pw} onInput={(e) => setPw(val(e))} /></label>
      <div class="row wrap"><button class="btn big primary" type="button" disabled={busy || pw.length < 8} onClick={() => void run(async () => { const r = await post<{ message: string }>('/api/setup/ap-password', { password: pw }); setMsg(r.message); toast(r.message); })}>Set Wi-Fi password</button>{msg && <span class="okmsg">{msg}</span>}<Err e={err} /></div>
    </div>
  );
}

function TruckStep({ settings, next }: StepProps) {
  const [id, setId] = useState(settings.truckId); const [pack, setPack] = useState(String(settings.packKwh));
  const { err, busy, run } = useSave(next);
  const photo = truckPhotoUrl(truckOf(settings));
  return (
    <div class="form">
      {photo && <img src={photo} alt="Your truck" style="display:block;width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius);background:var(--panel-2)" />}
      <div class="fields form">
        <label class="f"><span>Truck id (MQTT prefix)</span><input type="text" value={id} onInput={(e) => setId(val(e))} /></label>
        <label class="f"><span>Usable pack kWh</span><input type="number" step="0.1" value={pack} onInput={(e) => setPack(val(e))} /></label>
      </div>
      <p class="help">Pack size is a guess until delivery: 52.7 kWh was announced for the standard pack. Changing the truck id needs a brain restart for MQTT. Colours, accessories and a photo of your truck: Settings, Truck, My Slate.</p>
      <div class="row"><button class="btn big primary" type="button" disabled={busy} onClick={() => void run(() => put('/api/settings', { truckId: id.trim(), packKwh: Number(pack) }))}>Save</button><Err e={err} /></div>
    </div>
  );
}

function HomeStep({ settings, next }: StepProps) {
  const st = useStore(stateStore);
  const [lat, setLat] = useState(settings.homeLocation ? String(settings.homeLocation.lat) : '');
  const [lon, setLon] = useState(settings.homeLocation ? String(settings.homeLocation.lon) : '');
  const [ssid, setSsid] = useState(settings.homeWifi?.ssid ?? ''); const [wpw, setWpw] = useState('');
  const { err, busy, run } = useSave(next);
  const gps = st?.gps?.fix ? st.gps : null;
  return (
    <div class="form">
      <p class="help">Home is where charging is priced at your home rate, and home Wi-Fi is when nightly backups run.</p>
      <div class="fields form">
        <label class="f"><span>Latitude</span><input type="text" inputMode="decimal" value={lat} onInput={(e) => setLat(val(e))} /></label>
        <label class="f"><span>Longitude</span><input type="text" inputMode="decimal" value={lon} onInput={(e) => setLon(val(e))} /></label>
      </div>
      <div><button class="btn sm" type="button" disabled={!gps} onClick={() => { if (gps) { setLat(gps.lat.toFixed(6)); setLon(gps.lon.toFixed(6)); } }}>{gps ? "Use the truck's position" : 'No GPS fix yet'}</button></div>
      <div class="fields form">
        <label class="f"><span>Home Wi-Fi name</span><input type="text" value={ssid} onInput={(e) => setSsid(val(e))} /></label>
        <label class="f"><span>Home Wi-Fi password</span><input type="password" autocomplete="off" value={wpw} placeholder={settings.homeWifi?.password ? 'set; type to replace' : ''} onInput={(e) => setWpw(val(e))} /></label>
      </div>
      <div class="row"><button class="btn big primary" type="button" disabled={busy} onClick={() => void run(() => put('/api/settings', {
        homeLocation: lat && lon ? { lat: Number(lat), lon: Number(lon) } : null,
        homeWifi: ssid.trim() ? { ssid: ssid.trim(), password: wpw || settings.homeWifi?.password } : null,
      }))}>Save</button><Err e={err} /></div>
    </div>
  );
}

function DriversStep({ settings, next }: StepProps) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const named = settings.drivers.filter((d) => !d.guest);
  const act = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); await loadSettings(); } catch (e) { setErr(errText(e)); } };
  return (
    <div class="form">
      <p class="help">Who drives the truck. Each gets their own theme, layout and charging preferences (more in Settings, Drivers). A Guest profile always exists.</p>
      <div class="list">{named.map((d) => (
        <div class="item row" style="justify-content:space-between"><span><b>{d.name}</b> <span class="dimtxt">{d.tracker ?? 'no phone tracker'}</span></span>
          <button class="btn sm danger" type="button" disabled={named.length <= 1} onClick={() => { if (confirm(`Remove ${d.name}?`)) void act(() => api(`/api/drivers/${d.id}`, { method: 'DELETE' })); }}>Remove</button></div>))}</div>
      <div class="row"><input type="text" placeholder="Add a driver" value={name} onInput={(e) => setName(val(e))} style="max-width:280px" /><button class="btn" type="button" disabled={!name.trim()} onClick={() => void act(async () => { await post('/api/drivers', { name: name.trim() }); setName(''); })}>Add</button></div>
      <div class="row"><button class="btn big primary" type="button" onClick={() => void next()}>These are the drivers</button><Err e={err} /></div>
    </div>
  );
}

function HaStep({ settings, next }: StepProps) {
  const [url, setUrl] = useState(settings.homeAssistant.url ?? ''); const [token, setToken] = useState('');
  const [test, setTest] = useState<{ reachable: boolean; message: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saveTest = async () => {
    setErr(null); setTest(null);
    try {
      await put('/api/settings', { homeAssistant: { url: url.trim() || null, ...(token.trim() ? { token: token.trim() } : {}) } });
      await loadSettings();
      setTest(await api('/api/ha/status'));
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <div class="form">
      <p class="help">Optional. Lets the truck read phone locations, zones and gas prices from HA. Use a separate, non-admin HA user for the token (docs/security.md).</p>
      <div class="fields form">
        <label class="f"><span>Home Assistant URL</span><input type="url" value={url} placeholder="http://homeassistant.local:8123" onInput={(e) => setUrl(val(e))} /></label>
        <label class="f"><span>Long-lived access token</span><input type="password" autocomplete="off" value={token} placeholder={settings.homeAssistant.token ? 'set; type to replace' : 'HA profile → Security'} onInput={(e) => setToken(val(e))} /></label>
      </div>
      <div class="row wrap"><button class="btn big" type="button" onClick={() => void saveTest()}>Save and test</button>
        {test && <span class={test.reachable ? 'okmsg' : 'err'}>{test.reachable ? 'Home Assistant answered.' : test.message}</span>}<Err e={err} />
        <button class="btn big primary" type="button" disabled={!test?.reachable} onClick={() => void next()}>Next</button></div>
    </div>
  );
}

function HotspotStep({ settings, next }: StepProps) {
  const named = settings.drivers.filter((d) => !d.guest);
  const [v, setV] = useState<Record<string, { ssid: string; password: string }>>(Object.fromEntries(named.map((d) => [d.id, { ssid: d.hotspot?.ssid ?? '', password: '' }])));
  const { err, busy, run } = useSave(next);
  const save = () => run(async () => {
    for (const d of named as Driver[]) {
      const x = v[d.id];
      if (!x) continue;
      if (!x.ssid.trim() && !d.hotspot) continue;
      await put(`/api/drivers/${d.id}`, { hotspot: x.ssid.trim() ? { ssid: x.ssid.trim(), password: x.password || d.hotspot?.password } : null });
    }
  });
  return (
    <div class="form">
      <p class="help">The cockpit has no modem: away from home it goes online through the driver's phone hotspot.</p>
      {named.map((d) => (
        <div class="fields form"><label class="f"><span>{d.name}: hotspot name</span><input type="text" value={v[d.id]?.ssid ?? ''} onInput={(e) => setV({ ...v, [d.id]: { ...v[d.id], ssid: val(e) } })} /></label>
          <label class="f"><span>Password</span><input type="password" autocomplete="off" value={v[d.id]?.password ?? ''} placeholder={d.hotspot?.password ? 'set; type to replace' : ''} onInput={(e) => setV({ ...v, [d.id]: { ...v[d.id], password: val(e) } })} /></label></div>
      ))}
      <div class="row"><button class="btn big primary" type="button" disabled={busy} onClick={() => void save()}>Save</button><Err e={err} /></div>
    </div>
  );
}

function VehicleStep({ settings, next }: StepProps) {
  const [veh, setVeh] = useState<CompareVehicle>(settings.compareVehicle);
  const { err, busy, run } = useSave(next);
  return (
    <div class="form">
      <p class="help">The gas vehicle you'd otherwise drive, for "what gas would have cost".</p>
      <VehiclePicker value={veh} onChange={setVeh} />
      <div class="row"><button class="btn big primary" type="button" disabled={busy} onClick={() => void run(() => put('/api/settings', { compareVehicle: veh }))}>Save</button><Err e={err} /></div>
    </div>
  );
}

const STEPS: Record<string, (p: StepProps) => preact.JSX.Element> = { password: PasswordStep, ap: ApStep, truck: TruckStep, home: HomeStep, drivers: DriversStep, ha: HaStep, hotspot: HotspotStep, vehicle: VehicleStep };

const LATER = 'slate.setup.later';
/** On the cockpit: shows the wizard until setup is done, unless put off for this session. */
export function SetupOverlay() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let later = false;
    try { later = sessionStorage.getItem(LATER) === '1'; } catch { /* */ }
    if (later || new URLSearchParams(location.search).has('nosetup')) return;
    void api<SetupResp>('/api/setup').then((s) => setShow(!s.done)).catch(() => {});
  }, []);
  if (!show) return null;
  return <div class="ops-scrim"><SetupWizard onClose={() => { try { sessionStorage.setItem(LATER, '1'); } catch { /* */ } setShow(false); }} /></div>;
}
