// Maintenance log (with receipt photos), reminders, TPMS history, and the
// small "due" card on the Drive view.
import { useEffect, useState } from 'preact/hooks';
import { api, toast } from '../lib/brain.ts';
import { errText, post, put, qs, upload, type MaintEntry, type MaintResp, type ReminderStatus, type TpmsPoint } from './api.ts';
import './ops.css';

const STATE_TAG: Record<string, string> = { due: 'bad', soon: 'warn', ok: 'ok', unset: 'dim', 'needs-odometer': 'dim' };
const STATE_LABEL: Record<string, string> = { due: 'due', soon: 'soon', ok: 'ok', unset: 'interval not set', 'needs-odometer': 'needs odometer' };

function useMaint() {
  const [m, setM] = useState<MaintResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { try { setM(await api<MaintResp>('/api/maintenance')); setErr(null); } catch (e) { setErr(errText(e)); } };
  useEffect(() => { void load(); }, []);
  return { m, setM, err, load };
}

export function MaintenanceView() {
  const { m, setM, err, load } = useMaint();
  const [adding, setAdding] = useState(false);
  const [editRem, setEditRem] = useState(false);
  if (!m) return <div class={err ? 'err' : 'dimtxt'}>{err ?? 'Loading…'}</div>;
  const done = async (r: ReminderStatus) => { try { setM(await post<MaintResp>(`/api/maintenance/reminders/${r.id}/done`)); toast(`${r.name}: marked done`); } catch (e) { toast(errText(e)); } };
  return (
    <div class="form">
      <div class="row wrap"><span class="lbl">Odometer</span><span class="num">{m.odometer !== null ? `≈ ${m.odometer.toFixed(0)} mi (estimated)` : 'not set (Mileage settings)'}</span><span class="grow" />
        <button class="btn primary" type="button" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Log service'}</button>
        <button class="btn" type="button" onClick={() => setEditRem(!editRem)}>{editRem ? 'Done editing' : 'Edit reminders'}</button>
      </div>
      {adding && <LogForm m={m} onDone={() => { setAdding(false); void load(); }} />}
      {editRem ? <ReminderEditor m={m} onSaved={(n) => { setM(n); setEditRem(false); }} /> : (
        <div class="list">
          {m.reminders.map((r) => (
            <div class="item row" style="justify-content:space-between">
              <div style="display:grid;gap:2px"><b style="font-size:var(--fs-section)">{r.name}</b>
                <span class="dimtxt" style="font-size:var(--fs-caption)">{[r.everyMiles ? `every ${r.everyMiles} mi` : null, r.everyMonths ? `every ${r.everyMonths} mo` : null].filter(Boolean).join(' or ') || r.note} {r.why && r.state !== 'unset' ? `· ${r.why}` : ''}{r.lastDone ? ` · last ${new Date(r.lastDone.at).toLocaleDateString()}` : ''}</span></div>
              <div class="row"><span class={`tag ${STATE_TAG[r.state]}`}>{STATE_LABEL[r.state]}</span><button class="btn sm" type="button" onClick={() => void done(r)}>Done today</button></div>
            </div>
          ))}
        </div>
      )}
      <h3 class="sub" style="margin:var(--s05) 0 0">Log</h3>
      <div class="tblwrap"><table class="mtable"><thead><tr><th>Date</th><th>Item</th><th>Odometer</th><th>Cost</th><th>Shop</th><th>Note</th><th>Receipt</th><th /></tr></thead>
        <tbody>{m.log.map((e) => <LogRow e={e} onChange={() => void load()} />)}{!m.log.length && <tr><td colSpan={8} class="dimtxt">Nothing logged yet.</td></tr>}</tbody></table></div>
      <h3 class="sub" style="margin:var(--s05) 0 0">Tire pressure history</h3>
      <TpmsGraph />
    </div>
  );
}

function LogRow({ e, onChange }: { e: MaintEntry; onChange: () => void }) {
  const attach = async (f: File | undefined) => { if (!f) return; try { await upload(`/api/maintenance/log/${e.id}/receipt`, f); toast('Receipt saved'); onChange(); } catch (x) { toast(`Not saved: ${errText(x)}`); } };
  return (
    <tr>
      <td class="num">{new Date(e.date).toLocaleDateString()}</td><td>{e.item}</td>
      <td class="n">{e.odometer ?? '—'}</td><td class="n">{e.cost !== null ? `$${e.cost.toFixed(2)}` : '—'}</td>
      <td>{e.shop ?? ''}</td><td>{e.note ?? ''}</td>
      <td>{e.receipt ? <a href={`/api/maintenance/receipts/${e.receipt}`} target="_blank" rel="noopener">view</a> : <label class="btn sm">Add<input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(x) => void attach((x.target as HTMLInputElement).files?.[0])} /></label>}</td>
      <td><button class="btn sm danger" type="button" onClick={async () => { if (!confirm(`Delete "${e.item}" on ${new Date(e.date).toLocaleDateString()}?`)) return; await api(`/api/maintenance/log/${e.id}`, { method: 'DELETE' }); onChange(); }}>Delete</button></td>
    </tr>
  );
}

