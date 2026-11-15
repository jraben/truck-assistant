// Trips, WEEK: "simulate my week". A driver's phone history (Life360 or the
// Home Assistant app) replayed as if driven in the Slate: miles, kWh, the
// charge level with a home top-up every night, charging cost vs gas.
// The brain does the work (GET /api/trips/simulate-week, brain/src/weekSim.ts).
import { useEffect, useState } from 'preact/hooks';
import type { CarCompare, WeekSim as BaseSim } from '../../../brain/src/weekSim.ts';
import { api, settingsStore, useStore, type CompareVehicle } from '../lib/brain.ts';
import { VehiclePicker, vehicleLine } from '../settings/VehiclePicker.tsx';
import { Modal } from './common.tsx';

type Sim = BaseSim & { compare?: CarCompare[] };
/** Electricity price rises to show "how long until gas wins": APS 2013-23, US 2015-25, Arizona 2020-24. */
export const ELEC_RISES = [{ pct: 2.2, label: 'APS 10-yr' }, { pct: 3.3, label: 'US 10-yr' }, { pct: 4.9, label: 'AZ 2020-24' }];
/** Years until electricity rising ratePct a year costs `multiple` times today (same as brain weekSim.ts). */
export const yearsToMultiple = (multiple: number, ratePct: number) => (multiple <= 1 ? 0 : ratePct <= 0 ? Infinity : Math.log(multiple) / Math.log(1 + ratePct / 100));
const cents = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}¢`);
const yrs = (y: number) => (!Number.isFinite(y) ? 'never' : y < 1 ? 'now' : y > 99 ? '99+ yrs' : `${Math.round(y)} yrs`);

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
  const [chargeTo, setChargeTo] = useState('80');
  const [dc, setDc] = useState('');
  const [last, setLast] = useState<{ src: 'ha' | 'stored'; start: string; dates?: string[] } | null>(null);
  const run = async (src = source, start = from, dates?: string[]) => {
    setBusy(true); setErr(null); setLast({ src, start, dates });
    const q = new URLSearchParams({ from: start, days: '7', source: src, chargeTo, startSoc: chargeTo });
    if (dates) q.set('dates', dates.join(','));
    if (Number(dc) > 0) q.set('dcPerKwh', dc);
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
  const [topBy, setTopBy] = useState<'miles' | 'highway' | 'city'>('miles');
  const topSeven = async () => {
    setBusy(true); setErr(null); setFound(null);
    try {
      const r = await api<{ trips: number; top: { days: { day: string; miles: number }[]; miles: number } | null }>(`/api/trips/top-days?months=6&n=7&by=${topBy}${d ? `&driver=${encodeURIComponent(d.id)}` : ''}`);
      if (!r.top) { setErr(`No stored phone trips in the last 6 months (${r.trips}). Import a Google Timeline (Settings, Import) or wait for the nightly import.`); setBusy(false); return; }
      const what = topBy === 'highway' ? 'most highway' : topBy === 'city' ? 'most around-town driving' : 'most driving';
      setSource('stored'); setFound(`The ${r.top.days.length} days with the ${what} in 6 months, back to back: ${r.top.miles} mi (${r.top.days.map((x) => dow(x.day)).join(', ')}).`);
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
          <label class="f"><span>Charge to (night before)</span>
            <select value={chargeTo} onChange={(e) => setChargeTo((e.target as HTMLSelectElement).value)}>{['70', '80', '90', '100'].map((v) => <option value={v}>{v}%</option>)}</select>
          </label>
          <label class="f" style="max-width:150px"><span>Fast charge $/kWh</span><input type="number" step="0.01" min="0" placeholder="what you've paid" value={dc} onInput={(e) => setDc((e.target as HTMLInputElement).value)} /></label>
          <button type="button" class="btn primary" disabled={busy || (source === 'ha' && !tracker)} onClick={() => void run()}>{busy ? 'Working…' : 'Simulate'}</button>
          <button type="button" class="btn" disabled={busy} onClick={() => void busiest()} title="Find the 7 days with the most driving in the last 6 months of stored trips">Busiest week</button>
          <label class="f"><span>Top 7 days by</span>
            <select value={topBy} onChange={(e) => setTopBy((e.target as HTMLSelectElement).value as 'miles' | 'highway' | 'city')}>
              <option value="miles">Most miles</option>
              <option value="highway">Most highway</option>
              <option value="city">Most around town</option>
            </select>
          </label>
          <button type="button" class="btn" disabled={busy} onClick={() => void topSeven()} title="The 7 separate days with the most of that driving in 6 months, as one made-up week">Top 7 days</button>
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
            {sim.compare && <CarTable cars={sim.compare} onVehicles={() => { if (last) void run(last.src, last.start, last.dates); }} />}
          </>
        )}
      </div>
    </Modal>
  );
}

/** The week against each gas car: cost, savings highway vs town, and where gas would win. */
function CarTable({ cars, onVehicles }: { cars: CarCompare[]; onVehicles: () => void }) {
  const [list, setList] = useState<CompareVehicle[] | null>(null);
  const [adding, setAdding] = useState<CompareVehicle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api<CompareVehicle[]>('/api/trips/week-vehicles').then(setList).catch(() => setList([])); }, []);
  const save = async (next: CompareVehicle[]) => {
    setErr(null);
    try { setList(await api<CompareVehicle[]>('/api/trips/week-vehicles', { method: 'PUT', body: JSON.stringify(next) })); setAdding(null); onVehicles(); } catch (e) { setErr((e as Error).message); }
  };
  const th = (h: string) => <th style={cell} class="lbl">{h}</th>;
  const slate = cars[0];
  return (
    <div style="display:grid;gap:var(--s15);margin-top:var(--s2)">
      <h3 style="margin:0">Against gas cars</h3>
      <div style="overflow-x:auto">
        <table class="num" style="width:100%;border-collapse:collapse;font-size:var(--fs-body-sm)">
          <thead><tr style="text-align:left">{['', 'Gas $/gal', 'Week', 'Per mile', 'Saved', 'Saved / 100 mi hwy', 'Saved / 100 mi town', 'Gas wins below', 'Power could rise'].map(th)}</tr></thead>
          <tbody>
            {slate && <tr style="border-top:1px solid var(--line)"><td style={cell}><b>Slate</b></td><td style={cell}>—</td><td style={cell}>{money(slate.slateCost)}</td><td style={cell}>{cents(slate.slatePerMile)}</td><td style={cell} colspan={5} class="dimtxt">home + fast charging</td></tr>}
            {cars.map((c) => (
              <tr style="border-top:1px solid var(--line)">
                <td style={cell}>{c.label} <span class="dimtxt">({c.fuel})</span></td>
                <td style={cell}>{c.gasPrice === null ? '—' : `$${c.gasPrice.toFixed(2)}${c.priceEstimated ? ' est.' : ''}`}</td>
                <td style={cell}>{money(c.gasCost)} <span class="dimtxt">· {c.gallons} gal</span></td>
                <td style={cell}>{cents(c.gasPerMile)}</td>
                <td style={cell} class="okmsg">{money(c.saved)}{c.savedPct !== null ? ` (${c.savedPct}%)` : ''}</td>
                <td style={cell}>{c.highway.miles ? money(c.highway.savedPer100) : '—'}</td>
                <td style={cell}>{c.town.miles ? money(c.town.savedPer100) : '—'}</td>
                <td style={cell}>{c.breakEvenGas === null ? '—' : `$${c.breakEvenGas.toFixed(2)}/gal`}</td>
                <td style={cell}>{c.elecMultiple === null ? '—' : <>×{c.elecMultiple} <span class="dimtxt">({ELEC_RISES.map((r) => `${yrs(yearsToMultiple(c.elecMultiple!, r.pct))} at ${r.pct}%`).join(', ')})</span></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="help" style="margin:0">"Gas wins below": the gas price at which that car would have cost the same as the Slate this week. "Power could rise": how many times over electricity (home and fast charging) could cost before that car is cheaper, and how many years that takes at {ELEC_RISES.map((r) => `${r.pct}%/yr (${r.label})`).join(', ')}, gas held still. Highway and town split the Slate's cost by energy.</p>
      <div class="row wrap" style="gap:var(--s1);align-items:center">
        <span class="lbl">Also compare with:</span>
        {(list ?? []).map((v, i) => <span class="chip">{v.label} <button type="button" class="btn sm" aria-label={`Remove ${v.label}`} onClick={() => void save((list ?? []).filter((_, j) => j !== i))}>×</button></span>)}
        {!adding && <button type="button" class="btn sm" onClick={() => setAdding({ id: null, label: 'Custom', mpgCity: 20, mpgHighway: 28, mpgCombined: 23, fuel: 'regular' })}>Add a vehicle</button>}
      </div>
      {adding && (
        <div style="display:grid;gap:var(--s1)">
          <VehiclePicker value={adding} onChange={setAdding} />
          <div class="row" style="gap:var(--s1)">
            <button type="button" class="btn primary sm" onClick={() => void save([...(list ?? []), adding])}>Add {vehicleLine(adding).split(' · ')[0]}</button>
            <button type="button" class="btn sm" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div class="err">{err}</div>}
    </div>
  );
}

