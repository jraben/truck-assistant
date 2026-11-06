// "Pay off the truck with gas savings": the Charge view card, the Drive
// screen's context card and the /settings section (docs/contract.md, Payoff goal).
// Every colour is a theme token.
import { useEffect, useState } from 'preact/hooks';
import { api, toast, type GoalAdjustment, type GoalDay, type GoalSummary, type PayoffGoal } from '../lib/brain.ts';
import { refreshGoal, useGoal } from '../lib/data.ts';
import { money } from '../lib/fmt.ts';
import { Card } from './common.tsx';
import type { WP } from './drive.tsx';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const usd0 = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The projection in words. */
export function projectionText(g: GoalSummary): string {
  const p = g.projection;
  if (p.state === 'paid-off') return p.date ? `Paid off ${dayLabel(p.date)}` : 'Paid off';
  if (p.state === 'projected' && p.date) return `Paid off by ${dayLabel(p.date)} at this rate`;
  if (p.state === 'not-saving') return 'Not saving at the moment: charging cost more than gas lately';
  if (p.state === 'not-enough-data') return 'Not enough driving yet for a payoff date (30 days)';
  return 'No driving yet';
}

function Bar({ pct }: { pct: number }) {
  return <span class="goalbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>;
}

function MonthBars({ g, n = 12 }: { g: GoalSummary; n?: number }) {
  const ms = g.months.slice(-n);
  if (!ms.length) return null;
  const max = Math.max(1, ...ms.map((m) => Math.abs(m.net)));
  return (
    <>
      <div class="bars goalbars" aria-label="Net saved per month">
        {ms.map((m) => <div class="b" title={`${m.month}: ${money(m.net)}${m.possibleDemandCharge ? ` (possible demand charge ${money(m.possibleDemandCharge)})` : ''}`}><i class={m.net < 0 ? 'neg' : ''} style={{ height: `${(Math.abs(m.net) / max) * 100}%` }} /></div>)}
      </div>
      <div class="bars-x">{ms.map((m) => <span>{MON[Number(m.month.slice(5)) - 1][0]}</span>)}</div>
    </>
  );
}

/** Charge view widget "payoffGoal". */
export function PayoffGoalCard(_: WP) {
  const { g, error } = useGoal();
  if (!g) return <Card label="Truck payoff"><div class="dimtxt">{error ? `Couldn't load the goal: ${error}` : 'Loading…'}</div></Card>;
  return (
    <Card label="Paid off with gas savings" right={<a class="tag dim" href="/settings#payoff" style="text-decoration:none">GOAL</a>}>
      <div class="row between wrap" style="gap:6px;align-items:baseline">
        <span class="big num" style="font-size:38px">{usd0(g.saved)}</span>
        <span class="dimtxt num">of {money(g.target)} <b style="color:var(--fg)">({g.pct.toFixed(1)}%)</b></span>
      </div>
      <Bar pct={g.pct} />
      {g.message ? <div class="dimtxt" style="font-size:13px">{g.message}</div> : (
        <div class="kv" style="font-size:13px">
          <span>This month</span><span class="num">{money(g.thisMonth)}</span>
          <span>Avg / month</span><span class="num">{g.avgPerMonth === null ? '—' : money(g.avgPerMonth)}</span>
        </div>
      )}
      <div class="dimtxt" style="font-size:12px">{projectionText(g)}</div>
      <MonthBars g={g} />
    </Card>
  );
}

/** Drive screen context card (parked only; see pickCards). */
export function GoalDriveCard({ go }: { go: WP['go'] }) {
  const { g } = useGoal();
  if (!g) return null;
  return (
    <button type="button" class="ccard" onClick={() => go('charge')}>
      <span class="grow ccol">
        <span class="lbl">Truck payoff · gas savings</span>
        <span class="cbig num">{usd0(g.saved)}<small> {g.pct.toFixed(0)}%</small></span>
        <Bar pct={g.pct} />
        <span class="dimtxt ellip" style="font-size:14px">{g.startDate ? projectionText(g) : 'Counting starts with the first real drive'}</span>
      </span>
    </button>
  );
}

// ---- /settings ---------------------------------------------------------------------

