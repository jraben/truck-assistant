// Settings > Cameras, Dashcam, Alerts, Remote (Track C). Its own store
// (/api/remote/settings, DATA_DIR/remote.json) and its own Save button.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import type { AlertKind, CameraConfig, RemoteSettings } from '../../../brain/src/remote/types.ts';
import { ALERT_META as ALERT_META_UI } from '../../../brain/src/remote/alertMeta.ts';
import { rapi } from '../lib/cams.ts';
import { Guides } from '../components/camplayer.tsx';
import '../cams.css';

type Secrets = { lte: string; ntfy: string };
const ROLES: CameraConfig['role'][] = ['rear', 'front', 'bed', 'hitch', '360', 'cabin', 'other'];

const newCam = (n: number): CameraConfig => ({ id: `cam${n}`, name: `Camera ${n}`, role: 'other', source: 'uvc', device: '/dev/video0', url: null, width: 1280, height: 720, fps: 30, inputFormat: 'mjpeg', enabled: true, record: false, guides: false, mirror: false });

export function RemoteSection() {
  const [saved, setSaved] = useState<RemoteSettings | null>(null);
  const [d, setD] = useState<RemoteSettings | null>(null);
  const [sec, setSec] = useState<Secrets>({ lte: '', ntfy: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const s = await rapi<RemoteSettings>('/api/remote/settings'); setSaved(s); setD(structuredClone(s)); setDenied(null); }
    catch (e) { setDenied((e as Error).message); }
    try { const l = await rapi<{ url: string }>('/api/remote/link'); setLink(l.url); } catch { setLink(null); }
  };
  useEffect(() => { void load(); }, []);

  if (denied) return <section class="card" id="remote"><h2>Cameras, alerts and remote</h2><p class="help">{denied} On the cockpit screen these settings open without it.</p></section>;
  if (!d || !saved) return <section class="card" id="remote"><h2>Cameras, alerts and remote</h2><p class="help">Loading…</p></section>;

  const up = (f: (x: RemoteSettings) => void) => { const n = structuredClone(d); f(n); setD(n); };
  const setCam = (i: number, p: Partial<CameraConfig>) => up((x) => { x.cams.cameras[i] = { ...x.cams.cameras[i], ...p }; });
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, any> = structuredClone(d);
      delete body.remote;
      delete body.lte.password;
      delete body.alerts.delivery.ntfy.token;
      if (sec.lte) body.lte.password = sec.lte;
      if (sec.ntfy) body.alerts.delivery.ntfy.token = sec.ntfy;
      Object.assign(body, extra);
      const n = await rapi<RemoteSettings>('/api/remote/settings', { method: 'PUT', body: JSON.stringify(body) });
      setSaved(n); setD(structuredClone(n)); setSec({ lte: '', ntfy: '' });
      setMsg({ ok: true, text: 'Saved. Cameras restart with the new settings.' });
      if ('remote' in extra) void load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const test = async () => {
    try { const a = await rapi<{ delivered: string[]; error: string | null }>('/api/alerts/test', { method: 'POST' }); setMsg(a.delivered.length ? { ok: true, text: `Test alert sent via ${a.delivered.join(', ')}.` } : { ok: false, text: `Not delivered: ${a.error}` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const g = d.cams.guides;

  return (
    <>
      <section class="card" id="cameras">
        <h2>Cameras</h2>
        <p class="help">USB webcams (UVC) and composite/AHD capture sticks: the 360° kit's stitched output, or the Slate's own backup camera through a splitter. Use /dev/v4l/by-id/… paths so cameras keep their place after a reboot (`ls -l /dev/v4l/by-id` on the Pi). Up to 4 plus the 360 view. "test" streams a moving pattern for bench checks.</p>
        {d.cams.cameras.map((c, i) => (
          <div class="item">
            <div class="fields form" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
              <label class="f"><span>Name</span><input type="text" value={c.name} onInput={(e) => setCam(i, { name: (e.target as HTMLInputElement).value })} /></label>
              <label class="f"><span>Id (stream)</span><input type="text" value={c.id} onInput={(e) => setCam(i, { id: (e.target as HTMLInputElement).value })} /></label>
              <label class="f"><span>Role</span><select value={c.role} onChange={(e) => setCam(i, { role: (e.target as HTMLSelectElement).value as CameraConfig['role'] })}>{ROLES.map((r) => <option value={r}>{r}</option>)}</select></label>
              <label class="f"><span>Source</span><select value={c.source} onChange={(e) => { const s = (e.target as HTMLSelectElement).value as CameraConfig['source']; setCam(i, { source: s, device: s === 'uvc' || s === 'capture' ? c.device ?? '/dev/video0' : null, url: s === 'rtsp' ? c.url ?? 'rtsp://' : null }); }}>
                <option value="uvc">USB webcam (UVC)</option><option value="capture">Capture stick (composite/AHD)</option><option value="rtsp">RTSP / network</option><option value="test">Test pattern</option></select></label>
              {(c.source === 'uvc' || c.source === 'capture') && <label class="f"><span>Device</span><input type="text" value={c.device ?? ''} onInput={(e) => setCam(i, { device: (e.target as HTMLInputElement).value })} /></label>}
              {c.source === 'rtsp' && <label class="f"><span>URL</span><input type="url" value={c.url ?? ''} onInput={(e) => setCam(i, { url: (e.target as HTMLInputElement).value })} /></label>}
              <label class="f"><span>Size</span><select value={`${c.width}x${c.height}`} onChange={(e) => { const [w, h] = (e.target as HTMLSelectElement).value.split('x').map(Number); setCam(i, { width: w, height: h }); }}>
                {['640x360', '720x480', '720x576', '1280x720', '1920x1080'].map((x) => <option value={x}>{x}{x === '720x480' ? ' (NTSC stick)' : ''}</option>)}
                {!['640x360', '720x480', '720x576', '1280x720', '1920x1080'].includes(`${c.width}x${c.height}`) && <option value={`${c.width}x${c.height}`}>{c.width}x{c.height}</option>}</select></label>
              <label class="f"><span>FPS</span><input type="number" value={c.fps} onInput={(e) => setCam(i, { fps: num((e.target as HTMLInputElement).value) })} /></label>
              {(c.source === 'uvc' || c.source === 'capture') && <label class="f"><span>Device format</span><select value={c.inputFormat} onChange={(e) => setCam(i, { inputFormat: (e.target as HTMLSelectElement).value as CameraConfig['inputFormat'] })}><option value="mjpeg">MJPEG</option><option value="yuyv422">YUYV (most capture sticks)</option><option value="auto">auto</option></select></label>}
            </div>
            <div class="row wrap">
              {(['enabled', 'record', 'guides', 'mirror'] as const).map((k) => <label class="check"><input type="checkbox" checked={c[k]} onChange={(e) => setCam(i, { [k]: (e.target as HTMLInputElement).checked })} /> {k === 'record' ? 'Dashcam' : k === 'guides' ? 'Parking guides' : k === 'mirror' ? 'Mirror' : 'On'}</label>)}
              <button class="btn sm danger" type="button" onClick={() => up((x) => { x.cams.cameras.splice(i, 1); })}>Remove</button>
            </div>
          </div>
        ))}
        <div class="row wrap">
          <button class="btn sm" type="button" disabled={d.cams.cameras.length >= 8} onClick={() => up((x) => { x.cams.cameras.push(newCam(x.cams.cameras.length + 1)); })}>+ Add camera</button>
          <label class="check"><input type="checkbox" checked={d.cams.autoRear} onChange={(e) => up((x) => { x.cams.autoRear = (e.target as HTMLInputElement).checked; })} /> Rear camera on reverse</label>
          <label class="f" style="min-width:160px"><span>Cams view opens as</span><select value={d.cams.defaultLayout} onChange={(e) => up((x) => { x.cams.defaultLayout = (e.target as HTMLSelectElement).value as 'grid' | 'single'; })}><option value="grid">Grid</option><option value="single">One camera</option></select></label>
        </div>
        <h3 class="sub">Parking guides</h3>
        <div class="row wrap" style="align-items:flex-start">
          <div style="position:relative;width:320px;height:180px;background:#111;border-radius:10px;overflow:hidden;flex:none"><Guides g={g} /></div>
          <div class="fields form" style="flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">
            {([['bottomWidth', 'Width at the bottom', 0.1, 1], ['topWidth', 'Width at the top', 0, 1], ['top', 'Top of the lines', 0.05, 0.95], ['offsetX', 'Shift left/right', -0.5, 0.5]] as const).map(([k, label, min, max]) => (
              <label class="f"><span>{label}</span><input type="range" min={min} max={max} step={0.01} value={g[k]} onInput={(e) => up((x) => { (x.cams.guides as any)[k] = Number((e.target as HTMLInputElement).value); })} /></label>
            ))}
            {g.bands.map((b, i) => <label class="f"><span>{['Near (red)', 'Middle (yellow)', 'Far (green)'][i]}</span><input type="range" min={0} max={1} step={0.01} value={b} onInput={(e) => up((x) => { x.cams.guides.bands[i] = Number((e.target as HTMLInputElement).value); })} /></label>)}
          </div>
        </div>
        <p class="help">Line them up against tape on the ground behind the truck: red ≈ 1 m, yellow ≈ 2 m, green ≈ 3 m.</p>
      </section>

      <section class="card" id="dashcam">
        <h2>Dashcam</h2>
        <p class="help">Loop recording of the cameras ticked "Dashcam" on the SSD. When the loop is full the oldest minutes go. Save clip keeps the time before the tap and after it, and clips are never deleted by themselves.</p>
        <div class="fields form">
          <label class="f"><span>Loop size (GB)</span><input type="number" step="1" value={d.dashcam.capGb} onInput={(e) => up((x) => { x.dashcam.capGb = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Segment (s)</span><input type="number" value={d.dashcam.segmentSec} onInput={(e) => up((x) => { x.dashcam.segmentSec = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Clip: before (s)</span><input type="number" value={d.dashcam.preSec} onInput={(e) => up((x) => { x.dashcam.preSec = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Clip: after (s)</span><input type="number" value={d.dashcam.postSec} onInput={(e) => up((x) => { x.dashcam.postSec = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Motion sensitivity (scene 0–1)</span><input type="number" step="0.01" value={d.dashcam.sceneThreshold} onInput={(e) => up((x) => { x.dashcam.sceneThreshold = num((e.target as HTMLInputElement).value); })} /></label>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" checked={d.dashcam.enabled} onChange={(e) => up((x) => { x.dashcam.enabled = (e.target as HTMLInputElement).checked; })} /> Record</label>
          <label class="check"><input type="checkbox" checked={d.dashcam.parkedMotion} onChange={(e) => up((x) => { x.dashcam.parkedMotion = (e.target as HTMLInputElement).checked; })} /> Clip on motion or vibration while parked (Pi awake)</label>
        </div>
      </section>

      <section class="card" id="alerts">
        <h2>Alerts</h2>
        <p class="help">Pushed to your phone through Home Assistant's companion app (notify.mobile_app_…), or ntfy if you don't use HA. Hold = how long it must last before it counts; cooldown = no repeat for that long. While the Pi sleeps, the always-on watch sends its own alerts to MQTT and HA turns them into pushes (docs/remote.md).</p>
        <div style="overflow-x:auto">
          <table class="tou">
            <tbody>
              {(Object.keys(ALERT_META_UI) as AlertKind[]).map((k) => {
                const r = d.alerts.rules[k], m = ALERT_META_UI[k];
                return (
                  <tr>
                    <td><label class="check" style="border:0;padding:0"><input type="checkbox" checked={r.enabled} onChange={(e) => up((x) => { x.alerts.rules[k].enabled = (e.target as HTMLInputElement).checked; })} /> {m.label}</label></td>
                    <td>{m.unit ? <label class="f"><span>{m.unit}</span><input type="number" step="0.1" style="width:90px" value={r.threshold ?? ''} onInput={(e) => up((x) => { x.alerts.rules[k].threshold = num((e.target as HTMLInputElement).value); })} /></label> : null}</td>
                    <td><label class="f"><span>hold s</span><input type="number" style="width:80px" value={r.holdSec} onInput={(e) => up((x) => { x.alerts.rules[k].holdSec = num((e.target as HTMLInputElement).value); })} /></label></td>
                    <td><label class="f"><span>cooldown min</span><input type="number" style="width:90px" value={r.cooldownMin} onInput={(e) => up((x) => { x.alerts.rules[k].cooldownMin = num((e.target as HTMLInputElement).value); })} /></label></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div class="fields form">
          <label class="f"><span>HA notify service</span><input type="text" value={d.alerts.delivery.ha.service ?? ''} placeholder="notify.mobile_app_jeffs_iphone" onInput={(e) => up((x) => { x.alerts.delivery.ha.service = (e.target as HTMLInputElement).value || null; })} /></label>
          <label class="f"><span>ntfy server</span><input type="url" value={d.alerts.delivery.ntfy.server} onInput={(e) => up((x) => { x.alerts.delivery.ntfy.server = (e.target as HTMLInputElement).value; })} /></label>
          <label class="f"><span>ntfy topic</span><input type="text" value={d.alerts.delivery.ntfy.topic ?? ''} placeholder="not set" onInput={(e) => up((x) => { x.alerts.delivery.ntfy.topic = (e.target as HTMLInputElement).value || null; })} /></label>
          <label class="f"><span>ntfy token</span><input type="password" autocomplete="off" value={sec.ntfy} placeholder={saved.alerts.delivery.ntfy.token ? `set (${saved.alerts.delivery.ntfy.token})` : 'optional'} onInput={(e) => setSec({ ...sec, ntfy: (e.target as HTMLInputElement).value })} /></label>
          <label class="f"><span>Charge target %</span><input type="number" value={d.alerts.chargeTargetSoc} onInput={(e) => up((x) => { x.alerts.chargeTargetSoc = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Charger plugged-in entity (HA)</span><input type="text" value={d.alerts.chargerPlugEntity ?? ''} placeholder="binary_sensor.wall_charger_plug" onInput={(e) => up((x) => { x.alerts.chargerPlugEntity = (e.target as HTMLInputElement).value || null; })} /></label>
          <label class="f"><span>Quiet hours from</span><input type="text" value={d.alerts.geofence.quietStart} onInput={(e) => up((x) => { x.alerts.geofence.quietStart = (e.target as HTMLInputElement).value; })} /></label>
          <label class="f"><span>to</span><input type="text" value={d.alerts.geofence.quietEnd} onInput={(e) => up((x) => { x.alerts.geofence.quietEnd = (e.target as HTMLInputElement).value; })} /></label>
        </div>
        <h3 class="sub">Geofences</h3>
        {d.alerts.geofence.zones.map((z, i) => (
          <div class="row wrap">
            <input type="text" style="max-width:160px" value={z.name} onInput={(e) => up((x) => { x.alerts.geofence.zones[i].name = (e.target as HTMLInputElement).value; })} />
            <input type="number" step="0.00001" style="max-width:140px" value={z.lat} onInput={(e) => up((x) => { x.alerts.geofence.zones[i].lat = num((e.target as HTMLInputElement).value); })} />
            <input type="number" step="0.00001" style="max-width:140px" value={z.lon} onInput={(e) => up((x) => { x.alerts.geofence.zones[i].lon = num((e.target as HTMLInputElement).value); })} />
            <input type="number" style="max-width:100px" value={z.radiusM} onInput={(e) => up((x) => { x.alerts.geofence.zones[i].radiusM = num((e.target as HTMLInputElement).value); })} />
            <button class="btn sm danger" type="button" onClick={() => up((x) => { x.alerts.geofence.zones.splice(i, 1); })}>Remove</button>
          </div>
        ))}
        <div class="row wrap">
          <button class="btn sm" type="button" onClick={() => up((x) => { x.alerts.geofence.zones.push({ name: 'Home', lat: 33.4990, lon: -111.9800, radiusM: 150 }); })}>+ Add geofence</button>
          <button class="btn sm" type="button" onClick={() => void test()}>Send a test alert</button>
        </div>
      </section>

      <section class="card" id="remote">
        <h2>Remote</h2>
        <p class="help">The Truck page for your phone (also embeddable in Home Assistant or WOPR). Reach it over Tailscale; the link carries a token, so treat it like a key. "New token" signs every phone out.</p>
        {link ? <TruckLink url={link} onNew={() => void save({ remote: { token: 'new' } })} /> : <p class="help">Open these settings on the cockpit screen to see the link.</p>}
        <div class="fields form">
          <label class="f"><span>Sleep after no viewer (min)</span><input type="number" value={d.power.sleepAfterMin} onInput={(e) => up((x) => { x.power.sleepAfterMin = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>Longest remote wake (min, 0 = none)</span><input type="number" value={d.power.maxAwakeMin} onInput={(e) => up((x) => { x.power.maxAwakeMin = num((e.target as HTMLInputElement).value); })} /></label>
          <label class="f"><span>LTE APN (tier 2 modem)</span><input type="text" value={d.lte.apn} placeholder="e.g. fast.t-mobile.com" onInput={(e) => up((x) => { x.lte.apn = (e.target as HTMLInputElement).value; })} /></label>
          <label class="f"><span>APN user</span><input type="text" value={d.lte.user ?? ''} placeholder="usually none" onInput={(e) => up((x) => { x.lte.user = (e.target as HTMLInputElement).value || null; })} /></label>
          <label class="f"><span>APN password</span><input type="password" autocomplete="off" value={sec.lte} placeholder={saved.lte.password ? `set (${saved.lte.password})` : 'usually none'} onInput={(e) => setSec({ ...sec, lte: (e.target as HTMLInputElement).value })} /></label>
          <label class="f"><span>Watch MQTT prefix</span><input type="text" value={d.watch.prefix} onInput={(e) => up((x) => { x.watch.prefix = (e.target as HTMLInputElement).value; })} /></label>
        </div>
        <p class="help">The APN is applied on the Pi by <code>sudo deploy/pi/lte/setup-lte.sh</code>, which reads it from here.</p>
      </section>

      {/* Not sticky: the truck settings' bar is the one pinned to the bottom of the page. */}
      <div class="row wrap remote-save">
        <button class="btn big primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save cameras, alerts and remote'}</button>
        <button class="btn big" type="button" onClick={() => { setD(structuredClone(saved)); setSec({ lte: '', ntfy: '' }); setMsg(null); }}>Undo</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
    </>
  );
}

function TruckLink({ url, onNew }: { url: string; onNew: () => void }) {
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  const [shown, setShown] = useState(false);
  return (
    <div class="row wrap" style="align-items:flex-start">
      {shown && <div style="width:160px;background:#fff;border-radius:8px" dangerouslySetInnerHTML={{ __html: svg }} />}
      <div class="form" style="flex:1;gap:6px">
        <code style="word-break:break-all;font-size:12px">{shown ? url : url.replace(/token=[^&]+/, 'token=••••')}</code>
        <div class="row wrap">
          <button class="btn sm" type="button" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show link + QR'}</button>
          <button class="btn sm" type="button" onClick={() => void navigator.clipboard?.writeText(url)}>Copy</button>
          <button class="btn sm danger" type="button" onClick={() => { if (confirm('Make a new token? Every phone has to open the new link.')) onNew(); }}>New token</button>
        </div>
        <span class="help">On the Pi this host is the cockpit's own address; from a phone use the Tailscale name instead (http://slate-truck:8080/truck?token=…).</span>
      </div>
    </div>
  );
}
