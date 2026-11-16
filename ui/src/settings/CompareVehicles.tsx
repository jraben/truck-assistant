// "Also compare with": the extra gas vehicles every week simulation is set
// against (besides the driver's own compare vehicle). Several can be kept, each
// edited in place (mpg, fuel, tank) or removed. Stored on the brain
// (GET/PUT /api/trips/week-vehicles), so Settings and Trips, WEEK show the same list.
import { useEffect, useState } from 'preact/hooks';
import { api, type CompareVehicle } from '../lib/brain.ts';
import { VehiclePicker, vehicleLine } from './VehiclePicker.tsx';

const MAX = 6;
const BLANK: CompareVehicle = { id: null, label: 'Custom', mpgCity: 20, mpgHighway: 28, mpgCombined: 23, fuel: 'regular' };

export function CompareVehicles({ onChanged }: { onChanged?: () => void }) {
  const [list, setList] = useState<CompareVehicle[] | null>(null);
  // Which one is open: an index into the list, 'new' for one being added, or null.
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<CompareVehicle>(BLANK);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<CompareVehicle[]>('/api/trips/week-vehicles').then(setList).catch((e) => { setList([]); setErr((e as Error).message); }); }, []);

  const save = async (next: CompareVehicle[], what: string) => {
    setErr(null); setSaved(null); setBusy(true);
    try {
      setList(await api<CompareVehicle[]>('/api/trips/week-vehicles', { method: 'PUT', body: JSON.stringify(next) }));
      setOpen(null); setSaved(what); onChanged?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const edit = (i: number | 'new') => { setErr(null); setSaved(null); setDraft(i === 'new' ? BLANK : { ...(list ?? [])[i] }); setOpen(i); };
  const items = list ?? [];
  const name = (v: CompareVehicle) => vehicleLine(v).split(' · ')[0];

  return (
    <div class="form" style="gap:var(--s1)">
      {list && !items.length && open !== 'new' && <p class="help" style="margin:0">None yet. Add the other cars you'd otherwise drive, and each week simulation compares all of them.</p>}
      <div class="list">
        {items.map((v, i) => (
          <div class="item" style="display:grid;gap:var(--s1)">
            <div class="row between wrap" style="gap:var(--s1)">
              <div style="min-width:0"><b>{v.label}</b> <span class="dimtxt" style="font-size:var(--fs-caption)">{v.mpgCity} city / {v.mpgHighway} hwy mpg · {v.fuel} · {v.tankGal ? `${v.tankGal} gal tank` : 'tank estimated'}</span></div>
              {open !== i && <div class="row" style="gap:var(--s1)">
                <button type="button" class="btn sm" onClick={() => edit(i)}>Edit</button>
                <button type="button" class="btn sm danger" disabled={busy} onClick={() => void save(items.filter((_, j) => j !== i), `Removed ${v.label}.`)}>Remove</button>
              </div>}
            </div>
            {open === i && (
              <>
                <VehiclePicker value={draft} onChange={setDraft} />
                <div class="row" style="gap:var(--s1)">
                  <button type="button" class="btn primary sm" disabled={busy} onClick={() => void save(items.map((x, j) => (j === i ? draft : x)), `Saved ${name(draft)}.`)}>Save {name(draft)}</button>
                  <button type="button" class="btn sm" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {open === 'new' ? (
        <div class="item" style="display:grid;gap:var(--s1)">
          <VehiclePicker value={draft} onChange={setDraft} />
          <div class="row" style="gap:var(--s1)">
            <button type="button" class="btn primary sm" disabled={busy} onClick={() => void save([...items, draft], `Added ${name(draft)}.`)}>Add {name(draft)}</button>
            <button type="button" class="btn sm" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        list && items.length < MAX && <button type="button" class="btn sm" style="width:max-content" onClick={() => edit('new')}>+ Add a vehicle</button>
      )}
      {saved && <div class="okmsg">{saved}</div>}
      {err && <div class="err">{err}</div>}
    </div>
  );
}