function Adjustments({ list, onChange }: { list: GoalAdjustment[]; onChange: () => void }) {
  const [f, setF] = useState({ day: new Date().toLocaleDateString('en-CA'), label: '', amount: '' });
  const [err, setErr] = useState<string | null>(null);
  const add = async (e: Event) => {
    e.preventDefault(); setErr(null);
    try { await api('/api/goal/adjustments', { method: 'POST', body: JSON.stringify({ day: f.day, label: f.label, amount: Number(f.amount) }) }); setF({ ...f, label: '', amount: '' }); onChange(); }
    catch (x) { setErr((x as Error).message); }
  };
  const del = async (a: GoalAdjustment) => {
    if (!confirm(`Remove "${a.label}" (${money(a.amount)})?`)) return;
    try { await api(`/api/goal/adjustments/${a.id}`, { method: 'DELETE', headers: {} }); onChange(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div class="form">
      {list.length > 0 && (
        <table class="tou"><tbody>
          {list.map((a) => <tr><td class="num">{a.day}</td><td>{a.label}</td><td class="num" style={{ color: a.amount < 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(a.amount)}</td><td><button class="btn sm danger" type="button" onClick={() => void del(a)}>Remove</button></td></tr>)}
        </tbody></table>
      )}
      <form class="fields" onSubmit={add}>
        <label class="f"><span>Date</span><input type="date" value={f.day} onInput={(e) => setF({ ...f, day: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>What</span><input type="text" value={f.label} placeholder="Utility EV rebate" onInput={(e) => setF({ ...f, label: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>$ (negative counts against)</span><input type="number" step="0.01" value={f.amount} onInput={(e) => setF({ ...f, amount: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>&nbsp;</span><button class="btn primary" type="submit" disabled={!f.label.trim() || !f.amount}>+ Add</button></label>
      </form>
      {err && <div class="err">{err}</div>}
    </div>
  );
}

function LedgerByMonth({ days }: { days: GoalDay[] }) {
  const byMonth = new Map<string, GoalDay[]>();
  for (const d of days) byMonth.set(d.day.slice(0, 7), [...(byMonth.get(d.day.slice(0, 7)) ?? []), d]);
  const months = [...byMonth.entries()].sort(([a], [b]) => b.localeCompare(a));
  const [open, setOpen] = useState<string | null>(null);
  if (!months.length) return <p class="dimtxt">No ledger days yet.</p>;
  const sum = (xs: GoalDay[], k: 'net' | 'gasCost' | 'chargeCost' | 'miles') => xs.reduce((a, d) => a + d[k], 0);
  return (
    <div style="overflow-x:auto">
      <table class="tou ledger">
        <thead><tr><th>Month / day</th><th>Miles</th><th>Gas $</th><th>Charging $</th><th>Net saved</th><th>Vehicle · $/gal</th><th /></tr></thead>
        <tbody>
          {months.map(([m, ds]) => {
            const demand = Math.max(0, ...ds.map((d) => d.possibleDemandCharge ?? 0));
            return [
              <tr class="mrow" onClick={() => setOpen(open === m ? null : m)} style="cursor:pointer">
                <td><b>{MON[Number(m.slice(5)) - 1]} {m.slice(0, 4)}</b> {ds.every((d) => d.frozen) ? <span class="tag dim">closed</span> : <span class="tag accent">open</span>}</td>
                <td class="num">{Math.round(sum(ds, 'miles'))}</td><td class="num">{money(sum(ds, 'gasCost'))}</td><td class="num">{money(sum(ds, 'chargeCost'))}</td>
                <td class="num"><b>{money(sum(ds, 'net'))}</b></td>
                <td class="dimtxt">{[...new Set(ds.map((d) => d.vehicle.label))].join(', ')}</td>
                <td>{demand > 0 && <span class="tag bad" title="A home charge overlapped on-peak: your plan may bill this demand charge. Not subtracted.">demand? {money(demand)}</span>}</td>
              </tr>,
              ...(open === m ? ds.map((d) => (
                <tr class="drow dimtxt">
                  <td class="num">{d.day}</td>
                  <td class="num" title={`city ${d.cityMiles} · highway ${d.highwayMiles} · unsplit ${d.otherMiles}`}>{d.miles.toFixed(1)}</td>
                  <td class="num">{money(d.gasCost)}</td>
                  <td class="num">{money(d.chargeCost)}{d.chargeCostUnknown ? ` (+${d.chargeCostUnknown} no cost)` : ''}{d.homeChargeExcluded ? ` (home ${money(d.homeChargeExcluded)} left out)` : ''}</td>
                  <td class="num">{money(d.net)}</td>
                  <td>{d.vehicle.label} {d.vehicle.mpgCity}/{d.vehicle.mpgHighway}/{d.vehicle.mpgCombined} mpg · ${d.gasPrice.toFixed(2)} {d.priceSource}</td>
                  <td>{d.possibleDemandCharge ? <span class="tag bad">demand? {money(d.possibleDemandCharge)}</span> : null}</td>
                </tr>
              )) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** /settings > Charging & costs > Truck payoff goal. Saves itself (PUT /api/settings {payoffGoal}). */
export function GoalSettings({ value, onSaved }: { value: PayoffGoal; onSaved: (g: PayoffGoal) => void }) {
  const { g } = useGoal();
  const [f, setF] = useState({ target: String(value.target), startDate: value.startDate ?? '', includeHomeCharging: value.includeHomeCharging });
  const [days, setDays] = useState<GoalDay[]>([]);
  const [adj, setAdj] = useState<GoalAdjustment[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => { void api<GoalDay[]>('/api/goal/ledger').then(setDays).catch(() => {}); void api<GoalAdjustment[]>('/api/goal/adjustments').then(setAdj).catch(() => {}); void refreshGoal(); };
  useEffect(load, []);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = { payoffGoal: { target: Number(f.target), startDate: f.startDate || null, includeHomeCharging: f.includeHomeCharging } };
      const s = await api<{ payoffGoal: PayoffGoal }>('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      onSaved(s.payoffGoal); setMsg({ ok: true, text: 'Saved. Days already closed keep what they were.' });
      setTimeout(load, 2000);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const recalc = async () => {
    if (!confirm('Recalculate every day, including closed months, with today\'s comparison vehicle, gas prices and settings? The old figures are replaced.')) return;
    try { await api('/api/goal/recalc', { method: 'POST', body: JSON.stringify({ confirm: true }) }); toast('Ledger recalculated'); load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div class="form">
      {g && <div class="row wrap" style="gap:16px;align-items:center">
        <span class="big num">{usd0(g.saved)}</span>
        <span class="dimtxt">of {money(g.target)} ({g.pct.toFixed(1)}%) · {projectionText(g)}</span>
      </div>}
      {g && <Bar pct={g.pct} />}
      {g?.message && <div class="banner">{g.message}</div>}
      <div class="fields">
        <label class="f"><span>Target $</span><input type="number" step="0.01" min="1" value={f.target} onInput={(e) => setF({ ...f, target: (e.target as HTMLInputElement).value })} /></label>
        <label class="f"><span>Start (delivery day)</span><input type="date" value={f.startDate} onInput={(e) => setF({ ...f, startDate: (e.target as HTMLInputElement).value })} /></label>
      </div>
      <p class="help">Default $30,740.78 = the build ($29,290.78) + destination ($1,450). Taxes, title and registration aren't in it; add them to the target if you want them paid off too. With no start date it starts on the first real truck trip{g?.startSource === 'first-trip' && g.startDate ? ` (${g.startDate})` : ''}.</p>
      <label class="check"><input type="checkbox" checked={f.includeHomeCharging} onChange={(e) => setF({ ...f, includeHomeCharging: (e.target as HTMLInputElement).checked })} /> Subtract home charging (off: home charging counts as free, e.g. solar)</label>
      <p class="help">Saved = gas the comparison vehicle above would have burned (city miles at city mpg, highway at highway mpg, each day's stored gas price) − what charging actually cost. Only real truck trips count: never phone-imported trips, never anything recorded while the brain ran SIM=1. A month is closed (frozen) once it ends: a later vehicle or gas change, or a charge entered late, only reaches it through Recalculate.</p>
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save goal'}</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      <h3 class="sub">Adjustments</h3>
      <p class="help">One-off amounts to count: a rebate or incentive (positive), or a cost you want paid off too (negative).</p>
      <Adjustments list={adj} onChange={load} />
      <h3 class="sub">Ledger</h3>
      <LedgerByMonth days={days} />
      <div class="row wrap">
        <a class="btn sm" href="/api/goal/ledger.csv" download>Download CSV</a>
        <button class="btn sm danger" type="button" onClick={() => void recalc()}>Recalculate everything…</button>
      </div>
    </div>
  );
}
