// Driver profiles on /settings: who they are, their phone tracker, and the
// prefs that follow them (charging, compare vehicle, themes, layout).
import { useEffect, useState } from 'preact/hooks';
import { api, loadSettings, putDriver, stateStore, useStore, type Driver, type Settings } from '../lib/brain.ts';
import { allThemes } from '../lib/theme.ts';
import { DriverBadge } from '../components/drivers.tsx';
import { squareJpeg } from '../lib/squarePhoto.ts';
import { ThemeEditor } from './ThemeEditor.tsx';
import { VehiclePicker } from './VehiclePicker.tsx';

const AMENITIES = ['restroom', 'food', 'coffee', 'shade'];
const list = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

type DDraft = Pick<Driver, 'name' | 'initials' | 'color' | 'charging' | 'compareVehicle'> & { tracker: string; networksText: string; avoidText: string; layoutText: string; hotspotSsid: string; hotspotPw: string; bt: string };
const toDraft = (d: Driver): DDraft => ({
  name: d.name, initials: d.initials, color: d.color, tracker: d.tracker ?? '',
  charging: structuredClone(d.charging), compareVehicle: d.compareVehicle ? { ...d.compareVehicle } : null,
  networksText: d.charging.networks.join(', '), avoidText: d.charging.avoidNetworks.join(', '),
  layoutText: JSON.stringify(d.layout, null, 2),
  hotspotSsid: d.hotspot?.ssid ?? '', hotspotPw: '', bt: d.btTetherMac ?? '',
});

