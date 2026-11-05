// /settings: the truck as built (tilt drawing), and the Drive screen's settings:
// city/highway range, tilt warnings, heat, brightness, speed limits, and each
// driver's speedometer and over-limit warning. Saves on its own button.
import { useEffect, useState } from 'preact/hooks';
import { defaultDrive, WRAP_COLORS } from '../../../brain/src/drive/settings.ts';
import { SPEEDO_STYLES, type DriverDrive, type DriveSettings, type TruckLook } from '../../../brain/src/drive/types.ts';
import { api, loadSettings, putDriver, settingsStore, stateStore, useStore, type Settings } from '../lib/brain.ts';
import { driverDrive, truckOf } from '../drive/hooks.ts';
import { SPEEDO_LABELS } from '../drive/Speedo.tsx';
import { TruckRear, TruckSide } from '../drive/TruckArt.tsx';
import '../drive/drive.css';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const COLOR_FIELDS: [keyof TruckLook['colors'], string][] = [['body', 'Body wrap'], ['roof', 'Roof wrap'], ['logo', 'Logo decals'], ['wheelDecal', 'Wheel decals'], ['trim', 'Bumpers, flares (unwrapped)']];

function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div class="form" style="gap:6px">
      <span class="lbl">{label}</span>
      <div class="row wrap" style="gap:6px">
        <input type="color" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} aria-label={`${label} colour`} style="width:48px;height:40px;border:0;background:none;padding:0" />
        {WRAP_COLORS.map((c) => (
          <button type="button" title={c.name} aria-label={c.name} aria-pressed={value.toLowerCase() === c.hex} onClick={() => onChange(c.hex)}
            style={{ width: '32px', height: '32px', borderRadius: '50%', background: c.hex, border: value.toLowerCase() === c.hex ? '3px solid var(--accent)' : '1px solid var(--line)' }} />
        ))}
      </div>
    </div>
  );
}

