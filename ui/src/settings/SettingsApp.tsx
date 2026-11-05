// The settings portal at /settings. Phone-first; also reachable from the cockpit rail.
import { useEffect, useState } from 'preact/hooks';
import type { TouPeriod } from '../../../brain/src/types.ts';
import { activeDriver, api, settingsStore, stateStore, useStore, type Health, type Settings } from '../lib/brain.ts';
import { paintTheme, pickTheme } from '../lib/theme.ts';
import { ChargeForm, CostSessions, CostSummary } from '../components/costs.tsx';
import { DriversSection } from './DriversSection.tsx';
import { VehiclePicker } from './VehiclePicker.tsx';
import { GasSection, ImportSection, PlacesSection } from './HaSections.tsx';
import { DriveSection } from './DriveSection.tsx';
import { TrackBSections } from './TrackBSections.tsx';
import { RemoteSection } from './RemoteSection.tsx';
import { OpsSections } from '../ops/OpsSettings.tsx';
import { PROJECT } from '../../../brain/src/project.ts';

const RELAYS = ['relay_1', 'relay_2', 'relay_3', 'relay_4', 'relay_5', 'relay_6'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Draft = Omit<Settings, 'keys' | 'drivers'>;
type Secrets = { afdc: string; openChargeMap: string; placesFeed: string; haToken: string; homeWifi: string };
const NO_SECRETS: Secrets = { afdc: '', openChargeMap: '', placesFeed: '', haToken: '', homeWifi: '' };

const toDraft = (s: Settings): Draft => {
  const { keys: _k, drivers: _d, ...rest } = structuredClone(s);
  delete rest.homeAssistant.token;
  if (rest.homeWifi) delete rest.homeWifi.password;
  return rest;
};

const TABS = [
  { id: 'charging', label: 'Charging & costs' },
  { id: 'drivers', label: 'Drivers & themes' },
  { id: 'truck', label: 'Truck' },
  { id: 'connections', label: 'Home Assistant & places' },
  { id: 'media', label: 'Media & WOPR' },
  { id: 'cameras', label: 'Cameras & remote' },
  { id: 'system', label: 'Logs & system' },
] as const;
type TabId = (typeof TABS)[number]['id'];
/** Tabs whose fields are in the shared draft, so they get the Save bar. */
const DRAFT_TABS: readonly TabId[] = ['charging', 'truck', 'connections'];

/** The tab for the current hash: a tab id, or the tab holding the element with that id. */
function tabFromHash(): TabId {
  const id = location.hash.slice(1);
  const direct = TABS.find((t) => t.id === id);
  if (direct) return direct.id;
  const holder = id ? document.getElementById(id)?.closest('[data-tab]')?.getAttribute('data-tab') : null;
  return (TABS.find((t) => t.id === holder)?.id) ?? (id ? OLD_ANCHORS[id] ?? 'charging' : 'charging');
}
/** Anchors other screens link to, for before the sections have rendered. */
const OLD_ANCHORS: Record<string, TabId> = {
  charge: 'charging', gas: 'charging', drivers: 'drivers', themes: 'drivers', drive: 'truck', 'set-side': 'truck', 'set-rear': 'truck',
  network: 'connections', ha: 'connections', import: 'connections', places: 'connections',
  wopr: 'media', spotify: 'media', radio: 'media', fm: 'media', plex: 'media', files: 'media', receipts: 'media',
  remote: 'cameras', cameras: 'cameras', dashcam: 'cameras', alerts: 'cameras',
  mileage: 'system', maintenance: 'system', updates: 'system', backups: 'system', security: 'system', setup: 'system', about: 'system',
};

function Section({ id, title, help, children }: { id?: string; title: string; help?: string; children: preact.ComponentChildren }) {
  return <section class="card" id={id}><h2>{title}</h2>{help && <p class="help">{help}</p>}{children}</section>;
}

function SecretField({ label, set, value, placeholder, onInput, onClear }: { label: string; set: string | undefined; value: string; placeholder?: string; onInput: (v: string) => void; onClear: () => void }) {
  return (
    <div class="form" style="gap:6px">
      <label class="f"><span>{label}</span>
        <input type="password" autocomplete="off" value={value} placeholder={set ? `set (${set}); type to replace` : placeholder ?? 'not set'} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      </label>
      {set && <button class="btn sm danger" type="button" onClick={onClear}>Remove</button>}
    </div>
  );
}

export function SettingsApp() {
  const settings = useStore(settingsStore);
  const state = useStore(stateStore);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [keys, setKeys] = useState<Secrets>(NO_SECRETS);
  const [health, setHealth] = useState<Health | null>(null);
  const [haTest, setHaTest] = useState<{ reachable: boolean; message: string | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [tab, setTab] = useState<TabId>(() => tabFromHash());
  // Each section folds to its title; tap a title to open it. Only one tab's worth shows at a time.
  const [open, setOpen] = useState<Set<string>>(() => new Set(location.hash ? [location.hash.slice(1)] : []));
  useEffect(() => {
    const root = document.querySelector('.portal');
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-tab] section.card').forEach((sec, i) => {
      const key = sec.id || `s${i}`;
      sec.dataset.key = key;
      const pane = sec.closest('[data-tab]');
      const only = pane ? pane.querySelectorAll('section.card').length === 1 : false;
      sec.classList.toggle('folded', !only && !open.has(key));
      const h = sec.querySelector(':scope > h2');
      if (h) { h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0'); h.setAttribute('aria-expanded', String(!sec.classList.contains('folded'))); }
    });
  });
  useEffect(() => {
    const onClick = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      const h = (e.target as HTMLElement).closest('[data-tab] section.card > h2');
      const sec = h?.parentElement as HTMLElement | null;
      if (!sec?.dataset.key) return;
      e.preventDefault();
      const k = sec.dataset.key;
      setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onClick);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onClick); };
  }, []);

  // /settings#ha, #themes, #spotify … still work: open the tab that holds that section, then scroll to it.
  useEffect(() => {
    const go = () => {
      const t = tabFromHash();
      setTab(t);
      const id = location.hash.slice(1);
      if (id && !TABS.some((x) => x.id === id)) setOpen((o) => new Set(o).add(id));
      if (id && !TABS.some((x) => x.id === id)) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
      else window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  useEffect(() => { if (draft && location.hash && !TABS.some((x) => x.id === location.hash.slice(1))) { const t = tabFromHash(); setTab(t); requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })); } }, [!!draft]);

  useEffect(() => { if (settings && !draft) setDraft(toDraft(settings)); }, [settings]);
  useEffect(() => { if (settings) paintTheme(pickTheme(activeDriver(settings, state)?.theme, state?.gps?.fix ? state.gps : null)); }, [settings, state?.gps?.fix, state?.driver?.id]);
  useEffect(() => { const f = () => api<Health>('/api/health').then(setHealth).catch(() => setHealth(null)); void f(); const id = setInterval(f, 10_000); return () => clearInterval(id); }, []);

  if (!settings || !draft) return <div class="portal-wrap"><p>Loading settings from the brain…</p></div>;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setRate = <K extends keyof Draft['homeRate']>(k: K, v: Draft['homeRate'][K]) => setDraft({ ...draft, homeRate: { ...draft.homeRate, [k]: v } });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const setTou = (i: number, p: Partial<TouPeriod>) => setRate('tou', draft.homeRate.tou.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const haReady = !!(settings.homeAssistant.url && settings.homeAssistant.token);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { ...draft, homeAssistant: { ...draft.homeAssistant } };
      // The truck look and drive settings have their own Save (DriveSection); a stale draft copy must not undo it.
      delete body.truck; delete body.drive;
      if (keys.haToken.trim()) (body.homeAssistant as Record<string, unknown>).token = keys.haToken.trim();
      // no password typed = keep the stored one (for the same network)
      body.homeWifi = draft.homeWifi?.ssid.trim() ? { ssid: draft.homeWifi.ssid.trim(), password: keys.homeWifi || settings.homeWifi?.password } : null;
      const k: Record<string, string> = {};
      for (const n of ['afdc', 'openChargeMap', 'placesFeed'] as const) if (keys[n].trim()) k[n] = keys[n].trim();
      if (Object.keys(k).length) body.keys = k;
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      settingsStore.set(n); setDraft(toDraft(n)); setKeys(NO_SECRETS); setHaTest(null);
      setMsg({ ok: true, text: 'Saved. The cockpit picks it up within a few seconds.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const clear = async (patch: Record<string, unknown>) => {
    try { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }); settingsStore.set(n); setMsg({ ok: true, text: 'Removed.' }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const testHa = async () => { setHaTest(null); try { setHaTest(await api('/api/ha/status')); } catch (e) { setHaTest({ reachable: false, message: (e as Error).message }); } };

  const gps = state?.gps?.fix ? state.gps : null;

  return (
    <div class="portal-wrap portal">
      <div class="portal-head">
        <h1>{PROJECT.shortName} · SETTINGS</h1>
        <span class="pill"><span class={`dot ${health ? 'ok' : 'bad'}`} />{health ? `brain v${health.version}` : 'brain unreachable'}</span>
        {health && <span class="pill"><span class={`dot ${health.mqtt === 'connected' ? 'ok' : 'warn'}`} />MQTT {health.mqtt}</span>}
        {health && <span class="pill"><span class={`dot ${health.gps === 'fix' || health.gps === 'sim' ? 'ok' : 'warn'}`} />GPS {health.gps}</span>}
        {health && <span class="pill"><span class={`dot ${health.ha === 'connected' ? 'ok' : 'warn'}`} />HA {health.ha}</span>}
        <span style="flex:1" />
        <a class="btn" href="/">Back to cockpit</a>
      </div>

      <nav class="settings-tabs" aria-label="Settings sections">
        {TABS.map((t) => <a href={`#${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</a>)}
      </nav>

      <div data-tab="charging" hidden={tab !== 'charging'}>

      <Section id="charge" title="Log a charge" help="Just unplugged at a public charger? Enter what you paid. Home charges are logged and priced by themselves.">
        {logOpen ? <ChargeForm session={null} onDone={() => setLogOpen(false)} /> : <button class="btn big primary" type="button" onClick={() => setLogOpen(true)}>+ Log a charge</button>}
        <CostSummary s={state} go={() => {}} />
        <CostSessions s={state} go={() => {}} />
      </Section>

      <Section title="Home electricity" help="Prices home charging. Time-of-use periods are matched by when the session started; times outside every period use the flat rate.">
        <div class="form">
          <div class="fields">
            <label class="f"><span>Flat $/kWh</span><input type="number" step="0.001" value={draft.homeRate.flatPerKwh ?? ''} placeholder="not set" onInput={(e) => { const v = (e.target as HTMLInputElement).value; setRate('flatPerKwh', v === '' ? null : Number(v)); }} /></label>
            <label class="f"><span>Fixed $ per session</span><input type="number" step="0.01" value={draft.homeRate.fixedPerSession} onInput={(e) => setRate('fixedPerSession', num((e.target as HTMLInputElement).value))} /></label>
          </div>
          <div style="overflow-x:auto">
            <table class="tou">
              <tbody>
                {draft.homeRate.tou.map((t, i) => (
                  <tr>
                    <td><input type="text" value={t.name} placeholder="on-peak" onInput={(e) => setTou(i, { name: (e.target as HTMLInputElement).value })} /></td>
                    <td><div class="daypick">{DAYS.map((d, di) => <button type="button" aria-pressed={t.days.includes(di)} onClick={() => setTou(i, { days: t.days.includes(di) ? t.days.filter((x) => x !== di) : [...t.days, di].sort() })}>{d}</button>)}</div></td>
                    <td><input type="text" inputMode="numeric" value={t.start} placeholder="16:00" style="width:90px" onInput={(e) => setTou(i, { start: (e.target as HTMLInputElement).value })} /></td>
                    <td><input type="text" inputMode="numeric" value={t.end} placeholder="19:00" style="width:90px" onInput={(e) => setTou(i, { end: (e.target as HTMLInputElement).value })} /></td>
                    <td><input type="number" step="0.001" value={t.perKwh} style="width:100px" onInput={(e) => setTou(i, { perKwh: num((e.target as HTMLInputElement).value) })} /></td>
                    <td><button class="btn sm danger" type="button" onClick={() => setRate('tou', draft.homeRate.tou.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button class="btn sm" type="button" onClick={() => setRate('tou', [...draft.homeRate.tou, { name: 'on-peak', days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00', perKwh: 0.25 }])}>+ Add time-of-use period</button></div>
          <p class="help">A period like 21:00–06:00 crosses midnight and belongs to the day it starts on.</p>
        </div>
      </Section>

      <Section id="gas" title="Gas comparison" help="What the gas vehicle you'd otherwise drive would have cost for the same miles. A driver can pick their own vehicle in Drivers.">
        <VehiclePicker value={draft.compareVehicle} onChange={(v) => set('compareVehicle', v)} />
        <h3 class="sub">Gas price</h3>
        <GasSection gas={draft.gas} onChange={(g) => set('gas', g)} haReady={haReady} />
      </Section>

      <Section title="Charger API keys" help="Free keys: developer.nrel.gov/signup (AFDC) and openchargemap.org (My Profile → API keys). Stored on the truck only, never shown again in full.">
        <div class="fields form">
          {(['afdc', 'openChargeMap'] as const).map((k) => (
            <SecretField label={k === 'afdc' ? 'NREL AFDC key' : 'Open Charge Map key'} set={settings.keys[k]} value={keys[k]} onInput={(v) => setKeys({ ...keys, [k]: v })} onClear={() => void clear({ keys: { [k]: '' } })} />
          ))}
        </div>
      </Section>

      </div>

      <div data-tab="drivers" hidden={tab !== 'drivers'}>
      <DriversSection settings={settings} />
      </div>

      <div data-tab="truck" hidden={tab !== 'truck'}>
      <Section title="Truck" help="These settings are the truck's, whoever is driving.">
        <div class="fields form">
          <label class="f"><span>Truck id (MQTT prefix)</span><input type="text" value={draft.truckId} onInput={(e) => set('truckId', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Usable pack kWh</span><input type="number" step="0.1" value={draft.packKwh} onInput={(e) => set('packKwh', num((e.target as HTMLInputElement).value))} /></label>
          <label class="f"><span>Efficiency mi/kWh</span><input type="number" step="0.05" value={draft.efficiencyMiPerKwh} onInput={(e) => set('efficiencyMiPerKwh', num((e.target as HTMLInputElement).value))} /></label>
        </div>
        <p class="help">Pack size is a guess until delivery (52.7 kWh was announced; 65 kWh has been reported). Range = charge % × pack × efficiency.</p>
        <div class="row wrap">
          <span class="lbl">Home location</span>
          <span class="num">{draft.homeLocation ? `${draft.homeLocation.lat.toFixed(5)}, ${draft.homeLocation.lon.toFixed(5)}` : 'not set'}</span>
          <button class="btn sm" type="button" disabled={!gps} title={gps ? '' : 'No GPS fix on the truck'} onClick={() => gps && set('homeLocation', { lat: gps.lat, lon: gps.lon })}>Use truck's position</button>
          {draft.homeLocation && <button class="btn sm" type="button" onClick={() => set('homeLocation', null)}>Clear</button>}
        </div>
        <p class="help">Charging within 150 m of home is priced from your home rate below.</p>
      </Section>

      <Section title="Relay names" help="The six upfit relays in the truck box.">
        <div class="fields form">
          {RELAYS.map((id, i) => <label class="f"><span>Relay {i + 1}</span><input type="text" value={draft.relays[id]} onInput={(e) => set('relays', { ...draft.relays, [id]: (e.target as HTMLInputElement).value })} /></label>)}
        </div>
      </Section>

      <DriveSection settings={settings} />
      </div>

      <div data-tab="connections" hidden={tab !== 'connections'}>
      <Section id="network" title="Getting online" help="The cockpit has no modem: it joins home Wi-Fi in the driveway, else the active driver's phone hotspot (set per driver in Drivers), else another driver's, else Bluetooth tethering. The truck's own Wi-Fi (slate-truck) is separate and stays on for the truck box.">
        <div class="fields form">
          <label class="f"><span>Home Wi-Fi name (SSID)</span><input type="text" value={draft.homeWifi?.ssid ?? ''} placeholder="not set" onInput={(e) => { const v = (e.target as HTMLInputElement).value; set('homeWifi', v ? { ssid: v } : null); }} /></label>
          <SecretField label="Home Wi-Fi password" set={settings.homeWifi?.password} value={keys.homeWifi} onInput={(v) => setKeys({ ...keys, homeWifi: v })} onClear={() => void clear({ homeWifi: settings.homeWifi ? { ssid: settings.homeWifi.ssid, password: '' } : null })} />
        </div>
        <label class="check"><input type="checkbox" checked={draft.saveDataOnHotspot} onChange={(e) => set('saveDataOnHotspot', (e.target as HTMLInputElement).checked)} /> Save data on a phone: pause radar animation and internet radio</label>
        <p class="help">Data used over each driver's phone is shown on the cockpit (tap the network label in the top strip).</p>
      </Section>

      <Section id="ha" title="Home Assistant" help="Two links. MQTT discovery gives HA a 'Slate Truck' device (charge level, range, location, speed, trip, current place, driver, charging cost). The URL and token let the brain read HA: phone presence for the driver suggestion, zones for stop names, phone history, and GasBuddy prices.">
        <label class="check"><input type="checkbox" checked={draft.homeAssistant.bridge} onChange={(e) => set('homeAssistant', { ...draft.homeAssistant, bridge: (e.target as HTMLInputElement).checked })} /> Publish to Home Assistant (MQTT)</label>
        <div class="fields form">
          <label class="f"><span>Home Assistant URL</span><input type="url" value={draft.homeAssistant.url ?? ''} placeholder="http://homeassistant.local:8123" onInput={(e) => set('homeAssistant', { ...draft.homeAssistant, url: (e.target as HTMLInputElement).value || null })} /></label>
          <SecretField label="Long-lived access token" set={settings.homeAssistant.token} value={keys.haToken} placeholder="HA profile → Security → Long-lived access tokens" onInput={(v) => setKeys({ ...keys, haToken: v })} onClear={() => void clear({ homeAssistant: { token: '' } })} />
        </div>
        <div class="row wrap">
          <button class="btn sm" type="button" disabled={!haReady} onClick={() => void testHa()}>Test connection</button>
          {haTest && <span class={haTest.reachable ? 'okmsg' : 'err'}>{haTest.reachable ? 'Home Assistant answered.' : haTest.message}</span>}
          {!haReady && <span class="dimtxt" style="font-size:14px">Enter both, then Save.</span>}
        </div>
        <label class="f"><span>Wall charger session-energy entity (optional)</span>
          <input type="text" value={draft.homeAssistant.homeChargerEnergyEntity ?? ''} placeholder="sensor.emporia_charger_session_energy" onInput={(e) => set('homeAssistant', { ...draft.homeAssistant, homeChargerEnergyEntity: (e.target as HTMLInputElement).value || undefined })} />
        </label>
        <p class="help">Read from HA's mqtt_statestream (base_topic: homeassistant) when the bridge is up; used for home session kWh instead of the charge-level estimate. The token is stored on the truck only and never shown again in full.</p>
      </Section>

      <Section id="import" title="Phone history" help="Real trips and stops before the truck arrives: replay a driver's phone locations from Home Assistant.">
        <ImportSection settings={settings} haReady={haReady} />
      </Section>

      <Section id="places" title="Places" help="Stops are named, first match wins: your saved places, then Home Assistant zones, then the places feed, then OpenStreetMap (© OpenStreetMap contributors), else 'Unnamed stop'.">
        <PlacesSection />
        <h3 class="sub">Places feed (optional)</h3>
        <div class="fields form">
          <label class="f"><span>Feed URL</span><input type="url" value={draft.placesFeed.url ?? ''} placeholder="https://… returns [{name, lat, lon, radiusM?}]" onInput={(e) => set('placesFeed', { url: (e.target as HTMLInputElement).value || null })} /></label>
          <SecretField label="Basic auth (user:password)" set={settings.keys.placesFeed} value={keys.placesFeed} onInput={(v) => setKeys({ ...keys, placesFeed: v })} onClear={() => void clear({ keys: { placesFeed: '' } })} />
        </div>
      </Section>

      </div>

      <div data-tab="media" hidden={tab !== 'media'}>
      <div id="media" />
      <TrackBSections settings={settings} />
      </div>

      <div data-tab="cameras" hidden={tab !== 'cameras'}>
      <RemoteSection />
      </div>

      <div data-tab="system" hidden={tab !== 'system'}>
      <OpsSections />
      </div>

      {DRAFT_TABS.includes(tab) && <div class="savebar">
        <button class="btn big primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save truck settings'}</button>
        <button class="btn big" type="button" onClick={() => { setDraft(toDraft(settings)); setKeys(NO_SECRETS); setMsg(null); }}>Undo changes</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>}
    </div>
  );
}
