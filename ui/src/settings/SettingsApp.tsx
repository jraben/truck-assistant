// The settings portal at /settings. Phone-first; also reachable from the cockpit rail.
import { useEffect, useState } from 'preact/hooks';
import type { TouPeriod } from '../../../brain/src/types.ts';
import { api, settingsStore, stateStore, useStore, type Health, type Settings } from '../lib/brain.ts';
import { allThemes, paintTheme, pickTheme } from '../lib/theme.ts';
import { ChargeForm, CostSessions, CostSummary } from '../components/costs.tsx';
import { ThemeEditor } from './ThemeEditor.tsx';

const RELAYS = ['relay_1', 'relay_2', 'relay_3', 'relay_4', 'relay_5', 'relay_6'];
const AMENITIES = ['restroom', 'food', 'coffee', 'shade'];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Draft = Omit<Settings, 'theme' | 'layout' | 'keys'> & { networksText: string; avoidText: string };

const toDraft = (s: Settings): Draft => {
  const { theme: _t, layout: _l, keys: _k, ...rest } = structuredClone(s);
  return { ...rest, networksText: s.charging.networks.join(', '), avoidText: s.charging.avoidNetworks.join(', ') };
};
const list = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);

function Section({ id, title, help, children }: { id?: string; title: string; help?: string; children: preact.ComponentChildren }) {
  return <section class="card" id={id}><h2>{title}</h2>{help && <p class="help">{help}</p>}{children}</section>;
}

