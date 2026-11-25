// Settings › Family cars: the Traccar server the family's trackers report to. A read-only
// Traccar user is enough (TA only reads). The password is never shown again in full.
import { useState } from 'preact/hooks';
import { api, settingsStore, type Settings } from '../lib/brain.ts';
import type { FamilyCarsReport } from '../../../brain/src/cars/familyCars.ts';

export function FamilyCarsSection({ settings }: { settings: Settings }) {
  const fc = settings.familyCars ?? { url: null, user: null };
  const [url, setUrl] = useState(fc.url ?? '');
  const [user, setUser] = useState(fc.user ?? '');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try {
      const body: Record<string, unknown> = { url: url.trim() || null, user: user.trim() || null };
      if (pw) body.password = pw;
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ familyCars: body }) });
      settingsStore.set(n); setPw('');
      const r = await api<FamilyCarsReport>('/api/cars?refresh=1');
      setMsg(!r.configured ? { ok: false, text: 'Saved. Add the address, user and password to connect.' }
        : r.error ? { ok: false, text: `Saved, but: ${r.error}` }
        : { ok: true, text: `Connected: ${r.cars.length} ${r.cars.length === 1 ? 'car' : 'cars'} found.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const forget = async () => {
    try { const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ familyCars: { url: null, user: null, password: '' } }) }); settingsStore.set(n); setUrl(''); setUser(''); setPw(''); setMsg({ ok: true, text: 'Disconnected.' }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <section class="card" id="family-cars" data-keywords="family cars traccar tracker obd fault codes tucson rogue f150 corvette jeep">
      <h2>Family cars</h2>
      <p class="help">The Traccar server the family's trackers report to (the Family screen reads it). Use its web address on the home network, e.g. <code>http://192.168.1.219:3952</code>, and a <b>read-only</b> Traccar user: TA never changes anything there. Keep that address off the internet.</p>
      <div class="row wrap" style="gap:var(--s15)">
        <label class="f" style="min-width:260px"><span>Traccar address</span><input type="url" value={url} placeholder="http://192.168.1.219:3952" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>User</span><input type="text" autocomplete="off" value={user} onInput={(e) => setUser((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Password</span><input type="password" autocomplete="new-password" value={pw} placeholder={fc.password ? `saved (${fc.password})` : ''} onInput={(e) => setPw((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row" style="gap:var(--s1)">
        <button type="button" class="btn primary" onClick={() => void save()}>Save and test</button>
        {fc.url && <button type="button" class="btn" onClick={() => void forget()}>Disconnect</button>}
      </div>
      {msg && <p class={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
    </section>
  );
}
