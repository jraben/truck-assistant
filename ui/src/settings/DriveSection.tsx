// /settings: the truck as built (tilt drawing), and the Drive screen's settings:
// city/highway range, tilt warnings, heat, brightness, speed limits, and each
// driver's speedometer and over-limit warning. Saves on its own button.
import { useEffect, useState } from 'preact/hooks';
import { defaultDrive, parseSlateShareUrl, WRAP_COLORS } from '../../../brain/src/drive/settings.ts';
import { SPEEDO_STYLES, type DriverDrive, type DriveSettings, type TruckLook } from '../../../brain/src/drive/types.ts';
import { api, loadSettings, putDriver, settingsStore, stateStore, useStore, type Settings } from '../lib/brain.ts';
import { driverDrive, truckOf, truckPhotoUrl } from '../drive/hooks.ts';
import { SPEEDO_LABELS } from '../drive/Speedo.tsx';
import { TruckRear, TruckSide } from '../drive/TruckArt.tsx';
import '../drive/drive.css';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const COLOR_FIELDS: [keyof TruckLook['colors'], string][] = [['body', 'Body wrap'], ['roof', 'Roof wrap'], ['wheelDecal', 'Wheel decal ring'], ['logo', 'SLATE body logo decals'], ['trim', 'Bumpers, flares (unwrapped)']];
const nameOf = (hex: string) => WRAP_COLORS.find((c) => c.hex === hex.toLowerCase())?.name ?? null;

function Swatch({ name, hex, on, onClick }: { name: string; hex: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" title={`${name} (approximate)`} aria-label={name} aria-pressed={on} onClick={onClick}
      style={{ width: '32px', height: '32px', borderRadius: '50%', background: hex, border: on ? '3px solid var(--accent)' : '1px solid var(--line)' }} />
  );
}

function ColorPick({ label, value, onChange, allowNone }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const none = value === 'none';
  return (
    <div class="form" style="gap:var(--s1)">
      <span class="lbl">{label}: <b style="color:var(--fg)">{none ? 'None' : nameOf(value) ?? value}</b></span>
      <div class="row wrap" style="gap:var(--s1)">
        {allowNone && <button type="button" class={`btn sm ${none ? 'primary' : ''}`} aria-pressed={none} onClick={() => onChange('none')}>None</button>}
        <input type="color" value={none ? '#1c1d1f' : value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} aria-label={`${label} colour`} style="width:48px;height:40px;border:0;background:none;padding:0" />
        {WRAP_COLORS.map((c) => <Swatch name={c.name} hex={c.hex} on={value.toLowerCase() === c.hex} onClick={() => onChange(c.hex)} />)}
      </div>
    </div>
  );
}

function NamePick({ label, value, onChange, noneLabel }: { label: string; value: string; onChange: (v: string) => void; noneLabel?: string }) {
  return (
    <div class="form" style="gap:var(--s1)">
      <span class="lbl">{label}: <b style="color:var(--fg)">{value === 'none' ? noneLabel ?? 'None' : value}</b></span>
      <div class="row wrap" style="gap:var(--s1)">
        {noneLabel && <button type="button" class={`btn sm ${value === 'none' ? 'primary' : ''}`} aria-pressed={value === 'none'} onClick={() => onChange('none')}>{noneLabel}</button>}
        {WRAP_COLORS.map((c) => <Swatch name={c.name} hex={c.hex} on={value === c.name} onClick={() => onChange(c.name)} />)}
      </div>
    </div>
  );
}

/** The truck photo: preview, upload, from an image URL, remove. Saves straight away (its own route). */
function PhotoBox({ settings }: { settings: Settings }) {
  const t = truckOf(settings);
  const src = truckPhotoUrl(t);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (what: string, f: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await f(); await loadSettings(); setMsg({ ok: true, text: what }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 6 * 1024 * 1024) { setMsg({ ok: false, text: 'That photo is over 6 MB.' }); return; }
    void run('Photo saved.', () => api('/api/vehicle/photo', { method: 'POST', body: f, headers: { 'content-type': f.type || 'application/octet-stream' } }));
  };
  const https = /^https:\/\//i.test(url.trim());
  return (
    <div class="form photobox" style="gap:var(--s1)">
      <span class="lbl">Photo of your truck</span>
      <div class="photoframe">{src ? <img src={src} alt="Your truck" /> : <span class="dimtxt">No photo yet. The Drive screen shows it while parked; without one it shows the drawing.</span>}</div>
      <div class="row wrap" style="gap:var(--s1)">
        <label class="btn sm" style="cursor:pointer">Upload…
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { const i = e.target as HTMLInputElement; upload(i.files?.[0]); i.value = ''; }} />
        </label>
        {src && <button class="btn sm danger" type="button" disabled={busy} onClick={() => void run('Photo removed.', () => api('/api/vehicle/photo', { method: 'DELETE' }))}>Remove</button>}
        {t.photo && <span class="dimtxt" style="font-size:var(--fs-caption)">{t.photo.source === 'url' ? 'From a URL' : 'Uploaded'}, {new Date(t.photo.updatedAt).toLocaleDateString()}</span>}
      </div>
      <div class="row wrap" style="gap:var(--s1);align-items:flex-end">
        <label class="f" style="flex:1;min-width:220px"><span>From image URL (https)</span><input type="url" value={url} placeholder="https://…/truck.jpg" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
        <button class="btn sm" type="button" disabled={busy || !https} onClick={() => void run('Photo saved.', async () => { await api('/api/vehicle/photo', { method: 'POST', body: JSON.stringify({ url: url.trim() }) }); setUrl(''); })}>Fetch</button>
      </div>
      <p class="help">JPEG, PNG or WebP, up to 6 MB. Kept on the truck only.</p>
      {busy ? <span class="dimtxt">Working…</span> : msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
    </div>
  );
}