export function SettingsApp() {
  const settings = useStore(settingsStore);
  const state = useStore(stateStore);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [keys, setKeys] = useState({ afdc: '', openChargeMap: '' });
  const [layoutText, setLayoutText] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => { if (settings && !draft) { setDraft(toDraft(settings)); setLayoutText(JSON.stringify(settings.layout, null, 2)); } }, [settings]);
  useEffect(() => { if (settings) paintTheme(pickTheme(settings.theme, state?.gps?.fix ? state.gps : null)); }, [settings, state?.gps?.fix]);
  useEffect(() => { const f = () => api<Health>('/api/health').then(setHealth).catch(() => setHealth(null)); void f(); const id = setInterval(f, 10_000); return () => clearInterval(id); }, []);

  if (!settings || !draft) return <div class="portal-wrap"><p>Loading settings from the brain…</p></div>;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const setCh = <K extends keyof Draft['charging']>(k: K, v: Draft['charging'][K]) => setDraft({ ...draft, charging: { ...draft.charging, [k]: v } });
  const setRate = <K extends keyof Draft['homeRate']>(k: K, v: Draft['homeRate'][K]) => setDraft({ ...draft, homeRate: { ...draft.homeRate, [k]: v } });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const setTou = (i: number, p: Partial<TouPeriod>) => setRate('tou', draft.homeRate.tou.map((t, j) => (j === i ? { ...t, ...p } : t)));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { networksText, avoidText, ...rest } = draft;
      const body: Record<string, unknown> = { ...rest, charging: { ...rest.charging, networks: list(networksText), avoidNetworks: list(avoidText) } };
      const k: Record<string, string> = {};
      if (keys.afdc.trim()) k.afdc = keys.afdc.trim();
      if (keys.openChargeMap.trim()) k.openChargeMap = keys.openChargeMap.trim();
      if (Object.keys(k).length) body.keys = k;
      if (layoutText.trim() !== JSON.stringify(settings.layout, null, 2)) {
        try { body.layout = JSON.parse(layoutText); } catch (e) { throw new Error(`Layout is not valid JSON: ${(e as Error).message}`); }
      }
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      settingsStore.set(n); setDraft(toDraft(n)); setKeys({ afdc: '', openChargeMap: '' }); setLayoutText(JSON.stringify(n.layout, null, 2));
      setMsg({ ok: true, text: 'Saved. The cockpit picks it up within a few seconds.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const clearKey = async (k: 'afdc' | 'openChargeMap') => {
    try { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ keys: { [k]: '' } }) }); settingsStore.set(n); setMsg({ ok: true, text: 'Key removed.' }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  const gps = state?.gps?.fix ? state.gps : null;

  return (
    <div class="portal-wrap portal">
      <div class="portal-head">
        <h1>SLATE · SETTINGS</h1>
        <span class="pill"><span class={`dot ${health ? 'ok' : 'bad'}`} />{health ? `brain v${health.version}` : 'brain unreachable'}</span>
        {health && <span class="pill"><span class={`dot ${health.mqtt === 'connected' ? 'ok' : 'warn'}`} />MQTT {health.mqtt}</span>}
        {health && <span class="pill"><span class={`dot ${health.gps === 'fix' || health.gps === 'sim' ? 'ok' : 'warn'}`} />GPS {health.gps}</span>}
        <span style="flex:1" />
        <a class="btn" href="/">Back to cockpit</a>
      </div>

      <Section id="charge" title="Log a charge" help="Just unplugged at a public charger? Enter what you paid. Home charges are logged and priced by themselves.">
        {logOpen ? <ChargeForm session={null} onDone={() => setLogOpen(false)} /> : <button class="btn big primary" type="button" onClick={() => setLogOpen(true)}>+ Log a charge</button>}
        <CostSummary s={state} go={() => {}} />
        <CostSessions s={state} go={() => {}} />
      </Section>

      <Section title="Truck">
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

      <Section title="Charging preferences" help="How the charger finder ranks stations.">
        <div class="form">
          <label class="f"><span>Preferred networks, best first (comma separated)</span><input type="text" value={draft.networksText} onInput={(e) => set('networksText', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Avoid networks</span><input type="text" value={draft.avoidText} onInput={(e) => set('avoidText', (e.target as HTMLInputElement).value)} /></label>
          <div class="fields">
            <label class="f"><span>Min kW</span><input type="number" value={draft.charging.minKw} onInput={(e) => setCh('minKw', num((e.target as HTMLInputElement).value))} /></label>
            <label class="f"><span>Connector</span><select value={draft.charging.connector} onChange={(e) => setCh('connector', (e.target as HTMLSelectElement).value as Draft['charging']['connector'])}>{['NACS', 'CCS', 'J1772', 'any'].map((c) => <option value={c}>{c}</option>)}</select></label>
            <label class="f"><span>Max detour mi</span><input type="number" value={draft.charging.maxDetourMi} onInput={(e) => setCh('maxDetourMi', num((e.target as HTMLInputElement).value))} /></label>
            <label class="f"><span>Arrive with at least %</span><input type="number" value={draft.charging.arriveMinSoc} onInput={(e) => setCh('arriveMinSoc', num((e.target as HTMLInputElement).value))} /></label>
          </div>
          <div class="row wrap">
            {AMENITIES.map((a) => (
              <label class="check"><input type="checkbox" checked={draft.charging.wantAmenities.includes(a)} onChange={(e) => setCh('wantAmenities', (e.target as HTMLInputElement).checked ? [...draft.charging.wantAmenities, a] : draft.charging.wantAmenities.filter((x) => x !== a))} />{a}</label>
            ))}
          </div>
        </div>
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
          <div class="fields">
            <label class="f"><span>Gas truck mpg (comparison)</span><input type="number" step="0.5" value={draft.compareMpg} onInput={(e) => set('compareMpg', num((e.target as HTMLInputElement).value))} /></label>
            <label class="f"><span>Gas $/gal</span><input type="number" step="0.01" value={draft.gasPrice} onInput={(e) => set('gasPrice', num((e.target as HTMLInputElement).value))} /></label>
          </div>
        </div>
      </Section>

      <Section title="Charger API keys" help="Free keys: developer.nrel.gov/signup (AFDC) and openchargemap.org (My Profile → API keys). Stored on the truck only, never shown again in full.">
        <div class="fields form">
          {(['afdc', 'openChargeMap'] as const).map((k) => (
            <div class="form" style="gap:6px">
              <label class="f"><span>{k === 'afdc' ? 'NREL AFDC key' : 'Open Charge Map key'}</span>
                <input type="password" autocomplete="off" value={keys[k]} placeholder={settings.keys[k] ? `set (${settings.keys[k]}); type to replace` : 'not set'} onInput={(e) => setKeys({ ...keys, [k]: (e.target as HTMLInputElement).value })} />
              </label>
              {settings.keys[k] && <button class="btn sm danger" type="button" onClick={() => void clearKey(k)}>Remove key</button>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Home Assistant" help="The brain publishes MQTT discovery, so HA gets a 'Slate Truck' device: charge level, range, location, speed, trip distance and charging cost.">
        <label class="check"><input type="checkbox" checked={draft.homeAssistant.bridge} onChange={(e) => set('homeAssistant', { ...draft.homeAssistant, bridge: (e.target as HTMLInputElement).checked })} /> Publish to Home Assistant</label>
        <label class="f"><span>Wall charger session-energy entity (optional)</span>
          <input type="text" value={draft.homeAssistant.homeChargerEnergyEntity ?? ''} placeholder="sensor.emporia_charger_session_energy" onInput={(e) => set('homeAssistant', { ...draft.homeAssistant, homeChargerEnergyEntity: (e.target as HTMLInputElement).value || undefined })} />
        </label>
        <p class="help">Read from HA's mqtt_statestream (base_topic: homeassistant) when the bridge is up; used for home session kWh instead of the charge-level estimate.</p>
      </Section>

      <Section id="themes" title="Themes" help="Pick, duplicate and tune a theme. Auto switches between a day and a night theme at sunrise and sunset where the truck is.">
        <div class="row wrap">
          <label class="check"><input type="checkbox" checked={settings.theme.auto.enabled} onChange={async (e) => { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: { auto: { ...settings.theme.auto, enabled: (e.target as HTMLInputElement).checked } } }) }); settingsStore.set(n); }} /> Auto day/night</label>
          {(['day', 'night'] as const).map((k) => (
            <label class="f"><span>{k} theme</span>
              <select value={settings.theme.auto[k]} onChange={async (e) => { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: { auto: { ...settings.theme.auto, [k]: (e.target as HTMLSelectElement).value } } }) }); settingsStore.set(n); }}>
                {allThemes(settings.theme).map((t) => <option value={t.id}>{t.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <ThemeEditor settings={settings} />
      </Section>

      <Section title="Layout (advanced)" help="Per view, a grid of widgets on the 1920×720 bar: col/row start at 1, w/h are spans. Widget types: speed, soc, nextCharger, trip, cabin, aux12v, tilt, carplay, liveStrip, relays, fiveSwitch, tpms, chargers, socSlider, costSummary, costSessions, trips, cam.">
        <textarea value={layoutText} onInput={(e) => setLayoutText((e.target as HTMLTextAreaElement).value)} spellcheck={false} style="min-height:240px" />
        <div><button class="btn sm" type="button" onClick={async () => { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ layout: null }) }); settingsStore.set(n); setLayoutText(JSON.stringify(n.layout, null, 2)); }}>Reset to default</button></div>
      </Section>

      <Section title="Streaming services" help="Later phase. Spotify (librespot), Plex and Audiobookshelf link here; Apple Music, YouTube Music and Pandora stay CarPlay-only.">
        <div class="dimtxt">Nothing to set yet.</div>
      </Section>

      <div class="savebar">
        <button class="btn big primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</button>
        <button class="btn big" type="button" onClick={() => { setDraft(toDraft(settings)); setKeys({ afdc: '', openChargeMap: '' }); setMsg(null); }}>Undo changes</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
    </div>
  );
}

