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

/**
 * A number box that lets you type freely ("19.", "", "17.5") and only reports a
 * number once the text is one. Writing the parsed number back on every key
 * turned "19." into "19" and threw the cursor to the start ("19.1" -> "119").
 */
export function NumField({ label, value, onChange, min = 0, step = '0.1', placeholder, id }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; step?: string; placeholder?: string; id?: string }) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(shown); }, [shown, editing]);
  const parse = (t: string) => { const n = Number(t); return t.trim() !== '' && Number.isFinite(n) && n >= min ? n : null; };
  return (
    <label class="f"><span>{label}</span>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={text} placeholder={placeholder} data-step={step}
        onFocus={() => setEditing(true)}
        onBlur={() => { setEditing(false); setText(shown); }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value.replace(',', '.');
          setText(t);
          if (t.trim() === '') onChange(null);
          else { const n = parse(t); if (n !== null) onChange(n); }
        }} />
    </label>
  );
}

export function vehicleLine(v: CompareVehicle) {
  return `${v.label} · ${v.mpgCity} city / ${v.mpgHighway} hwy / ${v.mpgCombined} combined mpg · ${v.fuel}${v.tankGal ? ` · ${v.tankGal} gal tank` : ''}`;
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

  return (
    <div class="form" style="gap:var(--s1)">
      <div class="dimtxt" style="font-size:var(--fs-body-sm)">Now: <b>{vehicleLine(value)}</b></div>
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
          <NumField label="City mpg" min={1} value={value.mpgCity} onChange={(n) => { if (n !== null) onChange({ ...value, id: null, mpgCity: n }); }} />
          <NumField label="Highway mpg" min={1} value={value.mpgHighway} onChange={(n) => { if (n !== null) onChange({ ...value, id: null, mpgHighway: n }); }} />
          <NumField label="Combined mpg" min={1} value={value.mpgCombined} onChange={(n) => { if (n !== null) onChange({ ...value, id: null, mpgCombined: n }); }} />
          <label class="f"><span>Fuel</span><select value={value.fuel} onChange={(e) => onChange({ ...value, id: null, fuel: (e.target as HTMLSelectElement).value as CompareVehicle['fuel'] })}>{FUELS.map((f) => <option value={f}>{f}</option>)}</select></label>
        </div>
      )}
      <div style="max-width:200px"><NumField label="Fuel tank, gallons" min={0.1} placeholder="estimate from mpg" value={value.tankGal ?? null} onChange={(n) => onChange({ ...value, tankGal: n })} /></div>
      {busy && <span class="dimtxt" style="font-size:var(--fs-caption)">Asking fueleconomy.gov…</span>}
      {err && <span class="err">{err}</span>}
      <p class="help">Vehicle data: fueleconomy.gov (US DOE/EPA). City mpg is used for city miles and highway mpg for highway miles once trips record that split; until then, combined.</p>
    </div>
  );
}
