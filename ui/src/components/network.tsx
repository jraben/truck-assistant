// Pick a network by hand (opened from the strip's system health panel).
import { useEffect, useState } from 'preact/hooks';
import { api, toast, type State } from '../lib/brain.ts';
import type { NetCandidate, NetworkStatus } from '../../../brain/src/types.ts';

export const fmtBytes = (n: number) => (n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(2)} GB`);

export function NetPanel({ s, onClose }: { s: State | null; onClose: () => void }) {
  const [cands, setCands] = useState<NetCandidate[] | null>(null);
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api<{ status: NetworkStatus; candidates: NetCandidate[] }>('/api/network').then((r) => { setCands(r.candidates); setStatus(r.status); }).catch(() => {});
  useEffect(() => { void load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  const go = async (path: string, body?: unknown, key = path) => {
    setBusy(key);
    try { const r = await api<{ status: NetworkStatus; candidates: NetCandidate[] }>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); setCands(r.candidates); setStatus(r.status); if (r.status.error) toast(r.status.error); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  const st = status ?? s?.network ?? null;
  return (
    <div class="card netpanel" role="dialog" aria-label="Network">
      <div class="row between"><span class="lbl">Network{st?.manual ? ' · picked by hand' : ' · automatic'}</span><button class="btn sm" type="button" onClick={onClose}>Close</button></div>
      {st?.backend === 'sim' && <div class="dimtxt" style="font-size:var(--fs-caption)">Simulated (desk): no radios are touched.</div>}
      {st?.backend === 'unavailable' && <div class="banner">{st.error}</div>}
      {cands && !cands.length && <div class="dimtxt">No networks set up. Add home Wi-Fi and each driver's hotspot on the <a href="/settings#network">settings page</a>.</div>}
      <div class="list">
        {cands?.map((c) => (
          <div class={`item row between ${c.active ? 'sel' : ''}`}>
            <div class="grow">
              <b>{c.label}</b>
              <div class="dimtxt" style="font-size:var(--fs-caption)">{c.kind === 'bt' ? 'Bluetooth tethering' : c.ssid}{c.inRange ? (c.signal != null ? ` · ${c.signal}%` : '') : ' · not in range'}</div>
            </div>
            {c.active ? <span class="tag ok">ON</span>
              : <button class="btn sm" type="button" disabled={!c.inRange || busy !== null} onClick={() => void go('/api/network/connect', { id: c.id }, c.id)}>{busy === c.id ? 'Joining…' : 'Use'}</button>}
          </div>
        ))}
      </div>
      {st?.manual && <button class="btn" type="button" disabled={busy !== null} onClick={() => void go('/api/network/auto')}>Back to automatic</button>}
      {st && Object.keys(st.bytesThisMonth).length > 0 && (
        <div class="dimtxt" style="font-size:var(--fs-caption)">Phone data this month: {Object.entries(st.bytesThisMonth).map(([d, b]) => `${d} ${fmtBytes(b)}`).join(' · ')}{st.saveData ? ' · saving data' : ''}</div>
      )}
      {st?.bluetooth && st.bluetooth !== 'supported' && <div class="dimtxt" style="font-size:var(--fs-caption)">Bluetooth tethering {st.bluetooth}</div>}
    </div>
  );
}
