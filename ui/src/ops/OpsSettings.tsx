// Settings sections for Track D: updates, backups, security, about; and the
// cockpit's Logs panel (mileage + maintenance + about).
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, toast } from '../lib/brain.ts';
import { PROJECT } from '../../../brain/src/project.ts';
import { errText, post, put, upload, type AuthStatus, type BackupStatus, type BackupTarget, type OpsConfig, type UpdateStatus } from './api.ts';
import { MaintenanceView } from './Maintenance.tsx';
import { MileageSettings, MileageView } from './Mileage.tsx';
import { SetupWizard } from './Wizard.tsx';
import './ops.css';

function Section({ id, title, help, children }: { id?: string; title: string; help?: string; children: ComponentChildren }) {
  return <section class="card" id={id}><h2>{title}</h2>{help && <p class="help">{help}</p>}{children}</section>;
}
const val = (e: Event) => (e.target as HTMLInputElement).value;
const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

// ---- updates -------------------------------------------------------------------

const BUSY = ['requested', 'downloading', 'building', 'restarting', 'verifying', 'checking'];
export function UpdatesSection() {
  const [s, setS] = useState<UpdateStatus | null>(null);
  const [repo, setRepo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { const n = await api<UpdateStatus>('/api/update'); setS(n); return n; } catch (e) { setErr(errText(e)); return null; } };
  useEffect(() => { void load().then((n) => n && setRepo(n.repo ?? '')); }, []);
  useEffect(() => { if (!s || !BUSY.includes(s.phase)) return; const id = setInterval(() => void load(), 3000); return () => clearInterval(id); }, [s?.phase]);
  if (!s) return <Section id="updates" title="Software updates"><div class={err ? 'err' : 'dimtxt'}>{err ?? 'Loading…'}</div></Section>;
  const act = async (f: () => Promise<UpdateStatus>) => { setErr(null); try { setS(await f()); } catch (e) { setErr(errText(e)); } };
  const inst = s.installed;
  return (
    <Section id="updates" title="Software updates" help="Checks GitHub for new releases. Installing builds the new version beside the running one, restarts, checks /api/health, and goes back by itself if the new one doesn't come up. The previous version is kept for a one-tap rollback.">
      <div class="fields form">
        <label class="f"><span>GitHub repository</span><input type="url" value={repo} placeholder="https://github.com/owner/slate-cockpit" onInput={(e) => setRepo(val(e))} /></label>
        <label class="f"><span>Channel</span><select value={s.channel} onChange={(e) => void act(() => put('/api/update/config', { channel: (e.target as HTMLSelectElement).value }))}><option value="stable">Stable (release tags)</option><option value="main">main (latest commit)</option></select></label>
      </div>
      <div class="row wrap">
        <button class="btn sm" type="button" disabled={repo === (s.repo ?? '')} onClick={() => void act(() => put('/api/update/config', { repo: repo || null }))}>Save repository</button>
        <button class="btn" type="button" disabled={!s.repo || BUSY.includes(s.phase)} onClick={() => void act(() => post('/api/update/check'))}>Check for updates</button>
        <button class="btn danger" type="button" disabled={!s.canRollback} onClick={() => { if (confirm('Go back to the previous version?')) void act(() => post('/api/update/rollback')); }}>Roll back</button>
      </div>
      <div class="kv"><span>Installed</span><span>{inst.tag ?? `v${inst.version}`}{inst.sha ? ` (${inst.sha.slice(0, 7)})` : ''}</span><span>Status</span><span>{s.phase}{s.message ? `: ${s.message}` : ''}</span><span>Last checked</span><span>{ago(s.checkedAt)}</span></div>
      {s.installNote && <p class="help">{s.installNote}</p>}
      {err && <div class="err">{err}</div>}
      {s.releases.slice(0, 5).map((r, i) => (
        <div class="item">
          <div class="row between wrap"><b>{r.name}{i === 0 ? ' · latest' : ''}</b><span class="dimtxt">{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''}</span>
            <button class="btn sm primary" type="button" disabled={!s.canInstall} onClick={() => { if (confirm(`Install ${r.tag}? The cockpit restarts (about a minute; longer if it has to build).`)) void act(() => post('/api/update/install', { tag: r.tag })); }}>Install</button></div>
          {r.notes && <pre class="notes">{r.notes}</pre>}
        </div>
      ))}
    </Section>
  );
}

