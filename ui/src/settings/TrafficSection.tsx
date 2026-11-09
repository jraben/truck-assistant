// Settings portal: a 511 developer key per state, for the Traffic screen.
import { useState } from 'preact/hooks';
import { api, settingsStore, type Settings } from '../lib/brain.ts';
import { keyUrl, STATES_511 } from '../../../brain/src/traffic/states.ts';

type Msg = { ok: boolean; text: string } | null;

export function TrafficSection({ settings }: { settings: Settings }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const have = settings.keys.traffic511 ?? {};
  const put = async (traffic511: Record<string, string>) => {
    try {
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ keys: { traffic511 } }) });
      settingsStore.set(n); setKeys({}); setMsg({ ok: true, text: 'Saved.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const [firms, setFirms] = useState('');
  const [fa, setFa] = useState('');
  const saveFa = async (v: string) => { try { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ keys: { flightAware: v } }) }); settingsStore.set(n); setFa(''); setMsg({ ok: true, text: v ? 'Saved.' : 'Removed.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const saveFirms = async (v: string) => { try { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ keys: { firms: v } }) }); settingsStore.set(n); setFirms(''); setMsg({ ok: true, text: v ? 'Saved.' : 'Removed.' }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const typed = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  return (
    <section class="card" id="traffic">
      <h2>Traffic cameras and incidents (511)</h2>
      <p class="help">The Traffic screen shows state 511 cameras and crashes, closures and roadwork ahead, fetched by the truck itself wherever it has a signal. Each state needs its own free developer key: make an account on the state's 511 site, log in, and request a key on its developer page. Add the states you drive in; a state without a key is simply skipped. Speed and red-light camera locations come from OpenStreetMap and need no key.</p>
      <div class="fields form">
        {STATES_511.map((s) => (
          <div class="form" style="gap:6px">
            <label class="f"><span>{s.name}{s.checked ? '' : ' (API not yet checked)'}</span>
              <input type="password" autocomplete="off" value={keys[s.id] ?? ''} placeholder={have[s.id] ? `set (${have[s.id]}); type to replace` : 'not set'} onInput={(e) => setKeys({ ...keys, [s.id]: (e.target as HTMLInputElement).value })} />
            </label>
            <div class="row wrap" style="gap:8px">
              <a class="btn sm" href={keyUrl(s)} target="_blank" rel="noreferrer">Get a key</a>
              {have[s.id] && <button class="btn sm danger" type="button" onClick={() => void put({ [s.id]: '' })}>Remove</button>}
            </div>
          </div>
        ))}
      </div>
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!Object.keys(typed).length} onClick={() => void put(typed)}>Save 511 keys</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      <h3 class="sub">Fires near the route (NASA FIRMS)</h3>
      <p class="help">Satellite fire hotspots near your trip's route (or around you). Free key: firms.modaps.eosdis.nasa.gov/api/map_key. Weather warnings and the forecast need no key.</p>
      <div class="fields form">
        <label class="f"><span>FIRMS MAP_KEY</span><input type="password" autocomplete="off" value={firms} placeholder={settings.keys.firms ? `set (${settings.keys.firms}); type to replace` : 'not set'} onInput={(e) => setFirms((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap">
        <button class="btn" type="button" disabled={!firms.trim()} onClick={() => void saveFirms(firms.trim())}>Save FIRMS key</button>
        {settings.keys.firms && <button class="btn sm danger" type="button" onClick={() => void saveFirms('')}>Remove</button>}
      </div>
      <h3 class="sub">Airport pickup: gate, bags and delays (FlightAware, optional)</h3>
      <p class="help">Airport pickup follows the plane for free (ADS-B). The gate, the baggage carousel, delays and cancellations only come from the airline's data: paste a FlightAware AeroAPI key to add them. It's paid per lookup; the truck asks once when a pickup starts and every 5 minutes after, only while one is on. Without a key nothing is asked.</p>
      <div class="fields form">
        <label class="f"><span>AeroAPI key</span><input type="password" autocomplete="off" value={fa} placeholder={settings.keys.flightAware ? `set (${settings.keys.flightAware}); type to replace` : 'not set'} onInput={(e) => setFa((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap">
        <button class="btn" type="button" disabled={!fa.trim()} onClick={() => void saveFa(fa.trim())}>Save AeroAPI key</button>
        {settings.keys.flightAware && <button class="btn sm danger" type="button" onClick={() => void saveFa('')}>Remove</button>}
      </div>
    </section>
  );
}
