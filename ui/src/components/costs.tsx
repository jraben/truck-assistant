import { useState } from 'preact/hooks';
import { stateStore, toast, useStore, type ChargeSession, type ChargeSummary } from '../lib/brain.ts';
import { ago, deleteSession, saveSession, useChargers, useCharges, useGas } from '../lib/data.ts';
import { fmtDateTime, fromLocalInput, money, toLocalInput } from '../lib/fmt.ts';
import { Card, Modal, V } from './common.tsx';
import type { WP } from './drive.tsx';

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const lastMonths = (n: number) => {
  const out: string[] = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(monthKey(x)); }
  return out;
};
const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function CostSummary({ s }: WP) {
  const c = useCharges();
  const gas = useGas(s?.driver?.id);
  const [view, setView] = useState<'month' | 'year'>('month');
  const keys = lastMonths(12);
  const byKey = new Map(c.months.map((m) => [m.period, m]));
  const rows = keys.map((k) => byKey.get(k));
  const max = Math.max(1, ...rows.map((r) => r?.cost ?? 0));
  const cur: ChargeSummary | undefined = view === 'month' ? byKey.get(monthKey()) : c.years.find((y) => y.period === String(new Date().getFullYear()));
  const saved = cur && cur.gasEquivalent !== null ? cur.gasEquivalent - cur.cost : null;
  return (
    <Card label={view === 'month' ? 'Charging this month' : 'Charging this year'} right={
      <div class="row" style="gap:4px">
        <button type="button" class={`tag ${view === 'month' ? 'accent' : 'dim'}`} onClick={() => setView('month')}>MONTH</button>
        <button type="button" class={`tag ${view === 'year' ? 'accent' : 'dim'}`} onClick={() => setView('year')}>YEAR</button>
        <a class="tag dim" href="/api/charges.csv" download style="text-decoration:none">CSV</a>
      </div>}>
      <div class="row between wrap">
        <div class="big num">{money(cur?.cost ?? 0)}</div>
        <div class="kv" style="min-width:150px">
          <span>Home</span><span>{money(cur?.homeCost ?? 0)}</span>
          <span>Public</span><span>{money(cur?.publicCost ?? 0)}</span>
          <span>$/kWh</span><span><V v={cur?.costPerKwh != null ? `$${cur.costPerKwh.toFixed(3)}` : null} why="Needs sessions with both kWh and cost" /></span>
          <span>$/mile</span><span><V v={cur?.costPerMile != null ? `$${cur.costPerMile.toFixed(3)}` : null} why="No trip miles in this period yet" /></span>
        </div>
      </div>
      <div class="dimtxt" style="font-size:13px">
        {cur?.gasEquivalent != null
          ? <>vs. {cur.gasVehicle === 'Custom' ? 'a gas truck' : cur.gasVehicle}: {saved !== null && saved >= 0
            ? <>you saved <b style="color:var(--ok)">{money(saved)}</b> this {view}</>
            : <>gas would have been <b>{money(cur.gasEquivalent)}</b>, {money(-(saved ?? 0))} less than charging, this {view}</>} ({money(cur.gasEquivalent)} of fuel for {cur.miles < 10 ? cur.miles.toFixed(1) : Math.round(cur.miles)} mi).</>
          : 'Gas comparison appears once trips have miles.'}
      </div>
      {gas?.source === 'ha' && (
        <div class="dimtxt" style="font-size:13px">
          {gas.today
            ? <>Gas nearby: <b class="num">${gas.today.price.toFixed(2)}</b> {gas.fuel}{gas.today.station ? <> at {gas.today.station}</> : ''}, updated {ago(gas.today.updatedAt ?? gas.today.fetchedAt)}</>
            : <>Gas nearby: {gas.message ?? 'no price yet'}{/settings page/.test(gas.message ?? '') && <> <a href="/settings#ha">Open settings</a></>}</>}
        </div>
      )}
      <div class="bars" aria-label="Charging cost, last 12 months">
        {rows.map((r, i) => {
          const pubH = ((r?.publicCost ?? 0) / max) * 100;
          const homeH = ((r?.homeCost ?? 0) / max) * 100;
          return (
            <div class={`b ${keys[i] === monthKey() ? 'cur' : ''}`} title={`${keys[i]}: ${money(r?.cost ?? 0)}`}>
              <i style={{ height: `${pubH}%` }} /><i class="home" style={{ height: `${homeH}%` }} />
            </div>
          );
        })}
      </div>
      <div class="bars-x">{keys.map((k) => <span>{MON[Number(k.slice(5)) - 1]}</span>)}</div>
      <div class="dimtxt" style="font-size:11px"><span style="color:var(--ok)">■</span> home <span style="color:var(--accent)">■</span> public</div>
    </Card>
  );
}