// ---- backups -------------------------------------------------------------------

type BackupResp = { config: OpsConfig['backup']; status: BackupStatus; targetLabel: string; local: { name: string; size: number; at: string }[] };
type ListResp = { local: { name: string; size: number }[]; target: { names: string[] | null; error: string | null } };

export function BackupsSection() {
  const [b, setB] = useState<BackupResp | null>(null);
  const [draft, setDraft] = useState<OpsConfig['backup'] | null>(null);
  const [list, setList] = useState<ListResp | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { const n = await api<BackupResp>('/api/backup'); setB(n); setDraft(structuredClone(n.config)); };
  useEffect(() => { void load().catch((e) => setMsg({ ok: false, text: errText(e) })); }, []);
  if (!b || !draft) return <Section id="backups" title="Backups"><div class="dimtxt">Loading…</div></Section>;
  const t = draft.target;
  const setT = (n: BackupTarget) => setDraft({ ...draft, target: n });
  const go = async (f: () => Promise<unknown>, ok: string) => { setBusy(true); setMsg(null); try { await f(); setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); } };
  const restore = (name: string, from: 'local' | 'target') => { if (confirm(`Restore ${name}? Today's trips, logs and settings are replaced by the backup's (the current data is kept aside on the truck). The brain restarts.`)) void go(async () => { const r = await post<{ message: string }>('/api/backup/restore', { name, from }); toast(r.message); }, 'Restore staged.'); };
  const st = b.status;
  return (
    <Section id="backups" title="Backups" help="Nightly, when the truck is parked on home Wi-Fi: the trip database (a consistent copy), settings, the clips index (not the videos) and maintenance receipts, in one .tar.gz. A few copies also stay on the truck.">
      <div class="banner" style={st.lastOk === false ? '' : 'border-color:var(--line);color:var(--fg);background:none'}>Last backup: {st.lastSuccessAt ? `${ago(st.lastSuccessAt)} to ${st.sentTo}` : 'never'}{st.lastOk === false ? ` · last try failed: ${st.lastError}` : ''}</div>
      <label class="check"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: (e.target as HTMLInputElement).checked })} /> Back up every night</label>
      <div class="fields form">
        <label class="f"><span>After (hour, 0-23)</span><input type="number" min={0} max={23} value={draft.hour} onInput={(e) => setDraft({ ...draft, hour: Number(val(e)) })} /></label>
        <label class="f"><span>Keep on the target</span><input type="number" min={1} value={draft.keep} onInput={(e) => setDraft({ ...draft, keep: Number(val(e)) })} /></label>
        <label class="f"><span>Keep on the truck</span><input type="number" min={1} value={draft.keepLocal} onInput={(e) => setDraft({ ...draft, keepLocal: Number(val(e)) })} /></label>
        <label class="f"><span>Send to</span><select value={t.kind} onChange={(e) => { const k = (e.target as HTMLSelectElement).value; setT(k === 'path' ? { kind: 'path', path: '/mnt/nas-backup' } : k === 'rsync' ? { kind: 'rsync', dest: '', sshKey: '/var/lib/slate-cockpit/.ssh/id_ed25519', port: 22 } : k === 'http' ? { kind: 'http', url: '', auth: null } : { kind: 'none' }); }}>
          <option value="none">Only this truck</option><option value="path">NAS share (mounted folder)</option><option value="rsync">rsync over SSH</option><option value="http">HTTP upload</option></select></label>
      </div>
      {t.kind === 'path' && <><label class="f"><span>Folder (the SMB share mounted on the Pi)</span><input type="text" value={t.path} onInput={(e) => setT({ ...t, path: val(e) })} /></label><p class="help">Mount the NAS share with deploy/pi/backup/mount-nas.sh (an /etc/fstab line with nofail, credentials in a root-only file).</p></>}
      {t.kind === 'rsync' && <div class="fields form">
        <label class="f"><span>Destination</span><input type="text" value={t.dest} placeholder="backup@nas.local:/volume1/backups/slate" onInput={(e) => setT({ ...t, dest: val(e) })} /></label>
        <label class="f"><span>SSH key on the Pi</span><input type="text" value={t.sshKey ?? ''} onInput={(e) => setT({ ...t, sshKey: val(e) || null })} /></label>
        <label class="f"><span>Port</span><input type="number" value={t.port} onInput={(e) => setT({ ...t, port: Number(val(e)) })} /></label></div>}
      {t.kind === 'http' && <div class="fields form">
        <label class="f"><span>Upload URL (each file is PUT under it)</span><input type="url" value={t.url} onInput={(e) => setT({ ...t, url: val(e) })} /></label>
        <label class="f"><span>Basic auth user:password</span><input type="password" autocomplete="off" value={t.auth ?? ''} onInput={(e) => setT({ ...t, auth: val(e) || null })} /></label></div>}
      <label class="check"><input type="checkbox" checked={draft.includeSecrets} onChange={(e) => setDraft({ ...draft, includeSecrets: (e.target as HTMLInputElement).checked })} /> Include keys, tokens and Wi-Fi passwords</label>
      {draft.includeSecrets && <p class="help" style="color:var(--warn)">Then anyone who can read the backup folder can use your HA token and API keys. Off by default; restoring without them keeps the truck's current ones.</p>}
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={busy} onClick={() => void go(() => put('/api/backup/config', draft), 'Saved.')}>Save</button>
        <button class="btn" type="button" disabled={busy || st.running} onClick={() => void go(async () => { const r = await post<BackupStatus>('/api/backup/run'); if (!r.lastOk) throw new Error(r.lastError ?? 'failed'); }, 'Backed up.')}>Back up now</button>
        <button class="btn" type="button" onClick={() => void api<ListResp>('/api/backup/list').then(setList).catch((e) => setMsg({ ok: false, text: errText(e) }))}>Show backups</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      {list && <div class="list">
        <span class="lbl">On the truck</span>
        {list.local.map((x) => <div class="item row" style="justify-content:space-between"><span class="num">{x.name} · {Math.round(x.size / 1024)} KB</span><span class="row"><a class="btn sm" href={`/api/backup/download/${x.name}`} download>Download</a><button class="btn sm danger" type="button" onClick={() => restore(x.name, 'local')}>Restore</button></span></div>)}
        {!list.local.length && <span class="dimtxt">None</span>}
        <span class="lbl">On {b.targetLabel}</span>
        {list.target.error && <span class="err">{list.target.error}</span>}
        {list.target.names === null && !list.target.error && <span class="dimtxt">This target can't list its files (HTTP); restore by uploading the file below.</span>}
        {list.target.names?.map((n) => <div class="item row" style="justify-content:space-between"><span class="num">{n}</span><button class="btn sm danger" type="button" onClick={() => restore(n, 'target')}>Restore</button></div>)}
        <label class="f"><span>Restore from a file</span><input type="file" accept=".gz,application/gzip" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f && confirm(`Restore ${f.name}? The brain restarts.`)) void go(async () => { const r = await upload<{ message: string }>('/api/backup/restore-upload', f, 'application/gzip'); toast(r.message); }, 'Restore staged.'); }} /></label>
      </div>}
    </Section>
  );
}

