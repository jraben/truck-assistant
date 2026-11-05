// Year -> Make -> Model -> Options from fueleconomy.gov (through the brain, which
// caches every answer), or a typed-in "Custom" mpg.
import { useEffect, useState } from 'preact/hooks';
import { api, type CompareVehicle } from '../lib/brain.ts';

type Item = { text: string; value: string };
const FUELS: CompareVehicle['fuel'][] = ['regular', 'midgrade', 'premium', 'diesel'];

const menuCache = new Map<string, Item[]>();
async function menu(path: string): Promise<Item[]> {
  const hit = menuCache.get(path);
  if (hit) return hit;
  const r = await api<Item[]>(`/api/vehicles/menu/${path}`);
  menuCache.set(path, r);
  return r;
}

export function vehicleLine(v: CompareVehicle) {
  return `${v.label} · ${v.mpgCity} city / ${v.mpgHighway} hwy / ${v.mpgCombined} combined mpg · ${v.fuel}`;
}

export function VehiclePicker({ value, onChange }: { value: CompareVehicle; onChange: (v: CompareVehicle) => void }) {
  const [mode, setMode] = useState<'lookup' | 'custom'>(value.id === null ? 'custom' : 'lookup');
  const [years, setYears] = useState<Item[]>([]);
  const [makes, setMakes] = useState<Item[]>([]);
  const [models, setModels] = useState<Item[]>([]);
  const [opts, setOpts] = useState<Item[]>([]);
  const [sel, setSel] = useState({ year: '', make: '', model: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = async <T,>(f: () => Promise<T>) => { setErr(null); setBusy(true); try { return await f(); } catch (e) { setErr((e as Error).message); return undefined; } finally { setBusy(false); } };
  useEffect(() => { if (mode === 'lookup' && !years.length) void guard(async () => setYears(await menu('year'))); }, [mode]);

  const pickYear = (year: string) => { setSel({ year, make: '', model: '' }); setMakes([]); setModels([]); setOpts([]); if (year) void guard(async () => setMakes(await menu(`make?year=${encodeURIComponent(year)}`))); };
  const pickMake = (make: string) => { setSel({ ...sel, make, model: '' }); setModels([]); setOpts([]); if (make) void guard(async () => setModels(await menu(`model?year=${encodeURIComponent(sel.year)}&make=${encodeURIComponent(make)}`))); };
  const pickModel = (model: string) => {
    setSel({ ...sel, model }); setOpts([]);
    if (model) void guard(async () => setOpts(await menu(`options?year=${encodeURIComponent(sel.year)}&make=${encodeURIComponent(sel.make)}&model=${encodeURIComponent(model)}`)));
  };
  const pickOption = (id: string) => { if (id) void guard(async () => onChange(await api<CompareVehicle>(`/api/vehicles/${id}`))); };
  const num = (v: string) => Math.max(1, Number(v) || 1);

  return (
    <div class="form" style="gap:8px">
      <div class="dimtxt" style="font-size:14px">Now: <b>{vehicleLine(value)}</b></div>
      <div class="row wrap" role="group" aria-label="How to set the vehicle">
        <button type="button" class={`btn sm ${mode === 'lookup' ? 'primary' : ''}`} onClick={() => setMode('lookup')}>Pick a vehicle</button>
        <button type="button" class={`btn sm ${mode === 'custom' ? 'primary' : ''}`} onClick={() => setMode('custom')}>Custom mpg</button>
      </div>
      {mode === 'lookup' ? (
        <div class="fields">
          <label class="f"><span>Year</span><select value={sel.year} onChange={(e) => pickYear((e.target as HTMLSelectElement).value)}><option value="">—</option>{years.map((y) => <option value={y.value}>{y.text}</option>)}</select></label>
          <label class="f"><span>Make</span><select value={sel.make} disabled={!makes.length} onChange={(e) => pickMake((e.target as HTMLSelectElement).value)}><option value="">—</option>{makes.map((y) => <option value={y.value}>{y.text}</option>)}</select></label>
          <label class="f"><span>Model</span><select value={sel.model} disabled={!models.length} onChange={(e) => pickModel((e.target as HTMLSelectElement).value)}><option value="">—</option>{models.map((y) => <option value={y.value}>{y.text}</option>)}</select></label>
          <label class="f"><span>Engine / transmission</span><select value="" disabled={!opts.length} onChange={(e) => pickOption((e.target as HTMLSelectElement).value)}><option value="">—</option>{opts.map((y) => <option value={y.value}>{y.text}</option>)}</select></label>
        </div>
      ) : (
        <div class="fields">
          <label class="f"><span>Label</span><input type="text" value={value.id === null ? value.label : 'Custom'} onInput={(e) => onChange({ ...value, id: null, label: (e.target as HTMLInputElement).value || 'Custom' })} /></label>
          <label class="f"><span>City mpg</span><input type="number" step="0.5" value={value.mpgCity} onInput={(e) => onChange({ ...value, id: null, mpgCity: num((e.target as HTMLInputElement).value) })} /></label>
          <label class="f"><span>Highway mpg</span><input type="number" step="0.5" value={value.mpgHighway} onInput={(e) => onChange({ ...value, id: null, mpgHighway: num((e.target as HTMLInputElement).value) })} /></label>
          <label class="f"><span>Combined mpg</span><input type="number" step="0.5" value={value.mpgCombined} onInput={(e) => onChange({ ...value, id: null, mpgCombined: num((e.target as HTMLInputElement).value) })} /></label>
          <label class="f"><span>Fuel</span><select value={value.fuel} onChange={(e) => onChange({ ...value, id: null, fuel: (e.target as HTMLSelectElement).value as CompareVehicle['fuel'] })}>{FUELS.map((f) => <option value={f}>{f}</option>)}</select></label>
        </div>
      )}
      {busy && <span class="dimtxt" style="font-size:13px">Asking fueleconomy.gov…</span>}
      {err && <span class="err">{err}</span>}
      <p class="help">Vehicle data: fueleconomy.gov (US DOE/EPA). City mpg is used for city miles and highway mpg for highway miles once trips record that split; until then, combined.</p>
    </div>
  );
}