export function CostSessions(_: WP) {
  const c = useCharges();
  const [edit, setEdit] = useState<ChargeSession | 'new' | null>(null);
  return (
    <Card label="Charge sessions" right={<button class="btn sm primary" type="button" onClick={() => setEdit('new')}>+ Log a charge</button>}>
      {c.error && <div class="err">Couldn't load sessions: {c.error}</div>}
      {!c.sessions.length && !c.error && <div class="dimtxt">No sessions yet. Log one after unplugging, or raise the charge level while parked.</div>}
      <div class="list">
        {c.sessions.slice(0, 30).map((s) => (
          <button type="button" class="item" onClick={() => setEdit(s)}>
            <div class="row between">
              <div class="grow ellip"><b>{s.stationName ?? (s.place === 'home' ? 'Home' : s.network ?? 'Charge')}</b> <span class="dimtxt">{fmtDateTime(s.startedAt)}</span></div>
              <span class="num" style="font-family:var(--display);font-size:22px;font-weight:600"><V v={money(s.cost)} why="Cost not entered yet" /></span>
            </div>
            <div class="row wrap" style="gap:6px">
              <span class={`tag ${s.place === 'home' ? 'ok' : 'accent'}`}>{s.place}</span>
              {s.kwh !== null && <span class="tag dim">{s.kwh.toFixed(1)} kWh</span>}
              {s.startSoc !== null && s.endSoc !== null && <span class="tag dim">{Math.round(s.startSoc)}→{Math.round(s.endSoc)}%</span>}
              {s.costSource && <span class="tag dim">{s.costSource}</span>}
              {s.source !== 'manual' && <span class="tag dim">{s.source}</span>}
              {s.onPeak && <span class="tag bad" title={`Charged during ${s.onPeak}: the demand charge may apply this month`}>on-peak</span>}
            </div>
            {s.onPeak && <div class="dimtxt" style="font-size:12px">Overlapped {s.onPeak}: your plan's demand charge may bill this hour.</div>}
          </button>
        ))}
      </div>
      {edit && <Modal title={edit === 'new' ? 'Log a charge' : 'Edit charge'} onClose={() => setEdit(null)}>
        <ChargeForm session={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />
      </Modal>}
    </Card>
  );
}

/** The one form for entering a charge: Charge view, the prompt, and the /settings portal. */
export function ChargeForm({ session, onDone, prefill }: { session: ChargeSession | null; onDone: () => void; prefill?: boolean }) {
  const st = useStore(stateStore);
  const chargers = useChargers();
  const near = !session && prefill !== false ? chargers.list.slice().sort((a, b) => a.distanceMi - b.distanceMi)[0] : undefined;
  const nearOk = near && near.distanceMi <= 0.25 ? near : undefined;
  const [f, setF] = useState(() => ({
    place: session?.place ?? 'public',
    network: session?.network ?? nearOk?.network ?? '',
    stationName: session?.stationName ?? nearOk?.name ?? '',
    kwh: session?.kwh?.toString() ?? '',
    cost: session?.cost?.toString() ?? '',
    free: session?.costSource === 'free',
    startedAt: toLocalInput(session?.startedAt ?? new Date(Date.now() - 30 * 60_000).toISOString()),
    endedAt: toLocalInput(session?.endedAt ?? (session ? null : new Date().toISOString())),
    startSoc: session?.startSoc?.toString() ?? '',
    endSoc: session?.endSoc?.toString() ?? (session ? '' : st?.soc != null ? String(Math.round(st.soc)) : ''),
    note: session?.note ?? '',
  }));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).type === 'checkbox' ? (e.target as HTMLInputElement).checked : (e.target as HTMLInputElement).value });
  const n = (v: string) => (v.trim() === '' ? null : Number(v));

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body: Partial<ChargeSession> = {
      place: f.place as ChargeSession['place'],
      network: f.network || null, stationName: f.stationName || null,
      kwh: n(f.kwh), startSoc: n(f.startSoc), endSoc: n(f.endSoc), note: f.note || null,
      startedAt: fromLocalInput(f.startedAt) ?? new Date().toISOString(), endedAt: fromLocalInput(f.endedAt),
    };
    if (f.free) { body.cost = 0; body.costSource = 'free'; }
    else if (f.cost.trim() !== '') { body.cost = n(f.cost); body.costSource = 'receipt'; }
    else if (session) { body.cost = null; body.costSource = f.place === 'home' ? session.costSource : null; }
    if (!session && nearOk && f.stationName === nearOk.name) { body.lat = nearOk.lat; body.lon = nearOk.lon; body.maxKw = nearOk.maxKw; }
    try { await saveSession(session?.id ?? null, body); toast('Charge saved'); onDone(); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!session || !confirm('Delete this charge session?')) return;
    try { await deleteSession(session.id); toast('Deleted'); onDone(); } catch (x) { setErr((x as Error).message); }
  };

  return (
    <form class="form" onSubmit={submit}>
      <div class="row wrap">
        {(['public', 'home', 'other'] as const).map((p) => (
          <button type="button" class={`btn ${f.place === p ? 'primary' : ''}`} onClick={() => setF({ ...f, place: p })}>{p}</button>
        ))}
      </div>
      <div class="fields">
        <label class="f"><span>$ paid</span><input type="number" inputMode="decimal" step="0.01" min="0" value={f.cost} onInput={set('cost')} disabled={f.free} placeholder={f.place === 'home' ? 'auto from home rate' : 'from the receipt'} /></label>
        <label class="f"><span>kWh</span><input type="number" inputMode="decimal" step="0.1" min="0" value={f.kwh} onInput={set('kwh')} placeholder={f.place === 'home' ? 'auto from SoC' : ''} /></label>
        <label class="f"><span>Network</span><input type="text" list="networks" value={f.network} onInput={set('network')} /></label>
        <label class="f"><span>Station</span><input type="text" value={f.stationName} onInput={set('stationName')} /></label>
        <label class="f"><span>Start</span><input type="datetime-local" value={f.startedAt} onInput={set('startedAt')} /></label>
        <label class="f"><span>End</span><input type="datetime-local" value={f.endedAt} onInput={set('endedAt')} /></label>
        <label class="f"><span>Start %</span><input type="number" min="0" max="100" value={f.startSoc} onInput={set('startSoc')} /></label>
        <label class="f"><span>End %</span><input type="number" min="0" max="100" value={f.endSoc} onInput={set('endSoc')} /></label>
      </div>
      <datalist id="networks">{['Tesla', 'Electrify America', 'EVgo', 'ChargePoint', 'Blink', 'Rivian Adventure Network', 'Ionna', 'Shell Recharge'].map((x) => <option value={x} />)}</datalist>
      <label class="check"><input type="checkbox" checked={f.free} onChange={set('free')} /> Free charge</label>
      <label class="f"><span>Note</span><input type="text" value={f.note} onInput={set('note')} placeholder="idle fee, membership, …" /></label>
      {nearOk && !session && <div class="dimtxt" style="font-size:13px">Prefilled from the nearest charger ({nearOk.distanceMi.toFixed(1)} mi).</div>}
      {err && <div class="err">{err}</div>}
      <div class="row wrap">
        <button class="btn big primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button class="btn big" type="button" onClick={onDone}>Cancel</button>
        {session && <button class="btn big danger" type="button" onClick={remove}>Delete</button>}
      </div>
    </form>
  );
}

