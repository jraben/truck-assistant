// The small line at the bottom of the cockpit: which version is running and
// when it was installed (TA_v0.1.0+3d06fb9 · updated Nov 13, 2026, 3:03 PM),
// and an "Update available" chip. Tapping it says what's new, how big the
// download is, and whether to wait for home Wi-Fi; installing stays in
// Settings, Logs & system, Updates (which won't install while driving).
import { useEffect, useState } from 'preact/hooks';
import type { Release, UpdateStatus } from '../../../brain/src/ops/types.ts';
import { api, stateStore, toast, useStore } from '../lib/brain.ts';
import { ask } from './Ask.tsx';

const BUSY = ['requested', 'downloading', 'building', 'restarting', 'verifying'];
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** "TA_v0.1.0+3d06fb9": the package version, plus the commit it was built from. Pure. */
export function versionLabel(s: Pick<UpdateStatus, 'installed'>): string {
  const i = s.installed;
  const build = i.sha ? i.sha.slice(0, 7) : i.tag && !/^v?\d/.test(i.tag) ? i.tag.replace(/^main@/, '') : null;
  const v = i.tag && /^v?\d/.test(i.tag) ? i.tag.replace(/^v/, '') : i.version;
  return `TA_v${v}${build ? `+${build}` : ''}`;
}

/** How big, in words: exact for a release bundle; an estimate for a source build, larger when packages changed. Pure. */
export function downloadWords(r: Release): { size: string; big: boolean } {
  const d = r.download;
  const base = d?.bytes ? `${d.exact ? '' : 'about '}${mb(d.bytes)}` : 'about 5-10 MB of source';
  if (d?.packagesChanged) return { size: `${base}, plus new packages for the build (often 50-200 MB more: the package list changed)`, big: true };
  const note = d?.exact ? '' : d?.packagesChanged === false ? ' (packages unchanged)' : ', plus any new packages for the build';
  return { size: base + note, big: (d?.bytes ?? 0) > 25e6 };
}

/** Where to do it, from the truck's connection now. Pure. */
export function wifiAdvice(link: string | undefined, big: boolean): { text: string; ok: boolean } {
  if (link === 'home') return { text: 'The truck is on home Wi-Fi now: a good time to update.', ok: true };
  if (link === 'offline') return { text: 'The truck has no internet now. Update when it is on home Wi-Fi.', ok: false };
  if (big) return { text: "Better on home Wi-Fi: this is big for a phone's hotspot data.", ok: false };
  return { text: "Small enough for a phone's hotspot, but home Wi-Fi is better (it also builds for a few minutes, parked).", ok: true };
}

/** `inline`: placed in a page (the Settings header) instead of floating at the foot of the cockpit. */
export function VersionBar({ inline = false, quiet = false }: { inline?: boolean; quiet?: boolean } = {}) {
  const s = useStore(stateStore);
  const [u, setU] = useState<UpdateStatus | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const busy = !!u && BUSY.includes(u.phase);
  useEffect(() => {
    const load = () => void api<UpdateStatus>('/api/update').then(setU, () =>
      api<UpdateStatus['installed']>('/api/update/version').then((installed) => setU({ phase: 'idle', installed, latest: null } as unknown as UpdateStatus), () => {}));
    load();
    // Every minute normally (the brain checks GitHub itself); every 3 s while an update runs.
    const t = setInterval(load, busy ? 3000 : 60_000);
    return () => clearInterval(t);
  }, [busy]);
  // A new version came up under this page: reload to run its screens too.
  const sha = u?.installed.sha ?? null;
  useEffect(() => { if (!sha) return; if (first === null) setFirst(sha); else if (sha !== first) location.reload(); }, [sha]);
  if (!u) return null;
  const available = u.phase === 'available' && !!u.latest;
  const updated = when(u.installed.installedAt);
  // Tap "Update available": what it is, how big, where to do it, then install now.
  const update = async () => {
    if (!u.latest) return;
    if (s?.drive?.lockout.locked) { toast('Updates wait until the truck is parked'); return; }
    const d = downloadWords(u.latest);
    const w = wifiAdvice(s?.network?.link, d.big);
    const notes = u.latest.notes.split('\n').filter(Boolean).slice(0, 5).map((n) => '• ' + n.replace(/^[-*]\s*/, '')).join('\n');
    const ok = await ask(`Update to ${u.latest.tag}?\n\nDownload: ${d.size}. ${w.text}\n\nThe cockpit restarts on it, about a minute, and this page reloads.${notes ? `\n\nWhat's new:\n${notes}` : ''}`, { ok: 'Update now', danger: false });
    if (!ok) return;
    if (!u.canInstall) { toast(u.installNote ?? 'Updates can\'t be installed from here'); return; }
    try { setU(await api<UpdateStatus>('/api/update/install', { method: 'POST', body: JSON.stringify({ tag: u.latest.tag }) })); toast('Updating…'); }
    catch (e) { toast(`Not updated: ${(e as Error).message}`); }
  };
  return (
    <>
      <div class={`versionbar${inline ? ' inline' : ''}`} role="status" aria-label="Software version">
        <span>{versionLabel(u)}{updated ? ` · updated ${updated}` : ''}</span>
        {!quiet && available && <button type="button" class="vb-chip" onClick={() => void update()} title={`${u.latest!.tag} is ready: tap to install it now`}>Update available · tap to install</button>}
        {busy && <span class="vb-chip busy">Updating: {u.message ?? u.phase}</span>}
        {u.phase === 'failed' && u.job && <span class="vb-chip busy" title={u.message ?? ''}>Update didn't finish</span>}
      </div>
    </>
  );
}