export function DriveSection({ settings }: { settings: Settings }) {
  const state = useStore(stateStore);
  const [truck, setTruck] = useState<TruckLook>(() => structuredClone(truckOf(settings)));
  const [drive, setDrive] = useState<DriveSettings>(() => structuredClone((settings as Settings & { drive?: DriveSettings }).drive ?? defaultDrive()));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setTruck(structuredClone(truckOf(settings))); }, [JSON.stringify(truckOf(settings))]);

  const c = (k: keyof TruckLook['colors'], v: string) => setTruck({ ...truck, colors: { ...truck.colors, [k]: v } });
  const acc = <K extends keyof TruckLook['accessories']>(k: K, v: TruckLook['accessories'][K]) => setTruck({ ...truck, accessories: { ...truck.accessories, [k]: v } });
  const d = <K extends keyof DriveSettings>(k: K, v: DriveSettings[K]) => setDrive({ ...drive, [k]: v });
  const sub = <K extends 'efficiency' | 'tilt' | 'heat' | 'brightness'>(k: K, f: keyof DriveSettings[K], v: number | boolean) => setDrive({ ...drive, [k]: { ...drive[k], [f]: v } });

  const save = async () => {
    setMsg(null);
    try {
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ truck, drive }) });
      settingsStore.set(n);
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const saveDriver = async (id: string, patch: Partial<DriverDrive>, cur: DriverDrive) => {
    try { await putDriver(id, { drive: { ...cur, ...patch } }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); void loadSettings(); }
  };

  const ds = state?.drive;
  const field = (label: string, value: number, on: (v: number) => void, step = 1) => (
    <label class="f"><span>{label}</span><input type="number" step={step} value={value} onInput={(e) => on(num((e.target as HTMLInputElement).value))} /></label>
  );

  return (
    <section class="card" id="drive">
      <h2>Drive screen and the truck</h2>
      <p class="help">How the tilt gauge draws your truck, and how the Drive screen behaves. Truck settings are the truck's; the speedometer and speed warning are each driver's.</p>

      <h3 class="sub">Your truck as built</h3>
      <div class="row wrap" style="gap:24px;align-items:flex-end">
        <div style="width:min(440px,100%)"><TruckSide t={truck} id="set-side" /></div>
        <div style="width:min(180px,40%)"><TruckRear t={truck} id="set-rear" /></div>
      </div>
      <div class="form">
        {COLOR_FIELDS.map(([k, label]) => <ColorPick label={label} value={truck.colors[k]} onChange={(v) => c(k, v)} />)}
        <div class="form" style="gap:6px">
          <span class="lbl">Front lamp plates</span>
          <div class="row wrap">
            <label class="check"><input type="radio" name="lamp" checked={truck.colors.lampPlates === 'synthwave'} onChange={() => c('lampPlates', 'synthwave')} /> Synthwave</label>
            <label class="check"><input type="radio" name="lamp" checked={truck.colors.lampPlates !== 'synthwave'} onChange={() => c('lampPlates', truck.colors.body)} /> A colour</label>
            {truck.colors.lampPlates !== 'synthwave' && <input type="color" value={truck.colors.lampPlates} onInput={(e) => c('lampPlates', (e.target as HTMLInputElement).value)} aria-label="Lamp plate colour" />}
          </div>
        </div>
        <div class="row wrap">
          <label class="f" style="min-width:160px"><span>Wrap finish</span>
            <select value={truck.finish} onChange={(e) => setTruck({ ...truck, finish: (e.target as HTMLSelectElement).value as TruckLook['finish'] })}>
              <option value="satin">Satin</option><option value="gloss">Gloss</option><option value="matte">Matte</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" checked={truck.roofWrap} onChange={(e) => setTruck({ ...truck, roofWrap: (e.target as HTMLInputElement).checked })} /> Roof wrapped separately</label>
          <label class="check"><input type="checkbox" checked={truck.accessories.tonneau === 'nexus-flip'} onChange={(e) => acc('tonneau', (e.target as HTMLInputElement).checked ? 'nexus-flip' : 'none')} /> NEXUS flip-up tonneau</label>
          <label class="check"><input type="checkbox" checked={truck.accessories.hitch} onChange={(e) => acc('hitch', (e.target as HTMLInputElement).checked)} /> 2" hitch receiver</label>
          <label class="check"><input type="checkbox" checked={truck.accessories.bedLights} onChange={(e) => acc('bedLights', (e.target as HTMLInputElement).checked)} /> Bed light kit</label>
        </div>
        <p class="help">17" steel wheels, regular cab. The bed light strip lights up on the drawing when the relay named "Bed lights" is on.</p>
      </div>

      <h3 class="sub">City and highway range</h3>
      <div class="fields form">
        {field('Highway at or over (mph, 2-min average)', drive.highwayMph, (v) => d('highwayMph', v))}
        {field('City mi/kWh (starting point)', drive.efficiency.cityMiPerKwh, (v) => sub('efficiency', 'cityMiPerKwh', v), 0.05)}
        {field('Highway mi/kWh (starting point)', drive.efficiency.highwayMiPerKwh, (v) => sub('efficiency', 'highwayMiPerKwh', v), 0.05)}
        {field('Learning weight (0.01-1)', drive.efficiency.alpha, (v) => sub('efficiency', 'alpha', v), 0.05)}
      </div>
      {ds && <p class="help">Now: city {ds.efficiency.city.toFixed(2)} mi/kWh (learned from {ds.efficiency.learnedMiles.city} mi), highway {ds.efficiency.highway.toFixed(2)} mi/kWh (from {ds.efficiency.learnedMiles.highway} mi). The numbers learn only from real charge readings (CAN); until then they stay at the starting points. Trips record miles per mode, and the gas comparison prices them at city and highway mpg.</p>}

      <h3 class="sub">Tilt, heat, brightness</h3>
      <div class="fields form">
        {field('Tilt warning (°)', drive.tilt.warnDeg, (v) => sub('tilt', 'warnDeg', v))}
        {field('Tilt danger (°)', drive.tilt.dangerDeg, (v) => sub('tilt', 'dangerDeg', v))}
        {field('Pi: calm animations at (°C)', drive.heat.throttleC, (v) => sub('heat', 'throttleC', v))}
        {field('Pi: warn at (°C)', drive.heat.warnC, (v) => sub('heat', 'warnC', v))}
        {field('Pi: power off at (°C)', drive.heat.shutdownC, (v) => sub('heat', 'shutdownC', v))}
        {field('Parked-in-sun warning, cabin (°F)', drive.heat.parkedSunF, (v) => sub('heat', 'parkedSunF', v))}
        {field('Brightness min %', drive.brightness.minPct, (v) => sub('brightness', 'minPct', v))}
        {field('Brightness max %', drive.brightness.maxPct, (v) => sub('brightness', 'maxPct', v))}
        {field('After sunset, at most %', drive.brightness.nightMaxPct, (v) => sub('brightness', 'nightMaxPct', v))}
        {field('Manual brightness %', drive.brightness.manualPct, (v) => sub('brightness', 'manualPct', v))}
      </div>
      <div class="row wrap">
        <label class="check"><input type="checkbox" checked={drive.brightness.auto} onChange={(e) => sub('brightness', 'auto', (e.target as HTMLInputElement).checked)} /> Auto brightness (light sensor)</label>
        <label class="check"><input type="checkbox" checked={drive.speedLimits} onChange={(e) => d('speedLimits', (e.target as HTMLInputElement).checked)} /> Speed limits from OpenStreetMap</label>
        <label class="f" style="width:220px"><span>Pause video and lists over (mph)</span><input type="number" value={drive.lockoutMph} onInput={(e) => d('lockoutMph', num((e.target as HTMLInputElement).value))} /></label>
      </div>
      {ds && <p class="help">Screen: {ds.brightness.pct ?? '—'}% via {ds.brightness.backend}{ds.brightness.lux !== null ? `, light ${ds.brightness.lux} lux` : ', no light reading'}{ds.brightness.error ? ` (${ds.brightness.error})` : ''}. Pi {ds.heat.cpuC ?? '—'}°C ({ds.heat.source ?? 'no sensor'}). Limits: {ds.speedLimitWhy ?? 'found'}.</p>}

      <div class="row wrap">
        <button class="btn big primary" type="button" onClick={() => void save()}>Save truck and drive settings</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>

      <h3 class="sub">Each driver</h3>
      <div class="list">
        {settings.drivers.map((dr) => {
          const dd = driverDrive(dr);
          return (
            <div class="item row wrap" style="gap:12px">
              <b style="min-width:90px">{dr.name}</b>
              <label class="f" style="min-width:170px"><span>Speedometer</span>
                <select value={dd.speedo} onChange={(e) => void saveDriver(dr.id, { speedo: (e.target as HTMLSelectElement).value as DriverDrive['speedo'] }, dd)}>
                  <option value="auto">Theme's pick</option>
                  {SPEEDO_STYLES.map((s) => <option value={s}>{SPEEDO_LABELS[s]}</option>)}
                </select>
              </label>
              <label class="check"><input type="checkbox" checked={dd.overLimitWarn} onChange={(e) => void saveDriver(dr.id, { overLimitWarn: (e.target as HTMLInputElement).checked }, dd)} /> Warn over the limit</label>
              <label class="f" style="width:150px"><span>By more than (mph)</span><input type="number" value={dd.overLimitMph} onChange={(e) => void saveDriver(dr.id, { overLimitMph: num((e.target as HTMLInputElement).value) }, dd)} /></label>
            </div>
          );
        })}
      </div>
      <p class="help">"Theme's pick" follows the theme: Bel Air brings the '57 speedometer, the rest use Digital. The limit is OpenStreetMap's, so it can be missing or out of date.</p>
    </section>
  );
}