const DISMISS_KEY = 'slate.dismissedCharges';
const dismissed = (): number[] => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]'); } catch { return []; } };

/** "Charged here? How much did it cost?" for a detected, unpriced session. */
export function ChargePrompt() {
  const c = useCharges();
  const [, force] = useState(0);
  const [editing, setEditing] = useState<ChargeSession | null>(null);
  const dis = dismissed();
  const ask = c.sessions.find((s) => s.source === 'detected' && s.cost === null && s.costSource === null && s.place !== 'home'
    && Date.now() - Date.parse(s.endedAt ?? s.startedAt) < 48 * 3600_000 && !dis.includes(s.id));
  const homeNew = c.sessions.find((s) => s.source === 'detected' && s.place === 'home' && Date.now() - Date.parse(s.endedAt ?? s.startedAt) < 10 * 60_000 && !dis.includes(s.id));
  const later = (id: number) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dis.slice(-50), id])); } catch {} force((n) => n + 1); };

  if (editing) return <Modal title="How much did it cost?" onClose={() => setEditing(null)}><ChargeForm session={editing} onDone={() => { later(editing.id); setEditing(null); }} /></Modal>;
  if (ask) {
    return (
      <div class="card prompt" role="alert">
        <div class="lbl">Charge detected · {Math.round(ask.startSoc ?? 0)}% → {Math.round(ask.endSoc ?? 0)}%</div>
        <div style="font-family:var(--display);font-size:26px;font-weight:600">Charged {ask.stationName ? `at ${ask.stationName}` : 'here'}? How much did it cost?</div>
        <div class="row wrap">
          <button class="btn big primary" type="button" onClick={() => setEditing(ask)}>Enter cost</button>
          <button class="btn big" type="button" onClick={async () => { await saveSession(ask.id, { cost: 0, costSource: 'free' }); toast('Logged as free'); }}>Free</button>
          <button class="btn big" type="button" onClick={() => later(ask.id)}>Later</button>
          <button class="btn big danger" type="button" onClick={async () => { await deleteSession(ask.id); toast('Removed'); }}>Not a charge</button>
        </div>
      </div>
    );
  }
  if (homeNew) {
    return (
      <div class="card prompt" role="status">
        <div class="lbl">Home charge logged</div>
        <div style="font-family:var(--display);font-size:24px;font-weight:600">{homeNew.kwh !== null ? `${homeNew.kwh.toFixed(1)} kWh` : 'kWh unknown'} · <V v={money(homeNew.cost)} why="Set a home rate on the settings page" /></div>
        <div class="row wrap">
          <button class="btn" type="button" onClick={() => later(homeNew.id)}>OK</button>
          <button class="btn" type="button" onClick={() => setEditing(homeNew)}>Edit</button>
        </div>
      </div>
    );
  }
  return null;
}
