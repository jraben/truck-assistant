// Business mileage log: tag trips (one or many), export for the IRS. Same
// component on the cockpit (Logs) and in the settings portal (phone).
import { useEffect, useState } from 'preact/hooks';
import { api, settingsStore, toast, useStore, type Place } from '../lib/brain.ts';
import { fmtTime } from '../lib/fmt.ts';
import { errText, put, qs, PLACE_TAG_LIST, PURPOSE_LIST, type MileageResp, type MileageRate, type OpsConfig, type Purpose } from './api.ts';
import './ops.css';

const SRC: Record<string, string> = { manual: 'by hand', place: 'saved place', feed: 'client (places feed)', driver: 'driver default' };

export function PurposeTag({ p, src }: { p: Purpose | null; src?: string | null }) {
  return <span class={`ptag ${p ?? 'none'}`} title={src ? `Tagged: ${SRC[src] ?? src}` : 'Not tagged yet'}>{p ?? 'untagged'}{src && src !== 'manual' ? ' · auto' : ''}</span>;
}

export function MileageView({ compact = false }: { compact?: boolean }) {
  const settings = useStore(settingsStore);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [driver, setDriver] = useState('');
  const [purpose, setPurpose] = useState('');
  const [data, setData] = useState<MileageResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [noteEdit, setNoteEdit] = useState<{ id: number; text: string } | null>(null);

  const query = qs({ year, driver, purpose });
  const load = async () => { try { setData(await api<MileageResp>(`/api/mileage${query}`)); setErr(null); } catch (e) { setErr(errText(e)); } };
  useEffect(() => { void load(); setSel(new Set()); }, [query]);

  const tag = async (ids: number[], body: { purpose?: Purpose | null; note?: string }) => {
    if (!ids.length) return;
    try { const r = await put<{ changed: number }>('/api/mileage/tags', { tripIds: ids, ...body }); toast(`${r.changed} trip${r.changed === 1 ? '' : 's'} updated`); setSel(new Set()); await load(); }
    catch (e) { toast(`Not saved: ${errText(e)}`); }
  };
  const toggle = (id: number) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const rows = data?.rows ?? [];
  const years = Array.from({ length: 4 }, (_, i) => String(new Date().getFullYear() - i));
  const t = data?.totals;

  return (
    <div class="form" style="gap:10px">
      <div class="row wrap">
        <select value={year} onChange={(e) => setYear((e.target as HTMLSelectElement).value)} style="width:auto"><option value="">All years</option>{years.map((y) => <option value={y}>{y}</option>)}</select>
        <select value={driver} onChange={(e) => setDriver((e.target as HTMLSelectElement).value)} style="width:auto"><option value="">Every driver</option>{settings?.drivers.map((d) => <option value={d.id}>{d.name}</option>)}</select>
        <select value={purpose} onChange={(e) => setPurpose((e.target as HTMLSelectElement).value)} style="width:auto"><option value="">Every purpose</option>{PURPOSE_LIST.map((p) => <option value={p}>{p}</option>)}<option value="untagged">untagged</option></select>
        <span class="grow" />
        <a class="btn sm" href={`/api/mileage/export.csv${query}`} download>CSV</a>
        <a class="btn sm" href={`/api/mileage/export.html${query}`} target="_blank" rel="noopener">Printable</a>
      </div>
      {err && <div class="err">{err}</div>}
      {t && (
        <div class="statline">
          <span><span class="lbl">Business</span> <b>{t.businessMiles.toFixed(1)}</b> mi</span>
          <span><span class="lbl">Deduction</span> <b>${t.deduction.toFixed(2)}</b></span>
          <span><span class="lbl">All</span> {t.miles.toFixed(1)} mi · {t.trips} trips</span>
          {t.untaggedTrips > 0 && <span class="tag warn">{t.untaggedTrips} untagged</span>}
          <span class="dimtxt" style="font-size:13px">Odometer {data?.odometerNow !== null && data?.odometerNow !== undefined ? `≈ ${data.odometerNow.toFixed(0)} (estimated)` : 'not set: add a reading in Mileage settings'}</span>
        </div>
      )}
      <div class="tblwrap" style={compact ? 'max-height:420px' : ''}>
        <table class="mtable">
          <thead><tr>
            <th><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && sel.size === rows.length} onChange={(e) => setSel((e.target as HTMLInputElement).checked ? new Set(rows.map((r) => r.tripId)) : new Set())} /></th>
            <th>Date</th><th>Driver</th><th>From → to</th><th>Miles</th><th>Purpose</th><th>Business purpose / note</th><th>Odometer</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr class={sel.has(r.tripId) ? 'sel' : ''}>
                <td><input type="checkbox" aria-label={`Select trip ${r.tripId}`} checked={sel.has(r.tripId)} onChange={() => toggle(r.tripId)} /></td>
                <td class="num">{r.date} <span class="dimtxt">{fmtTime(r.startedAt)}</span></td>
                <td>{r.driver}</td>
                <td>{r.from || '—'} → {r.to || '—'}</td>
                <td class="n">{r.miles.toFixed(1)}{r.approximate && <span class="tag dim" title="Replayed from a phone's location history: approximate" style="margin-left:6px">phone</span>}</td>
                <td><PurposeTag p={r.purpose} src={r.purposeSource} /></td>
                <td>{noteEdit?.id === r.tripId
                  ? <input class="note" type="text" value={noteEdit.text} autoFocus placeholder="e.g. Site visit, Smith job" onInput={(e) => setNoteEdit({ id: r.tripId, text: (e.target as HTMLInputElement).value })} onBlur={() => { void tag([r.tripId], { note: noteEdit.text }); setNoteEdit(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  : <button type="button" class="btn sm" style="text-transform:none;letter-spacing:0;font-family:var(--body)" onClick={() => setNoteEdit({ id: r.tripId, text: r.note ?? '' })}>{r.note || '+ note'}</button>}</td>
                <td class="n dimtxt">{r.startOdometer !== null ? `${r.startOdometer.toFixed(0)}–${r.endOdometer?.toFixed(0)}` : '—'}</td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={8} class="dimtxt">No trips here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div class="bulkbar">
        <span class="lbl">{sel.size ? `${sel.size} selected` : 'Select trips, then'}</span>
        {PURPOSE_LIST.map((p) => <button class="btn" type="button" disabled={!sel.size} onClick={() => void tag([...sel], { purpose: p })}>{p}</button>)}
        <button class="btn" type="button" disabled={!sel.size} title="Clear the hand-set purpose; the rules decide again" onClick={() => void tag([...sel], { purpose: null })}>Auto</button>
        <button class="btn sm" type="button" onClick={() => setSel(new Set(rows.filter((r) => !r.purpose).map((r) => r.tripId)))}>Select untagged</button>
      </div>
      <p class="help dimtxt" style="font-size:13px;margin:0">Business automatically: trips ending at a client from the places feed, or at a place you tag business/client below. Phone-imported trips are included but flagged approximate. Odometer readings are estimates until the truck's own odometer can be read (CAN).</p>
    </div>
  );
}

/** Mileage rules, odometer anchor and IRS rates. */
export function MileageSettings() {
  const settings = useStore(settingsStore);
  const [cfg, setCfg] = useState<OpsConfig['mileage'] | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [odo, setOdo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { void api<OpsConfig['mileage']>('/api/mileage/config').then(setCfg).catch(() => {}); void api<Place[]>('/api/places').then(setPlaces).catch(() => {}); }, []);
  if (!cfg) return <div class="dimtxt">Loading…</div>;
  const save = async (patch: Partial<OpsConfig['mileage']>) => {
    try { setCfg(await put<OpsConfig['mileage']>('/api/mileage/config', patch)); setMsg({ ok: true, text: 'Saved.' }); } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const setRate = (i: number, p: Partial<MileageRate>) => setCfg({ ...cfg, rates: cfg.rates.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return (
    <div class="form">
      <h3 class="sub">Odometer</h3>
      <p class="help">Until the truck's odometer can be read, enter what the dash says now; trip miles are counted from it. {cfg.odometerAnchor ? `Current reading: ${cfg.odometerAnchor.odometer} on ${new Date(cfg.odometerAnchor.at).toLocaleDateString()}.` : 'Not set yet.'}</p>
      <div class="row wrap">
        <input type="number" inputMode="decimal" placeholder="e.g. 1234" value={odo} style="max-width:200px" onInput={(e) => setOdo((e.target as HTMLInputElement).value)} />
        <button class="btn" type="button" disabled={!odo} onClick={() => { void save({ odometerAnchor: { odometer: Number(odo), at: new Date().toISOString() } }); setOdo(''); }}>Set reading (now)</button>
      </div>
      <h3 class="sub">IRS standard mileage rate</h3>
      <p class="help">Check every year at irs.gov ("standard mileage rates"); the IRS raised 2026's mid-year. Each rate applies from its date until the next one.</p>
      <table class="tou"><tbody>
        {cfg.rates.map((r, i) => (
          <tr>
            <td><input type="date" value={r.from} onInput={(e) => setRate(i, { from: (e.target as HTMLInputElement).value })} /></td>
            <td><input type="number" step="0.5" value={r.centsPerMile} style="width:100px" onInput={(e) => setRate(i, { centsPerMile: Number((e.target as HTMLInputElement).value) })} /></td>
            <td class="dimtxt">¢/mi</td>
            <td><input type="text" value={r.source} onInput={(e) => setRate(i, { source: (e.target as HTMLInputElement).value })} /></td>
            <td><button class="btn sm danger" type="button" onClick={() => setCfg({ ...cfg, rates: cfg.rates.filter((_, j) => j !== i) })}>Remove</button></td>
          </tr>
        ))}
      </tbody></table>
      <div class="row wrap">
        <button class="btn sm" type="button" onClick={() => setCfg({ ...cfg, rates: [...cfg.rates, { from: `${new Date().getFullYear() + 1}-01-01`, centsPerMile: 0, source: 'IRS notice for the year' }] })}>+ Add rate</button>
        <button class="btn sm primary" type="button" onClick={() => void save({ rates: cfg.rates })}>Save rates</button>
      </div>
      <h3 class="sub">Auto-tagging</h3>
      <label class="check"><input type="checkbox" checked={cfg.feedIsBusiness} onChange={(e) => void save({ feedIsBusiness: (e.target as HTMLInputElement).checked })} /> Trips ending at a places-feed location (client records) are business</label>
      <div class="fields form">
        {settings?.drivers.map((d) => (
          <label class="f"><span>{d.name}: default</span>
            <select value={cfg.driverDefaults[d.id] ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; const dd = { ...cfg.driverDefaults }; if (v) dd[d.id] = v as Purpose; else delete dd[d.id]; void save({ driverDefaults: dd }); }}>
              <option value="">untagged</option>{PURPOSE_LIST.map((p) => <option value={p}>{p}</option>)}
            </select>
          </label>
        ))}
      </div>
      {places.length > 0 && <>
        <p class="help">Saved places: a trip ending at one tagged business or client is business.</p>
        <div class="fields form">
          {places.map((p) => (
            <label class="f"><span>{p.name}</span>
              <select value={cfg.placeTags[String(p.id)] ?? ''} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; const pt = { ...cfg.placeTags }; if (v) pt[String(p.id)] = v as never; else delete pt[String(p.id)]; void save({ placeTags: pt }); }}>
                <option value="">no tag</option>{PLACE_TAG_LIST.map((t) => <option value={t}>{t}</option>)}
              </select>
            </label>
          ))}
        </div>
      </>}
      {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
    </div>
  );
}

/** Layout widget "mileage": this year's business miles at a glance. */
export function MileageWidget({ go }: { go?: (v: string) => void }) {
  const [d, setD] = useState<MileageResp | null>(null);
  useEffect(() => { const f = () => api<MileageResp>(`/api/mileage${qs({ year: new Date().getFullYear() })}`).then(setD).catch(() => {}); void f(); const id = setInterval(f, 5 * 60_000); return () => clearInterval(id); }, []);
  void go;
  return (
    <div class="card">
      <span class="lbl">Business miles · {new Date().getFullYear()}</span>
      <span class="big num">{d ? d.totals.businessMiles.toFixed(0) : '—'}<small>mi</small></span>
      <span class="dimtxt">{d ? `$${d.totals.deduction.toFixed(0)} at the IRS rate · ${d.totals.untaggedTrips} untagged` : ''}</span>
    </div>
  );
}
