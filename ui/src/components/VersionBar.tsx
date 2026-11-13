// The small line at the bottom of the cockpit: which version is running and
// when it was installed (TA_v0.1.0+3d06fb9 · updated Nov 13, 2026, 3:03 PM),
// and an "Update available" chip. Tapping it says what's new, how big the
// download is, and whether to wait for home Wi-Fi; installing stays in
// Settings, Logs & system, Updates (which won't install while driving).
import { useEffect, useState } from 'preact/hooks';
import type { Release, UpdateStatus } from '../../../brain/src/ops/types.ts';
import { api, stateStore, useStore } from '../lib/brain.ts';
import { Modal } from './common.tsx';

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

export function VersionBar() {
  const s = useStore(stateStore);
  const [u, setU] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => void api<UpdateStatus>('/api/update').then(setU, () => {});
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  if (!u) return null;
  const available = u.phase === 'available' && !!u.latest;
  const busy = BUSY.includes(u.phase);
  const updated = when(u.installed.installedAt);
  return (
    <>
      <div class="versionbar">
        <span>{versionLabel(u)}{updated ? ` · updated ${updated}` : ''}</span>
        {(available || busy) && (
          <button type="button" class={`vb-chip ${busy ? 'busy' : ''}`} onClick={() => setOpen(true)}>{busy ? `Updating: ${u.message ?? u.phase}` : 'Update available'}</button>
        )}
      </div>
      {open && u.latest && (() => {
        const d = downloadWords(u.latest);
        const w = wifiAdvice(s?.network?.link, d.big);
        const notes = u.latest.notes.split('\n').filter(Boolean).slice(0, 6);
        return (
          <Modal title="Software update" onClose={() => setOpen(false)}>
            <div style="display:grid;gap:var(--s15)">
              <div><span class="dimtxt">Running</span> <b>{versionLabel(u)}</b>{updated ? <span class="dimtxt">, installed {updated}</span> : null}</div>
              <div><span class="dimtxt">New</span> <b>{u.latest.tag}</b>{u.latest.publishedAt ? <span class="dimtxt">, from {when(u.latest.publishedAt)}</span> : null}</div>
              <div><span class="dimtxt">Download</span> <b>{d.size}</b></div>
              <div class={w.ok ? 'okmsg' : 'banner'}>{w.text}</div>
              {u.auto.enabled && <div class="dimtxt">Automatic updates are on{u.auto.when === 'home-wifi' ? ', on home Wi-Fi only' : ', when parked'}{u.auto.waiting ? `: ${u.auto.waiting}` : ''}.</div>}
              {notes.length > 0 && <div><span class="lbl">What's new</span><ul style="margin:var(--s05) 0 0;padding-left:1.2em">{notes.map((n) => <li>{n.replace(/^[-*]\s*/, '')}</li>)}</ul></div>}
              <div class="row wrap"><a class="btn primary" href="/settings#updates">Install in Settings</a><button type="button" class="btn" onClick={() => setOpen(false)}>Later</button></div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