function LogForm({ m, onDone }: { m: MaintResp; onDone: () => void }) {
  const [f, setF] = useState({ date: new Date().toLocaleDateString('en-CA'), reminderId: '', item: '', odometer: m.odometer !== null ? String(Math.round(m.odometer)) : '', cost: '', shop: '', note: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const e = await post<MaintEntry>('/api/maintenance/log', { date: f.date, reminderId: f.reminderId || null, item: f.item || undefined, odometer: f.odometer || null, cost: f.cost || null, shop: f.shop, note: f.note });
      if (file) await upload(`/api/maintenance/log/${e.id}/receipt`, file);
      toast('Logged'); onDone();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const inp = (k: keyof typeof f, label: string, type = 'text', extra: Record<string, unknown> = {}) => <label class="f"><span>{label}</span><input type={type} value={f[k]} onInput={(e) => set(k, (e.target as HTMLInputElement).value)} {...extra} /></label>;
  return (
    <div class="card" style="background:var(--panel-2)">
      <div class="fields form">
        {inp('date', 'Date', 'date')}
        <label class="f"><span>Reminder (resets it)</span><select value={f.reminderId} onChange={(e) => set('reminderId', (e.target as HTMLSelectElement).value)}><option value="">none / other</option>{m.reminders.map((r) => <option value={r.id}>{r.name}</option>)}</select></label>
        {inp('item', 'Item', 'text', { placeholder: m.reminders.find((r) => r.id === f.reminderId)?.name ?? 'e.g. New tires' })}
        {inp('odometer', 'Odometer', 'number', { inputMode: 'numeric' })}
        {inp('cost', 'Cost $', 'number', { step: '0.01', inputMode: 'decimal' })}
        {inp('shop', 'Shop')}
      </div>
      {inp('note', 'Note')}
      <label class="f"><span>Receipt photo (optional)</span><input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} /></label>
      <div class="row"><button class="btn primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>{err && <span class="err">{err}</span>}</div>
    </div>
  );
}

function ReminderEditor({ m, onSaved }: { m: MaintResp; onSaved: (m: MaintResp) => void }) {
  const [list, setList] = useState(m.reminders.map((r) => ({ id: r.id, name: r.name, everyMiles: r.everyMiles === null ? '' : String(r.everyMiles), everyMonths: r.everyMonths === null ? '' : String(r.everyMonths), note: r.note })));
  const [notify, setNotify] = useState(m.notifyService ?? '');
  const [err, setErr] = useState<string | null>(null);
  const setI = (i: number, p: Partial<(typeof list)[number]>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    try {
      await put('/api/maintenance/notify', { service: notify || null });
      onSaved(await put<MaintResp>('/api/maintenance/reminders', { reminders: list.map((x) => ({ ...x, id: x.id || undefined, everyMiles: x.everyMiles || null, everyMonths: x.everyMonths || null })) }));
    } catch (e) { setErr(errText(e)); }
  };
  return (
    <div class="form">
      <p class="help">Intervals start empty on purpose: set each from the Slate owner's manual (not published yet). Whichever comes first, miles or months.</p>
      <table class="tou"><tbody>{list.map((r, i) => (
        <tr>
          <td><input type="text" value={r.name} onInput={(e) => setI(i, { name: (e.target as HTMLInputElement).value })} /></td>
          <td><input type="number" placeholder="miles" value={r.everyMiles} style="width:110px" onInput={(e) => setI(i, { everyMiles: (e.target as HTMLInputElement).value })} /></td>
          <td><input type="number" placeholder="months" value={r.everyMonths} style="width:100px" onInput={(e) => setI(i, { everyMonths: (e.target as HTMLInputElement).value })} /></td>
          <td><input type="text" value={r.note} placeholder="source, e.g. Owner's manual p. 212" onInput={(e) => setI(i, { note: (e.target as HTMLInputElement).value })} /></td>
          <td><button class="btn sm danger" type="button" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button></td>
        </tr>))}</tbody></table>
      <div><button class="btn sm" type="button" onClick={() => setList([...list, { id: '', name: '', everyMiles: '', everyMonths: '', note: "Set from the owner's manual" }])}>+ Add reminder</button></div>
      <label class="f"><span>Home Assistant notify service (optional)</span><input type="text" value={notify} placeholder="mobile_app_jeffs_iphone" onInput={(e) => setNotify((e.target as HTMLInputElement).value)} /></label>
      <p class="help">When set, a due item sends one phone notification a day (9:00–21:00) through HA. The "Maintenance due" sensor is in HA either way.</p>
      <div class="row"><button class="btn primary" type="button" onClick={() => void save()}>Save reminders</button>{err && <span class="err">{err}</span>}</div>
    </div>
  );
}

const WHEELS = ['fl', 'fr', 'rl', 'rr'] as const;
const WHEEL_NAME: Record<string, string> = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };

export function TpmsGraph() {
  const [days, setDays] = useState(30);
  const [h, setH] = useState<Record<string, TpmsPoint[]> | null>(null);
  useEffect(() => { void api<Record<string, TpmsPoint[]>>(`/api/tpms/history${qs({ days })}`).then(setH).catch(() => setH(null)); }, [days]);
  const pts = h ? WHEELS.flatMap((w) => h[w].filter((p) => p.psi !== null)) : [];
  const W = 1000, H = 220, pad = 34;
  const t0 = Date.now() - days * 86_400_000, t1 = Date.now();
  const lo = pts.length ? Math.floor(Math.min(...pts.map((p) => p.psi!)) - 2) : 25, hi = pts.length ? Math.ceil(Math.max(...pts.map((p) => p.psi!)) + 2) : 45;
  const x = (t: string) => pad + ((Date.parse(t) - t0) / (t1 - t0)) * (W - pad - 6);
  const y = (v: number) => H - 20 - ((v - lo) / Math.max(1, hi - lo)) * (H - 30);
  return (
    <div class="tpms">
      <div class="row wrap"><select value={days} style="width:auto" onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>{[7, 30, 90, 365].map((d) => <option value={d}>Last {d} days</option>)}</select>
        <div class="legend">{WHEELS.map((w) => <span><i class={`w-${w}`} style={`background:var(--${w === 'fl' ? 'accent' : w === 'fr' ? 'ok' : w === 'rl' ? 'warn' : 'fg'})`} />{WHEEL_NAME[w]}</span>)}</div></div>
      {!pts.length ? <p class="dimtxt">No tire readings yet. They're recorded from the truck box's BLE TPMS sensors (every 10 min, or on a 0.5 psi change).</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tire pressure over time">
          {[lo, (lo + hi) / 2, hi].map((v) => <g><line class="ax" x1={pad} x2={W} y1={y(v)} y2={y(v)} /><text x={2} y={y(v) + 4}>{v.toFixed(0)}</text></g>)}
          {WHEELS.map((w) => <polyline class={`w-${w}`} points={h![w].filter((p) => p.psi !== null).map((p) => `${x(p.t).toFixed(1)},${y(p.psi!).toFixed(1)}`).join(' ')} />)}
          <text x={pad} y={H - 4}>{new Date(t0).toLocaleDateString()}</text><text x={W - 90} y={H - 4}>now</text>
        </svg>
      )}
    </div>
  );
}

// ---- Drive card + layout widget ------------------------------------------------

type Due = { odometer: number | null; items: ReminderStatus[] };
const DISMISS = 'slate.maintDue.dismissed';

function useDue(): Due | null {
  const [d, setD] = useState<Due | null>(null);
  useEffect(() => { const f = () => api<Due>('/api/maintenance/due').then(setD).catch(() => {}); void f(); const id = setInterval(f, 10 * 60_000); return () => clearInterval(id); }, []);
  return d;
}

/** A small card on the Drive view when something is due (or soon). "Later" hides it until tomorrow. */
export function DueCard({ onOpen }: { onOpen: () => void }) {
  const d = useDue();
  const [, force] = useState(0);
  let dismissed = '';
  try { dismissed = localStorage.getItem(DISMISS) ?? ''; } catch { /* private mode */ }
  const items = d?.items ?? [];
  const key = `${new Date().toDateString()}|${items.map((i) => `${i.id}:${i.state}`).join(',')}`;
  if (!items.length || dismissed === key) return null;
  const due = items.some((i) => i.state === 'due');
  return (
    <div class={`card duecard ${due ? 'due' : ''}`} role="status">
      <span class="lbl">Maintenance {due ? 'due' : 'coming up'}</span>
      {items.slice(0, 3).map((i) => <div class="row between"><b style="font-size:var(--fs-section)">{i.name}</b><span class={`tag ${STATE_TAG[i.state]}`}>{i.why}</span></div>)}
      <div class="row"><button class="btn primary" type="button" onClick={onOpen}>Open</button><button class="btn" type="button" onClick={() => { try { localStorage.setItem(DISMISS, key); } catch { /* */ } force((n) => n + 1); }}>Later</button></div>
    </div>
  );
}

/** Layout widget "maintenance". */
export function MaintWidget() {
  const d = useDue();
  const items = d?.items ?? [];
  return (
    <div class="card">
      <span class="lbl">Maintenance</span>
      {!d ? <span class="dimtxt">—</span> : !items.length ? <span class="dimtxt">Nothing due</span> : items.slice(0, 3).map((i) => <div class="row between"><span>{i.name}</span><span class={`tag ${STATE_TAG[i.state]}`}>{STATE_LABEL[i.state]}</span></div>)}
    </div>
  );
}