export function DriversSection({ settings }: { settings: Settings }) {
  const state = useStore(stateStore);
  const [sel, setSel] = useState<string>(() => state?.driver?.id ?? settings.drivers[0].id);
  const d = settings.drivers.find((x) => x.id === sel) ?? settings.drivers[0];
  const [draft, setDraft] = useState<DDraft>(() => toDraft(d));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => { setDraft(toDraft(d)); setMsg(null); }, [d.id]);

  const set = <K extends keyof DDraft>(k: K, v: DDraft[K]) => setDraft({ ...draft, [k]: v });
  const setCh = <K extends keyof Driver['charging']>(k: K, v: Driver['charging'][K]) => setDraft({ ...draft, charging: { ...draft.charging, [k]: v } });

  const save = async () => {
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        name: draft.name, initials: draft.initials, color: draft.color, tracker: draft.tracker.trim() || null,
        charging: { ...draft.charging, networks: list(draft.networksText), avoidNetworks: list(draft.avoidText) },
        compareVehicle: draft.compareVehicle,
        // a blank password field keeps the stored one for the same network
        hotspot: draft.hotspotSsid.trim() ? { ssid: draft.hotspotSsid.trim(), password: draft.hotspotPw || d.hotspot?.password || undefined } : null,
        btTetherMac: draft.bt.trim() || null,
      };
      if (draft.layoutText.trim() !== JSON.stringify(d.layout, null, 2)) {
        try { body.layout = JSON.parse(draft.layoutText); } catch (e) { throw new Error(`Layout is not valid JSON: ${(e as Error).message}`); }
      }
      const n = await putDriver(d.id, body);
      setDraft(toDraft(n));
      setMsg({ ok: true, text: `Saved ${n.name}'s profile.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRun = async (text: string, f: () => Promise<unknown>) => {
    setPhotoBusy(true); setMsg(null);
    try { await f(); await loadSettings(); setMsg({ ok: true, text }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setPhotoBusy(false); }
  };
  const uploadPhoto = (f: File | undefined) => f && photoRun(`Saved ${d.name}'s photo.`, async () => {
    const jpg = await squareJpeg(f);
    return api(`/api/drivers/${encodeURIComponent(d.id)}/photo`, { method: 'POST', body: jpg, headers: { 'content-type': 'image/jpeg' } });
  });
  const removePhoto = () => photoRun(`Removed ${d.name}'s photo.`, () => api(`/api/drivers/${encodeURIComponent(d.id)}/photo`, { method: 'DELETE' }));
  const add = async () => {
    if (!newName.trim()) return;
    try { const n = await api<Driver>('/api/drivers', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) }); await loadSettings(); setNewName(''); setSel(n.id); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const remove = async () => {
    if (!confirm(`Delete ${d.name}'s profile? Their trips stay, labelled with the old id.`)) return;
    try { await api(`/api/drivers/${d.id}`, { method: 'DELETE' }); await loadSettings(); setSel(settings.drivers.find((x) => x.id !== d.id)!.id); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const putTheme = async (theme: Partial<Driver['theme']>) => { try { await putDriver(d.id, { theme }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };

  return (
    <section class="card" id="drivers">
      <h2>Drivers</h2>
      <p class="help">Each driver has their own theme, layout, charging preferences and comparison vehicle. Trips, stops and charges are labelled with whoever was driving. The cockpit suggests a driver when the ignition comes on (from Home Assistant phone presence) and never switches by itself during a trip.</p>
      <div class="row wrap" role="tablist" aria-label="Driver to edit">
        {settings.drivers.map((x) => (
          <button type="button" role="tab" aria-selected={x.id === d.id} class={`btn ${x.id === d.id ? 'primary' : ''}`} onClick={() => setSel(x.id)}>
            <DriverBadge d={x} size={26} />{x.name}{state?.driver?.id === x.id ? ' · driving' : ''}
          </button>
        ))}
      </div>
      <div class="row wrap">
        <input type="text" placeholder="New driver's name" value={newName} style="max-width:260px" onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
        <button class="btn sm" type="button" disabled={!newName.trim()} onClick={() => void add()}>+ Add driver</button>
      </div>

      <div class="form">
        <div class="fields">
          <label class="f"><span>Name</span><input type="text" value={draft.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Initials</span><input type="text" maxLength={3} value={draft.initials} onInput={(e) => set('initials', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Colour</span><input type="color" value={draft.color} style="min-height:48px;width:100%" onInput={(e) => set('color', (e.target as HTMLInputElement).value)} /></label>
          {!d.guest && <label class="f"><span>Phone tracker (HA)</span><input type="text" value={draft.tracker} placeholder="person.jeff" onInput={(e) => set('tracker', (e.target as HTMLInputElement).value)} /></label>}
        </div>
        <div class="row wrap" style="gap:var(--s1);align-items:center">
          <DriverBadge d={d} size={64} />
          <label class="btn sm" style="cursor:pointer">{d.photo ? 'Change photo…' : 'Add photo…'}
            <input type="file" accept="image/*" hidden disabled={photoBusy} onChange={(e) => { const i = e.target as HTMLInputElement; void uploadPhoto(i.files?.[0]); i.value = ''; }} />
          </label>
          {d.photo && <button class="btn sm danger" type="button" disabled={photoBusy} onClick={() => void removePhoto()}>Remove photo</button>}
          <span class="dimtxt" style="font-size:var(--fs-caption)">{photoBusy ? 'Saving…' : 'Shown instead of the initials. Cropped to a square and shrunk on this device; kept on the truck only.'}</span>
        </div>
        {d.guest && <p class="help">The Guest profile keeps no history beyond the trip itself and can't be deleted.</p>}

        <h3 class="sub" id="network">Phone (getting online)</h3>
        <p class="help">The cockpit gets online through the driver's phone: home Wi-Fi first, then this driver's hotspot, then anyone else's in range, then Bluetooth tethering. The password is stored on the truck only.</p>
        <div class="fields">
          <label class="f"><span>Hotspot name (SSID)</span><input type="text" value={draft.hotspotSsid} placeholder="Jeff's iPhone" onInput={(e) => set('hotspotSsid', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Hotspot password</span><input type="password" autocomplete="off" value={draft.hotspotPw} placeholder={d.hotspot?.password ? `set (${d.hotspot.password}); type to replace` : 'not set'} onInput={(e) => set('hotspotPw', (e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Bluetooth address (tethering)</span><input type="text" value={draft.bt} placeholder="AA:BB:CC:DD:EE:FF" onInput={(e) => set('bt', (e.target as HTMLInputElement).value)} /></label>
        </div>

        <h3 class="sub">Charging preferences</h3>
        <label class="f"><span>Preferred networks, best first (comma separated)</span><input type="text" value={draft.networksText} onInput={(e) => set('networksText', (e.target as HTMLInputElement).value)} /></label>
        <label class="f"><span>Avoid networks</span><input type="text" value={draft.avoidText} onInput={(e) => set('avoidText', (e.target as HTMLInputElement).value)} /></label>
        <div class="fields">
          <label class="f"><span>Min kW</span><input type="number" value={draft.charging.minKw} onInput={(e) => setCh('minKw', num((e.target as HTMLInputElement).value))} /></label>
          <label class="f"><span>Connector</span><select value={draft.charging.connector} onChange={(e) => setCh('connector', (e.target as HTMLSelectElement).value as Driver['charging']['connector'])}>{['NACS', 'CCS', 'J1772', 'any'].map((c) => <option value={c}>{c}</option>)}</select></label>
          <label class="f"><span>Max detour mi</span><input type="number" value={draft.charging.maxDetourMi} onInput={(e) => setCh('maxDetourMi', num((e.target as HTMLInputElement).value))} /></label>
          <label class="f"><span>Arrive with at least %</span><input type="number" value={draft.charging.arriveMinSoc} onInput={(e) => setCh('arriveMinSoc', num((e.target as HTMLInputElement).value))} /></label>
        </div>
        <div class="row wrap">
          {AMENITIES.map((a) => (
            <label class="check"><input type="checkbox" checked={draft.charging.wantAmenities.includes(a)} onChange={(e) => setCh('wantAmenities', (e.target as HTMLInputElement).checked ? [...draft.charging.wantAmenities, a] : draft.charging.wantAmenities.filter((x) => x !== a))} />{a}</label>
          ))}
        </div>

        <h3 class="sub">Gas comparison vehicle</h3>
        <label class="check"><input type="checkbox" checked={draft.compareVehicle === null} onChange={(e) => set('compareVehicle', (e.target as HTMLInputElement).checked ? null : { ...settings.compareVehicle })} /> Use the truck's ({settings.compareVehicle.label})</label>
        {draft.compareVehicle && <VehiclePicker value={draft.compareVehicle} onChange={(v) => set('compareVehicle', v)} />}

        <h3 class="sub">Layout (advanced)</h3>
        <p class="help">Per view, a grid of widgets on the 1920×720 bar: col/row start at 1, w/h are spans. Widget types: speed, soc, nextCharger, trip, cabin, aux12v, tilt, carplay, liveStrip, nowPlaying, relays, fiveSwitch, tpms, chargers, socSlider, costSummary, costSessions, trips, cam, media, nextAppointment.</p>
        <textarea value={draft.layoutText} onInput={(e) => set('layoutText', (e.target as HTMLTextAreaElement).value)} spellcheck={false} style="min-height:160px" />
        <div class="row wrap">
          <button class="btn primary" type="button" onClick={() => void save()}>Save {d.name}'s profile</button>
          <button class="btn sm" type="button" onClick={async () => { const n = await putDriver(d.id, { layout: null }); setDraft({ ...draft, layoutText: JSON.stringify(n.layout, null, 2) }); }}>Reset layout</button>
          {!d.guest && <button class="btn sm danger" type="button" onClick={() => void remove()}>Delete profile</button>}
          {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
        </div>

        <h3 class="sub" id="themes">{d.name}'s themes</h3>
        <p class="help">Auto switches between a day and a night theme at sunrise and sunset where the truck is. Theme changes save at once.</p>
        <div class="row wrap">
          <label class="check"><input type="checkbox" checked={d.theme.auto.enabled} onChange={(e) => void putTheme({ auto: { ...d.theme.auto, enabled: (e.target as HTMLInputElement).checked } })} /> Auto day/night</label>
          {(['day', 'night'] as const).map((k) => (
            <label class="f"><span>{k} theme</span>
              <select value={d.theme.auto[k]} onChange={(e) => void putTheme({ auto: { ...d.theme.auto, [k]: (e.target as HTMLSelectElement).value } })}>
                {allThemes(d.theme).map((t) => <option value={t.id}>{t.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <ThemeEditor key={d.id} driver={d} />
      </div>
    </section>
  );
}