// ---- security -------------------------------------------------------------------

export function SecuritySection() {
  const [a, setA] = useState<AuthStatus | null>(null);
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api<AuthStatus>('/api/auth/status').then(setA).catch(() => {});
  useEffect(() => { void load(); }, []);
  if (!a) return null;
  const go = async (f: () => Promise<unknown>, ok: string) => { setMsg(null); try { await f(); setMsg({ ok: true, text: ok }); setCur(''); setPw(''); setPw2(''); void load(); } catch (e) { setMsg({ ok: false, text: errText(e) }); } };
  return (
    <Section id="security" title="Security" help="The password guards Settings and the Truck page from other devices (a phone on slate-truck Wi-Fi, Tailscale). The dash screen itself stays open. Threat model and the HA/Tailscale guidance: docs/security.md.">
      {!a.passwordSet && <div class="banner bad">No password set: anyone on the truck's Wi-Fi or your tailnet can change settings.</div>}
      <div class="fields form">
        {a.passwordSet && <label class="f"><span>Current password</span><input type="password" autocomplete="current-password" value={cur} onInput={(e) => setCur(val(e))} /></label>}
        <label class="f"><span>New password</span><input type="password" autocomplete="new-password" value={pw} onInput={(e) => setPw(val(e))} /></label>
        <label class="f"><span>Again</span><input type="password" autocomplete="new-password" value={pw2} onInput={(e) => setPw2(val(e))} /></label>
      </div>
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!pw || pw !== pw2} onClick={() => void go(() => post('/api/auth/password', { current: cur || undefined, next: pw }), 'Password saved; other devices must log in again.')}>{a.passwordSet ? 'Change password' : 'Set password'}</button>
        {a.passwordSet && <button class="btn" type="button" onClick={() => void go(() => post('/api/security/logout-everywhere'), 'Every device is logged out.')}>Log out everywhere</button>}
        {!a.local && a.passwordSet && <button class="btn" type="button" onClick={async () => { await post('/api/auth/logout'); location.href = '/login?next=/settings'; }}>Log out</button>}
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      <label class="check"><input type="checkbox" checked={a.trustLocal} onChange={(e) => void go(() => put('/api/security/config', { trustLocal: (e.target as HTMLInputElement).checked }), 'Saved.')} /> The dash screen (this Pi) needs no password</label>
      <p class="help">Forgot it? On the Pi: set "passwordHash" to null in /var/lib/slate-cockpit/ops.json and restart slate-brain, then set a new one.</p>
    </Section>
  );
}