export function DriveSection({ settings }: { settings: Settings }) {
  const state = useStore(stateStore);
  const [truck, setTruck] = useState<TruckLook>(() => structuredClone(truckOf(settings)));
  const [drive, setDrive] = useState<DriveSettings>(() => structuredClone((settings as Settings & { drive?: DriveSettings }).drive ?? defaultDrive()));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A photo change (its own route) must not throw away unsaved colour edits.
  useEffect(() => { setTruck(structuredClone(truckOf(settings))); }, [JSON.stringify({ ...truckOf(settings), photo: null })]);

  const share = truck.slateShareUrl ?? '';
  const shareOk = share.trim() === '' || !!parseSlateShareUrl(share);
  const c =(k: keyof TruckLook['colors'], v: string) => setTruck({ ...truck, colors: { ...truck.colors, [k]: v } });
  const acc = <K extends keyof TruckLook['accessories']>(k: K, v: TruckLook['accessories'][K]) => setTruck({ ...truck, accessories: { ...truck.accessories, [k]: v } });
  const d = <K extends keyof DriveSettings>(k: K, v: DriveSettings[K]) => setDrive({ ...drive, [k]: v });
  const sub = <K extends 'efficiency' | 'tilt' | 'heat' | 'brightness'>(k: K, f: keyof DriveSettings[K], v: number | boolean) => setDrive({ ...drive, [k]: { ...drive[k], [f]: v } });

  const save = async () => {
    setMsg(null);
    try {
      if (!shareOk) throw new Error('The Slate link should look like https://www.slate.auto/share/ABC123');
      const { photo: _photo, ...look } = truck;
      const n = await api<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify({ truck: { ...look, slateShareUrl: share.trim() || null, accessoryList: look.accessoryList.map((x) => x.trim()).filter(Boolean) }, drive }) });
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

      <h3 class="sub">My Slate</h3>
      <div class="myslate">
        <div class="myslate-preview">
          <TruckSide t={truck} id="set-side" />
          <div class="row" style="gap:var(--s2);align-items:flex-end">
            <div style="width:42%"><TruckRear t={truck} id="set-rear" /></div>
            <p class="help" style="flex:1">Live preview of the tilt drawing the Drive screen rotates. Save to keep it.</p>
          </div>
          <PhotoBox settings={settings} />
        </div>
        <div class="form myslate-controls">
          <div class="form" style="gap:var(--s1)">
            <label class="f"><span>My build on slate.auto (share link)</span>
              <input type="url" value={share} placeholder="https://www.slate.auto/share/ABC123" aria-invalid={!shareOk} onInput={(e) => setTruck({ ...truck, slateShareUrl: (e.target as HTMLInputElement).value })} />
            </label>
            {!shareOk && <span class="err">Paste the link from Slate's Share button: https://www.slate.auto/share/ABC123</span>}
            {shareOk && share.trim() && <div><a class="btn sm" href={parseSlateShareUrl(share)!.url} target="_blank" rel="noreferrer noopener">Open my build on slate.auto ↗</a></div>}
          </div>
          {COLOR_FIELDS.map(([k, label]) => <ColorPick label={label} value={truck.colors[k]} allowNone={k === 'logo'} onChange={(v) => c(k, v)} />)}
          <div class="form" style="gap:var(--s1)">
            <span class="lbl">Front lamp plates</span>
            <div class="row wrap">
              <label class="check"><input type="radio" name="lamp" checked={truck.colors.lampPlates === 'synthwave'} onChange={() => c('lampPlates', 'synthwave')} /> Synthwave (round amber lamps)</label>
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
          <span class="lbl">Interior</span>
          <NamePick label="Door bolster insert" noneLabel="Standard (none)" value={truck.interior.bolster} onChange={(v) => setTruck({ ...truck, interior: { ...truck.interior, bolster: v } })} />
          <NamePick label="Door armrest" noneLabel="Standard (none)" value={truck.interior.armrest} onChange={(v) => setTruck({ ...truck, interior: { ...truck.interior, armrest: v } })} />
          <label class="f"><span>Accessories on the build (one per line)</span>
            <textarea rows={Math.min(16, Math.max(4, truck.accessoryList.length + 1))} value={truck.accessoryList.join('\n')} onInput={(e) => setTruck({ ...truck, accessoryList: (e.target as HTMLTextAreaElement).value.split('\n') })} />
          </label>
          <p class="help">Colour names are Slate's; the swatches are approximations (Slate publishes no colour values). 17" black steel wheels, regular cab. The bed light strip lights up on the drawing when the relay named "Bed lights" is on.</p>
        </div>
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
            <div class="item row wrap" style="gap:var(--s15)">
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
