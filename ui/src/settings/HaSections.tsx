// /settings sections that lean on Home Assistant: gas prices, phone history
// import, and the saved places list.
import { useEffect, useState } from 'preact/hooks';
import { api, type GasSensor, type GasStatus, type ImportJob, type Place, type Settings } from '../lib/brain.ts';
import { fmtDateTime } from '../lib/fmt.ts';

const NOT_CONNECTED = 'Connect Home Assistant on this page first (URL and token above, then Save).';

/** Gas price source; edits the truck draft, saved with the page's Save button. */
export function GasSection({ gas, onChange, haReady }: { gas: Settings['gas']; onChange: (g: Settings['gas']) => void; haReady: boolean }) {
  const [found, setFound] = useState<GasSensor[] | null>(null);
  const [findMsg, setFindMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<GasStatus | null>(null);
  const [entityText, setEntityText] = useState(gas.haEntities.join('\n'));
  useEffect(() => { setEntityText(gas.haEntities.join('\n')); }, [gas.haEntities.join(',')]);
  useEffect(() => { void api<GasStatus>('/api/gas').then(setStatus).catch(() => setStatus(null)); }, [gas.source]);

  const find = async () => {
    setFindMsg('Asking Home Assistant…');
    try { const r = await api<{ entities: GasSensor[]; message: string | null }>('/api/ha/gasbuddy'); setFound(r.entities); setFindMsg(r.message); }
    catch (e) { setFindMsg((e as Error).message); }
  };
  const setEntities = (ids: string[]) => { setEntityText(ids.join('\n')); onChange({ ...gas, haEntities: ids }); };
  const toggle = (id: string, on: boolean) => setEntities(on ? [...new Set([...gas.haEntities, id])] : gas.haEntities.filter((x) => x !== id));

  return (
    <div class="form">
      <div class="row wrap" role="group" aria-label="Gas price source">
        <button type="button" class={`btn sm ${gas.source === 'manual' ? 'primary' : ''}`} onClick={() => onChange({ ...gas, source: 'manual' })}>Typed in</button>
        <button type="button" class={`btn sm ${gas.source === 'ha' ? 'primary' : ''}`} onClick={() => onChange({ ...gas, source: 'ha' })}>GasBuddy via Home Assistant</button>
      </div>
      <div class="fields">
        <label class="f"><span>{gas.source === 'ha' ? 'Fallback $/gal' : 'Gas $/gal'}</span><input type="number" step="0.01" value={gas.manualPrice} onInput={(e) => onChange({ ...gas, manualPrice: Number((e.target as HTMLInputElement).value) })} /></label>
        {gas.source === 'ha' && <label class="f"><span>Several stations</span><select value={gas.pick} onChange={(e) => onChange({ ...gas, pick: (e.target as HTMLSelectElement).value as Settings['gas']['pick'] })}><option value="cheapest">cheapest</option><option value="average">average</option></select></label>}
      </div>
      {gas.source === 'ha' && (
        <>
          {!haReady && <div class="banner">{NOT_CONNECTED}</div>}
          <label class="f"><span>GasBuddy price sensors, one per line</span>
            <textarea style="min-height:90px" value={entityText} placeholder="sensor.shell_baseline_regular_gas" onInput={(e) => { const t = (e.target as HTMLTextAreaElement).value; setEntityText(t); onChange({ ...gas, haEntities: t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) }); }} />
          </label>
          <div class="row wrap">
            <button class="btn sm" type="button" disabled={!haReady} onClick={() => void find()}>Find GasBuddy sensors</button>
            {findMsg && <span class="dimtxt" style="font-size:var(--fs-body-sm)">{findMsg}</span>}
          </div>
          {found && found.length > 0 && (
            <div class="list">
              {found.map((s) => (
                <label class="check" style="justify-content:space-between">
                  <span><input type="checkbox" checked={gas.haEntities.includes(s.entityId)} onChange={(e) => toggle(s.entityId, (e.target as HTMLInputElement).checked)} /> {s.name} <code class="dimtxt" style="font-size:var(--fs-caption)">{s.entityId}</code></span>
                  <span class="num">{s.price !== null ? `$${s.price.toFixed(2)}` : '—'}{s.unit ? ` ${s.unit}` : ''}</span>
                </label>
              ))}
            </div>
          )}
          <p class="help">Prices are read every 30 minutes and one price per day is kept for each grade. The cost comparison prices each trip at its own day's price for the comparison vehicle's fuel (premium or diesel without a matching sensor use the fallback). {status?.today ? `Latest: $${status.today.price.toFixed(2)} ${status.fuel} at ${status.today.station ?? 'a station'}, ${fmtDateTime(status.today.fetchedAt)}.` : status?.message ?? ''}</p>
        </>
      )}
    </div>
  );
}

