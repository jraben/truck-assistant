// Trips, WEEK: "simulate my week". A driver's phone history (Life360 or the
// Home Assistant app) replayed as if driven in the Slate: miles, kWh, the
// charge level with a home top-up every night, charging cost vs gas.
// The brain does the work (GET /api/trips/simulate-week, brain/src/weekSim.ts).
import { useEffect, useState } from 'preact/hooks';
import type { WeekSim as Sim } from '../../../brain/src/weekSim.ts';
import { api, settingsStore, useStore } from '../lib/brain.ts';
import { Modal } from './common.tsx';

/** The Sunday that started last week, YYYY-MM-DD (local). */
export function lastSunday(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const money = (n: number | null) => (n === null ? '—' : `$${n.toFixed(2)}`);
const dow = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const cell = 'padding:4px 8px';

export function WeekSim({ driverId, onClose }: { driverId: string | null; onClose: () => void }) {
  const settings = useStore(settingsStore);
  const d = settings?.drivers.find((x) => x.id === driverId) ?? settings?.drivers[0];
  const [tracker, setTracker] = useState(d?.tracker ?? '');
  const [from, setFrom] = useState(lastSunday());
  const [sim, setSim] = useState<Sim | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<'ha' | 'stored'>('ha');
  const [found, setFound] = useState<string | null>(null);
  const run = async (src = source, start = from, dates?: string[]) => {
    setBusy(true); setErr(null);
    const q = new URLSearchParams({ from: start, days: '7', source: src });
    if (dates) q.set('dates', dates.join(','));
    if (tracker && src === 'ha') q.set('tracker', tracker);
    if (d) q.set('driver', d.id);
    try { setSim(await api<Sim>(`/api/trips/simulate-week?${q}`)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  /** The 7 days with the most driving in the last 6 months of stored trips, then simulate them. */
  const busiest = async () => {
    setBusy(true); setErr(null); setFound(null);
    try {
      const r = await api<{ trips: number; best: { start: string; miles: number } | null }>(`/api/trips/busiest-week?months=6${d ? `&driver=${encodeURIComponent(d.id)}` : ''}`);
      if (!r.best) { setErr(`No stored phone trips in the last 6 months (${r.trips}). Import a Google Timeline (Settings, Import) or wait for the nightly import.`); setBusy(false); return; }
      setFrom(r.best.start); setSource('stored'); setFound(`Busiest 7 days in 6 months: from ${dow(r.best.start)}, ${r.best.miles} mi (of ${r.trips} stored trips).`);
      await run('stored', r.best.start);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  /** The 7 separate days with the most driving in 6 months, simulated back to back: a made-up hardest week. */
  const topSeven = async () => {
    setBusy(true); setErr(null); setFound(null);
    try {
      const r = await api<{ trips: number; top: { days: { day: string; miles: number }[]; miles: number } | null }>(`/api/trips/top-days?months=6&n=7${d ? `&driver=${encodeURIComponent(d.id)}` : ''}`);
      if (!r.top) { setErr(`No stored phone trips in the last 6 months (${r.trips}). Import a Google Timeline (Settings, Import) or wait for the nightly import.`); setBusy(false); return; }
      setSource('stored'); setFound(`Top ${r.top.days.length} days in 6 months, driven back to back: ${r.top.miles} mi (${r.top.days.map((x) => dow(x.day)).join(', ')}).`);
      await run('stored', r.top.days[0].day, r.top.days.map((x) => x.day));
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  useEffect(() => { if (tracker) void run(); }, []);
  const t = sim?.totals;
  const stat = (label: string, value: string, cls = '') => <div><div class="lbl">{label}</div><b class={`num ${cls}`} style="font-size:var(--fs-title)">{value}</b></div>;
  return (
    <Modal title="Simulate a week in the Slate" onClose={onClose}>
      <div style="display:grid;gap:var(--s15)">
        <p class="help" style="margin:0">Your phone's location history for a week, driven as if in the Slate, charging at home to {sim?.params.chargeTo ?? 80}% every night.</p>
        <div class="row wrap" style="gap:var(--s15);align-items:flex-end">
          <label class="f"><span>From</span>
            <select value={source} onChange={(e) => setSource((e.target as HTMLSelectElement).value as 'ha' | 'stored')}>
              <option value="ha">Home Assistant (last ~10 days)</option>
              <option value="stored">Trips TA keeps (Timeline, nightly)</option>
            </select>
          </label>
          {source === 'ha' && <label class="f" style="min-width:280px"><span>Phone tracker</span><input type="text" value={tracker} placeholder="device_tracker.life360_your_name" onInput={(e) => setTracker((e.target as HTMLInputElement).value.trim())} /></label>}
          <label class="f"><span>Week starting</span><input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
          <button type="button" class="btn primary" disabled={busy || (source === 'ha' && !tracker)} onClick={() => void run()}>{busy ? 'Working…' : 'Simulate'}</button>
          <button type="button" class="btn" disabled={busy} onClick={() => void busiest()} title="Find the 7 days with the most driving in the last 6 months of stored trips">Busiest week</button>
          <button type="button" class="btn" disabled={busy} onClick={() => void topSeven()} title="The 7 separate days with the most driving in 6 months, as one made-up week">Top 7 days</button>
        </div>
        {found && <div class="okmsg">{found}</div>}
        {err && <div class="err">{err}</div>}
        {sim && t && (
          <>
            <div class="row wrap" style="gap:var(--s3)">
              {stat('Miles', String(t.miles))}
              {stat('Energy', `${t.kwh} kWh`)}
              {stat('Lowest charge', `${Math.max(0, t.lowestSoc)}%`, t.lowestSoc < 15 ? 'err' : '')}
              {stat('Charging at home', money(t.chargeCost))}
              {t.fastStops > 0 && stat(`Fast charging (${t.fastStops} stop${t.fastStops === 1 ? '' : 's'})`, money(t.fastCost))}
              {stat(`Gas instead (${sim.params.compare.label})`, money(t.gasCost))}
              {stat('Saved', money(t.saved), 'okmsg')}
            </div>
            <div style="overflow-x:auto">
              <table class="num" style="width:100%;border-collapse:collapse;font-size:var(--fs-body-sm)">
                <thead><tr style="text-align:left">{['Day', 'Trips', 'Miles', 'City / Hwy', 'kWh', 'Charge', 'Home charge', 'Gas', 'History'].map((h) => <th style={cell} class="lbl">{h}</th>)}</tr></thead>
                <tbody>{sim.days.map((x) => (
                  <tr style="border-top:1px solid var(--line)">
                    <td style={cell}>{dow(x.day)}</td>
                    <td style={cell}>{x.trips.length}</td>
                    <td style={cell}>{x.miles}</td>
                    <td style={cell}>{x.cityMiles} / {x.highwayMiles}</td>
                    <td style={cell}>{x.kwh}</td>
                    <td style={cell}>{x.socStart}% → {Math.max(0, x.socLow)}%{x.fastStops ? ` · ${x.fastStops} fast charge${x.fastStops === 1 ? '' : 's'}${x.fastCost !== null ? ` ${money(x.fastCost)}` : ''}` : ''}</td>
                    <td style={cell}>{x.chargeKwh ? `${x.chargeKwh} kWh · ${money(x.chargeCost)}` : '—'}</td>
                    <td style={cell}>{x.gallons ? `${x.gallons} gal · ${money(x.gasCost)}` : '—'}</td>
                    <td style={cell} class={x.coverage === 'good' || x.coverage === 'stored' ? 'dimtxt' : 'err'}>{x.coverage === 'stored' ? 'stored' : x.coverage === 'none' ? 'none' : `${x.points} fixes${x.coverage === 'thin' ? ', thin' : ''}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {sim.notes.map((n) => <div class="dimtxt" style="font-size:var(--fs-caption)">{n}</div>)}
          </>
        )}
      </div>
    </Modal>
  );
}
