// Airport pickup card: follow a flight and know when to leave.
import { useEffect, useState } from 'preact/hooks';
import { api, toast } from '../lib/brain.ts';
import type { PickupView } from '../../../brain/src/pickup/service.ts';
import { fmtTime, wazeUrl } from '../lib/fmt.ts';
import { Card } from './common.tsx';

const STEPS = [['en-route', 'Flying'], ['approach', 'Approach'], ['taxiing', 'Landed'], ['at-gate', 'At gate']] as const;

export function PickupCard() {
  const [v, setV] = useState<PickupView | null>(null);
  const [flight, setFlight] = useState('');
  const [who, setWho] = useState('');
  const [bags, setBags] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => { try { setV(await api<PickupView>('/api/pickup')); } catch { /* keep */ } };
  useEffect(() => { void load(); const id = setInterval(() => void load(), 15_000); return () => clearInterval(id); }, []);
  const start = async (f: string) => {
    setBusy(true);
    try { setV(await api<PickupView>('/api/pickup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flight: f, who: who.trim() || null, bags }) })); setFlight(''); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => { setV(await api<PickupView>('/api/pickup', { method: 'DELETE' })); };
  const p = v?.pickup, s = v?.state;
  if (p) {
    const idx = STEPS.findIndex(([k]) => k === s?.phase);
    return (
      <Card label={`Pickup · ${p.flight.label}${p.who ? ` · ${p.who}` : ''}`} right={<button class="btn sm" type="button" onClick={() => void cancel()}>Done</button>}>
        <div class="pkline">{s?.line ?? 'Looking for the flight…'}</div>
        {p.origin && p.dest && <div class="dimtxt">{p.origin.city ?? p.origin.iata} → {p.dest.name}</div>}
        <div class="pksteps">{STEPS.map(([, label], i) => <span class={i <= idx ? 'on' : ''}>{label}</span>)}</div>
        <div class="rtsum">
          {s?.milesOut !== null && s?.milesOut !== undefined && s.milesOut > 0 && <div><b class="num">{s.milesOut}</b><small>mi out</small></div>}
          {s?.landsAt && <div><b class="num">{fmtTime(s.landsAt)}</b><small>{s.phase === 'taxiing' || s.phase === 'at-gate' ? 'landed' : 'lands'}</small></div>}
          {s?.readyAt && <div><b class="num">{fmtTime(s.readyAt)}</b><small>out front{p.bags ? ' (bags)' : ''}</small></div>}
          {s?.leaveAt && s.phase !== 'at-gate' && <div><b class="num">{Date.parse(s.leaveAt) <= Date.now() ? 'Now' : fmtTime(s.leaveAt)}</b><small>leave{s.driveMin !== null ? ` (${s.driveMin} min drive)` : ''}</small></div>}
        </div>
        {p.dest && <a class="btn primary" href={wazeUrl(p.dest.lat, p.dest.lon)} target="_blank" rel="noreferrer">Waze to {p.dest.iata ?? 'the airport'}</a>}
        {v?.error && <div class="dimtxt" style="font-size:13px">{v.error}</div>}
        <div class="attrib">Position: ADS-B via adsb.fi (open data); route: adsbdb. ADS-B shows where the plane is, not the gate or bag carousel.</div>
      </Card>
    );
  }
  return (
    <Card label="Airport pickup">
      {v?.suggestion && <button class="btn primary" type="button" disabled={busy} onClick={() => void start(v.suggestion!.flight.label)}>Track {v.suggestion.flight.label} (from “{v.suggestion.from}”)</button>}
      <form class="pkform" onSubmit={(e) => { e.preventDefault(); if (flight.trim()) void start(flight); }}>
        <input type="text" placeholder="Flight (AA 1234)" value={flight} onInput={(e) => setFlight((e.target as HTMLInputElement).value)} aria-label="Flight number" />
        <input type="text" placeholder="Who (optional)" value={who} onInput={(e) => setWho((e.target as HTMLInputElement).value)} aria-label="Who you're picking up" />
        <label class="dimtxt"><input type="checkbox" checked={bags} onChange={(e) => setBags((e.target as HTMLInputElement).checked)} /> checked bags</label>
        <button class="btn primary" type="submit" disabled={busy || !flight.trim()}>{busy ? 'Finding…' : 'Track'}</button>
      </form>
      <div class="dimtxt" style="font-size:13px">Follows the flight live and tells you when to leave, with alerts to your phone when it's time, when it lands and when it's at the gate.</div>
    </Card>
  );
}
