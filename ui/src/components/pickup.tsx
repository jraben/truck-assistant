// Airport pickup card: follow a flight and know when to leave.
import { useEffect, useState } from 'preact/hooks';
import { api, toast } from '../lib/brain.ts';
import type { PickupView } from '../../../brain/src/pickup/service.ts';
import { fmtTime } from '../lib/fmt.ts';
import { NavModal } from './NavModal.tsx';
import { Card } from './common.tsx';
import { DrivingLock } from '../drive/Lock.tsx';

/** "36,000 ft · 518 mph" / "On the ground · 14 mph", from ADS-B. Pure. */
export function planeLine(pl: { altFt: number | 'ground' | null; gsKt: number | null }): string {
  const spd = pl.gsKt === null ? '' : ` · ${Math.round(pl.gsKt * 1.15078)} mph`;
  if (pl.altFt === 'ground') return `On the ground${spd}`;
  return `${pl.altFt === null ? 'Altitude unknown' : `${pl.altFt.toLocaleString('en-US')} ft`}${spd}`;
}

const STEPS =[['en-route', 'Flying'], ['approach', 'Approach'], ['taxiing', 'Landed'], ['at-gate', 'At gate']] as const;

export function PickupCard() {
  const [v, setV] = useState<PickupView | null>(null);
  const [flight, setFlight] = useState('');
  const [who, setWho] = useState('');
  const [bags, setBags] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nav, setNav] = useState(false);
  const load = async () => { try { setV(await api<PickupView>('/api/pickup')); } catch { /* keep */ } };
  useEffect(() => { void load(); const id = setInterval(() => void load(), 15_000); return () => clearInterval(id); }, []);
  const start = async (f: string) => {
    setBusy(true);
    try { setV(await api<PickupView>('/api/pickup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flight: f, who: who.trim() || null, bags }) })); setFlight(''); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => { setV(await api<PickupView>('/api/pickup', { method: 'DELETE' })); };
  const p = v?.pickup, s = v?.state, pl = s?.plane ?? null, o = s?.official ?? null;
  if (p) {
    const idx = STEPS.findIndex(([k]) => k === s?.phase);
    return (
      <Card label={`Pickup · ${p.flight.label}${p.who ? ` · ${p.who}` : ''}`} right={<button class="btn sm" type="button" onClick={() => void cancel()}>Done</button>}>
        {v?.sim && <div class="tag dim" style="justify-self:start">Simulated flight (test panel)</div>}
        {o?.cancelled && <div class="banner bad">The airline lists {p.flight.label} as cancelled.</div>}
        {o?.diverted && <div class="banner bad">{p.flight.label} has been diverted.</div>}
        <div class="pkline">{s?.line ?? 'Looking for the flight…'}</div>
        {p.origin && p.dest && <div class="dimtxt">{p.origin.city ?? p.origin.iata} → {p.dest.name}</div>}
        {pl && <div class="dimtxt num">{planeLine(pl)}</div>}
        {o && (o.gate || o.terminal || o.baggage || o.delayMin !== null || o.status) && (
          <div class="row wrap dimtxt num" style="gap:var(--s15)">
            {o.terminal && <span>Terminal <b>{o.terminal}</b></span>}
            {o.gate && <span>Gate <b>{o.gate}</b></span>}
            {o.baggage && <span>Bags at <b>{o.baggage}</b></span>}
            {o.delayMin !== null && o.delayMin !== 0 && <span>{o.delayMin > 0 ? `${o.delayMin} min late` : `${-o.delayMin} min early`}</span>}
            {o.status && <span>{o.status}</span>}
          </div>
        )}
        <div class="pksteps">{STEPS.map(([, label], i) => <span class={i <= idx ? 'on' : ''}>{label}</span>)}</div>
        <div class="rtsum">
          {s?.milesOut !== null && s?.milesOut !== undefined && s.milesOut > 0 && <div><b class="num">{s.milesOut}</b><small>mi out</small></div>}
          {s?.landsAt && <div><b class="num">{fmtTime(s.landsAt)}</b><small>{s.phase === 'taxiing' || s.phase === 'at-gate' ? 'landed' : 'lands'}</small></div>}
          {s?.readyAt && <div><b class="num">{fmtTime(s.readyAt)}</b><small>out front{p.bags ? ' (bags)' : ''}</small></div>}
          {s?.leaveAt && s.phase !== 'at-gate' && <div><b class="num">{Date.parse(s.leaveAt) <= Date.now() ? 'Now' : fmtTime(s.leaveAt)}</b><small>leave{s.driveMin !== null ? ` (${s.driveMin} min drive)` : ''}</small></div>}
        </div>
        {p.dest && <button type="button" class="btn primary" onClick={() => setNav(true)}>Navigate to {p.dest.iata ?? 'the airport'}</button>}
        {nav && p.dest && <NavModal target={{ name: p.dest.iata ? `${p.dest.iata} pickup` : 'Airport pickup', lat: p.dest.lat, lon: p.dest.lon }} onClose={() => setNav(false)} />}
        {v?.error && <div class="dimtxt" style="font-size:var(--fs-caption)">{v.error}</div>}
        <div class="attrib">Position: ADS-B via adsb.fi (open data); route: adsbdb. Landing time is an estimate from distance and speed.{v?.officialOn ? ' Gate, bags and delays: FlightAware AeroAPI.' : ' The gate and bag carousel need a FlightAware key (Settings → Traffic cameras and incidents).'}</div>
      </Card>
    );
  }
  return (
    <Card label="Airport pickup">
      <DrivingLock what="typing" summary="Set the flight when the truck is stopped; a pickup already on keeps showing while you drive.">
        {v?.suggestion && <button class="btn primary" type="button" disabled={busy} onClick={() => void start(v.suggestion!.flight.label)}>Track {v.suggestion.flight.label} (from “{v.suggestion.from}”)</button>}
        <form class="pkform" onSubmit={(e) => { e.preventDefault(); if (flight.trim()) void start(flight); }}>
          <input type="text" placeholder="Flight (AA 1234)" value={flight} onInput={(e) => setFlight((e.target as HTMLInputElement).value)} aria-label="Flight number" />
          <input type="text" placeholder="Who (optional)" value={who} onInput={(e) => setWho((e.target as HTMLInputElement).value)} aria-label="Who you're picking up" />
          <label class="dimtxt"><input type="checkbox" checked={bags} onChange={(e) => setBags((e.target as HTMLInputElement).checked)} /> checked bags</label>
          <button class="btn primary" type="submit" disabled={busy || !flight.trim()}>{busy ? 'Finding…' : 'Track'}</button>
        </form>
      </DrivingLock>
      <div class="dimtxt" style="font-size:var(--fs-caption)">Follows the flight live and tells you when to leave, with alerts to your phone when it's time, when it lands and when it's at the gate.</div>
    </Card>
  );
}