export function ImportSection({ settings, haReady }: { settings: Settings; haReady: boolean }) {
  const today = new Date();
  const iso = (d: Date) => d.toLocaleDateString('en-CA');
  const named = settings.drivers.filter((d) => !d.guest);
  const [driverId, setDriverId] = useState(named[0]?.id ?? '');
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)));
  const [to, setTo] = useState(iso(today));
  const [job, setJob] = useState<ImportJob | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const poll = () => api<ImportJob | null>('/api/import/phone').then(setJob).catch(() => {});
  useEffect(() => { void poll(); }, []);
  useEffect(() => { if (job?.state !== 'running') return; const id = setInterval(() => void poll(), 1500); return () => clearInterval(id); }, [job?.state]);

  const start = async () => {
    setErr(null);
    try { setJob(await api<ImportJob>('/api/import/phone', { method: 'POST', body: JSON.stringify({ driverId, from, to }) })); }
    catch (e) { setErr((e as Error).message); }
  };
  const d = settings.drivers.find((x) => x.id === driverId);
  const pct = job && job.daysTotal ? Math.round((job.daysDone / job.daysTotal) * 100) : 0;
  return (
    <div class="form">
      <div class="fields">
        <label class="f"><span>Driver</span><select value={driverId} onChange={(e) => setDriverId((e.target as HTMLSelectElement).value)}>{named.map((x) => <option value={x.id}>{x.name}</option>)}</select></label>
      </div>
      <TimelineImport driverId={driverId} driverName={d?.name ?? driverId} />
      <h3 class="sub">From Home Assistant (Life360 or the phone app)</h3>
      {!haReady && <div class="banner">{NOT_CONNECTED}</div>}
      <div class="fields">
        <label class="f"><span>From</span><input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>To</span><input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
      </div>
      <div class="dimtxt" style="font-size:var(--fs-body-sm)">Tracker: <code>{d?.tracker ?? 'none set (add one in Drivers)'}</code></div>
      <div class="row wrap">
        <button class="btn big primary" type="button" disabled={!haReady || !d?.tracker || job?.state === 'running'} onClick={() => void start()}>Import my phone history</button>
        {err && <span class="err">{err}</span>}
      </div>
      {job && (
        <div class={`banner ${job.state === 'done' ? 'ok' : job.state === 'error' ? 'bad' : ''}`}>
          {job.state === 'running' && <>Importing {settings.drivers.find((x) => x.id === job.driverId)?.name ?? job.driverId}'s phone history: day {job.daysDone} of {job.daysTotal} ({pct}%), {job.points} points so far…</>}
          {job.state === 'done' && <>Imported {job.trips} trips and {job.stops} stops from {job.points} points ({job.dropped} dropped: GPS worse than 100 m or no position), {fmtDateTime(job.from)} – {fmtDateTime(job.to)}. Running it again replaces these.</>}
          {job.state === 'error' && <>Import stopped: {job.error}</>}
          {job.state === 'running' && <div class="progress" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></div>}
        </div>
      )}
      <p class="help">Reads the tracker's location history from Home Assistant's recorder, one day at a time, and finds the same trips and stops the truck would. Phone locations are sparse, so routes are straight lines between points and marked "from phone, approximate"; they never count as truck miles.</p>
      <AutoImport />
    </div>
  );
}