// ---- about ---------------------------------------------------------------------

export function AboutPanel() {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { void api<{ version: string }>('/api/about').then((a) => setV(a.version)).catch(() => {}); }, []);
  return (
    <div class="about">
      <h3 style="margin:0;font-family:var(--display);font-size:24px">{PROJECT.name}{v ? ` v${v}` : ''}</h3>
      <p><b>{PROJECT.notice}</b></p>
      <p>{PROJECT.copyright}. Released under the {PROJECT.license} license: free to use, change and share, with no warranty.</p>
      <p class="dimtxt">Map data © OpenStreetMap contributors. CarPlay is a trademark of Apple Inc.; this project only talks to a Carlinkit dongle.</p>
    </div>
  );
}

/** Settings portal: every Track D section. */
export function OpsSections() {
  const [wiz, setWiz] = useState(false);
  return <>
    <Section id="mileage" title="Mileage log" help="Business, personal and commute miles, for taxes. Tag several trips at once; export a CSV or a printable log.">
      <MileageView />
      <details><summary class="btn sm" style="display:inline-flex">Mileage settings: odometer, IRS rate, rules</summary><MileageSettings /></details>
    </Section>
    <Section id="maintenance" title="Maintenance"><MaintenanceView /></Section>
    <Section id="setup" title="Setup" help="The first-boot steps: password, truck Wi-Fi, truck, home, drivers, Home Assistant, hotspots, comparison vehicle.">
      {wiz ? <SetupWizard portal onClose={() => setWiz(false)} /> : <div><button class="btn" type="button" onClick={() => setWiz(true)}>Open setup</button></div>}
    </Section>
    <UpdatesSection />
    <BackupsSection />
    <SecuritySection />
    <Section id="about" title="About"><AboutPanel /></Section>
  </>;
}

/** Cockpit: the Logs panel from the rail. */
export function LogsPanel({ onClose, initial = 'mileage' }: { onClose: () => void; initial?: 'mileage' | 'maintenance' | 'about' }) {
  const [tab, setTab] = useState(initial);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return (
    <div class="ops-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="ops-panel" role="dialog" aria-label="Logs">
        <div class="ops-tabs">
          {(['mileage', 'maintenance', 'about'] as const).map((t) => <button class="btn" type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'mileage' ? 'Mileage' : t === 'maintenance' ? 'Maintenance' : 'About'}</button>)}
          <span class="grow" /><button class="btn big" type="button" onClick={onClose}>Close</button>
        </div>
        <div class="body">{tab === 'mileage' ? <MileageView compact /> : tab === 'maintenance' ? <MaintenanceView /> : <AboutPanel />}</div>
      </div>
    </div>
  );
}
