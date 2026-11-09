// Settings portal: address books, synced (Outlook, Google, iCloud/CardDAV).
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { ContactsStatus } from '../../../brain/src/contacts/types.ts';

type Status = ContactsStatus & { googleRedirect: string };
type Msg = { ok: boolean; text: string } | null;

export function ContactsSection() {
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [msId, setMsId] = useState('');
  const [gId, setGId] = useState('');
  const [gSecret, setGSecret] = useState('');
  const [gUrl, setGUrl] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [dav, setDav] = useState({ label: 'iCloud', url: 'https://contacts.icloud.com', username: '', password: '' });
  const load = async () => { try { const s = await api<Status>('/api/contacts/status'); setSt(s); setMsId(s.outlookClientId ?? ''); setGId(s.googleClientId ?? ''); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  useEffect(() => { void load(); }, []);
  // While a Microsoft code is waiting, check back for the result.
  useEffect(() => { if (!st?.outlookPending) return; const id = setInterval(() => void load(), 4000); return () => clearInterval(id); }, [st?.outlookPending?.userCode]);
  const run = async (f: () => Promise<unknown>, ok: string) => { setMsg(null); try { await f(); setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  const post = (p: string, body: unknown = {}) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!st) return <section class="card" id="contacts"><h2>Contacts</h2><p class="help">Loading…</p></section>;
  return (
    <section class="card" id="contacts">
      <h2>Contacts (address books)</h2>
      <p class="help">Your address books, synced every 30 minutes, so a changed address or number changes here too. Contacts with an address become places you can drive to or stop at on a trip; the ones with numbers get call buttons. {st.total ? `${st.total} contacts, ${st.located} on the map.` : ''}</p>

      {st.sources.length > 0 && (
        <div class="list">
          {st.sources.map((s) => (
            <div class="item row between">
              <div><b>{s.label}</b>{s.account ? ` · ${s.account}` : ''}<div class="dimtxt" style="font-size:13px">{s.contacts} contacts{s.lastSync ? ` · synced ${new Date(s.lastSync).toLocaleString()}` : ''}{s.error ? '' : ''}</div>{s.error && <div class="err" style="font-size:13px">{s.error}</div>}</div>
              {s.kind !== 'demo' && <button class="btn sm danger" type="button" onClick={() => void run(() => api(`/api/contacts/source/${encodeURIComponent(s.id)}`, { method: 'DELETE' }), 'Disconnected.')}>Disconnect</button>}
            </div>
          ))}
        </div>
      )}

      <h3 class="sub">Outlook / Microsoft 365</h3>
      <p class="help">One-time setup: register a free app at entra.microsoft.com (App registrations → New; "Accounts in any organizational directory and personal Microsoft accounts"; Authentication → allow public client flows; API permissions → Microsoft Graph → Contacts.Read). Paste its Application (client) id, then Connect: you'll get a code to enter at microsoft.com/devicelogin on any device.</p>
      <div class="fields form">
        <label class="f"><span>Application (client) id</span><input type="text" value={msId} placeholder="00000000-0000-0000-0000-000000000000" onInput={(e) => setMsId((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap">
        <button class="btn" type="button" onClick={() => void run(() => api('/api/contacts/settings', { method: 'PUT', body: JSON.stringify({ outlookClientId: msId.trim() || null }) }), 'Saved.')}>Save id</button>
        <button class="btn primary" type="button" disabled={!st.outlookClientId} onClick={() => void run(() => post('/api/contacts/outlook/start'), 'Enter the code below.')}>Connect Outlook</button>
      </div>
      {st.outlookPending && <div class="banner ok">Go to <b>{st.outlookPending.verificationUri}</b> and enter <b class="num" style="font-size:22px;letter-spacing:.1em">{st.outlookPending.userCode}</b>. This page updates when you're done.</div>}

      <h3 class="sub">Google</h3>
      <p class="help">One-time setup: at console.cloud.google.com create a project, enable the People API, then Credentials → OAuth client id → type "Desktop app". Paste its client id and secret, press Connect, and sign in. If the browser then shows an error page, copy the whole address from its address bar and paste it below.</p>
      <div class="fields form">
        <label class="f"><span>Client id</span><input type="text" value={gId} onInput={(e) => setGId((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Client secret</span><input type="password" value={gSecret} placeholder={st.googleSecretSet ? 'set; type to replace' : 'not set'} onInput={(e) => setGSecret((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="row wrap">
        <button class="btn" type="button" onClick={() => void run(() => api('/api/contacts/settings', { method: 'PUT', body: JSON.stringify({ googleClientId: gId.trim() || null, ...(gSecret ? { googleSecret: gSecret } : {}) }) }).then(() => setGSecret('')), 'Saved.')}>Save</button>
        <button class="btn primary" type="button" disabled={!st.googleClientId || !st.googleSecretSet} onClick={() => void run(async () => { const r = await post('/api/contacts/google/start') as { url: string }; setGUrl(r.url); window.open(r.url, '_blank'); }, 'Sign in to Google in the new tab.')}>Connect Google</button>
      </div>
      {gUrl && (
        <div class="fields form">
          <label class="f"><span>Address Google sent you to</span><input type="url" value={paste} placeholder={`${st.googleRedirect}?code=…`} onInput={(e) => setPaste((e.target as HTMLInputElement).value)} /></label>
          <button class="btn primary" type="button" disabled={!paste.trim()} onClick={() => void run(() => post('/api/contacts/google/finish', { url: paste }).then(() => { setGUrl(null); setPaste(''); }), 'Google contacts connected.')}>Finish</button>
        </div>
      )}

      <h3 class="sub">iCloud, Fastmail, Nextcloud… (CardDAV)</h3>
      <p class="help">iCloud: your Apple ID and an app-specific password from account.apple.com (Sign-In and Security → App-Specific Passwords), never your Apple ID password.</p>
      <div class="fields form">
        <label class="f"><span>Name</span><input type="text" value={dav.label} onInput={(e) => setDav({ ...dav, label: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>Server</span><input type="url" value={dav.url} onInput={(e) => setDav({ ...dav, url: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>Username</span><input type="text" autocomplete="off" value={dav.username} onInput={(e) => setDav({ ...dav, username: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>App-specific password</span><input type="password" autocomplete="off" value={dav.password} onInput={(e) => setDav({ ...dav, password: (e.target as HTMLInputElement).value })} /></label>
      </div>
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!dav.username || !dav.password} onClick={() => void run(() => post('/api/contacts/carddav', dav).then(() => setDav({ ...dav, password: '' })), 'Connected and synced.')}>Connect</button>
        <button class="btn" type="button" disabled={!st.sources.length} onClick={() => void run(() => post('/api/contacts/sync'), 'Synced.')}>Sync now</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
    </section>
  );
}