/** Nightly: Home Assistant keeps ~10 days of history, so TA copies each night's into its own trips. */
function AutoImport() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void api<{ enabled: boolean }>('/api/import/phone/auto').then((r) => setOn(r.enabled)).catch(() => {}); }, []);
  if (on === null) return null;
  const set = async (v: boolean) => { try { setOn((await api<{ enabled: boolean }>('/api/import/phone/auto', { method: 'PUT', body: JSON.stringify({ enabled: v }) })).enabled); } catch { /* keep */ } };
  return (
    <label class="check"><input type="checkbox" checked={on} onChange={(e) => void set((e.target as HTMLInputElement).checked)} /> Every night, keep each driver's phone history (the last two days) in TA's own trips. Home Assistant deletes it after about 10 days.</label>
  );
}

/** A Google Maps Timeline export: months of real drives, for Trips, WEEK and the busiest-week search. */
function TimelineImport({ driverId, driverName }: { driverId: string; driverName: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    let trips = 0, miles = 0;
    try {
      for (const f of Array.from(files)) {
        const r = await api<{ trips: number; miles: number }>(`/api/import/google-timeline?driver=${encodeURIComponent(driverId)}`, { method: 'POST', body: await f.text() });
        trips += r.trips; miles += r.miles;
      }
      setMsg({ ok: true, text: `Imported ${trips} drives (${Math.round(miles)} mi) for ${driverName}. Trips, WEEK can now find your busiest week.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <div class="form" style="gap:var(--s1)">
      <h3 class="sub">Google Maps Timeline</h3>
      <p class="help">Months of drives at once, each measured along the phone's GPS path. On the phone: Google Maps, your picture, Your Timeline, the ⋮ menu, Export Timeline data, which saves Timeline.json. (An older Google Takeout "Semantic Location History" month file works too.) Pick the file here; importing again replaces {driverName}'s phone trips over the same dates.</p>
      <label class="btn" style="width:max-content">{busy ? 'Importing…' : `Import Timeline for ${driverName}`}
        <input type="file" accept=".json,application/json" multiple disabled={busy} style="display:none" onChange={(e) => void upload((e.target as HTMLInputElement).files)} />
      </label>
      {msg && <div class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</div>}
    </div>
  );
}

export function PlacesSection() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<Place[]>('/api/places').then(setPlaces).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, []);
  const rename = async (p: Place) => {
    const name = prompt('Name', p.name);
    if (!name?.trim()) return;
    try { await api(`/api/places/${p.id}`, { method: 'PUT', body: JSON.stringify({ name }) }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  const remove = async (p: Place) => {
    if (!confirm(`Forget "${p.name}"? Its stops go back to their other names.`)) return;
    try { await api(`/api/places/${p.id}`, { method: 'DELETE' }); await load(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="form">
      {err && <div class="err">{err}</div>}
      {places && !places.length && <div class="dimtxt">No saved places yet. Tap a stop on the Trips view to name it.</div>}
      <div class="list">
        {places?.map((p) => (
          <div class="item row between">
            <div><b>{p.name}</b> <span class="dimtxt" style="font-size:var(--fs-caption)">{p.visits} visit{p.visits === 1 ? '' : 's'} · {Math.round(p.radiusM)} m{p.lastVisit ? ` · last ${fmtDateTime(p.lastVisit)}` : ''}</span></div>
            <div class="row"><button class="btn sm" type="button" onClick={() => void rename(p)}>Rename</button><button class="btn sm danger" type="button" onClick={() => void remove(p)}>Forget</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
