// Track C settings: DATA_DIR/remote.json, next to settings.json but its own file,
// so the camera/alert/remote settings have their own route and never collide
// with the truck settings. Secrets (LTE password, ntfy token, the remote token)
// are masked like the main settings' keys.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AlertKind, AlertRule, CameraConfig, GuideSettings, RemoteSettings } from './types.ts';

export class RemoteSettingsError extends Error {}

const MASK = '•';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const maskSecret = (k: string | undefined) => (k ? MASK.repeat(4) + k.slice(-4) : undefined);
export const newToken = () => randomBytes(18).toString('base64url');

import { ALERT_KINDS, ALERT_META } from './alertMeta.ts';
export { ALERT_KINDS, ALERT_META };

const defaultRule = (k: AlertKind): AlertRule => ({ enabled: k !== 'geofence', threshold: ALERT_META[k].threshold, holdSec: ALERT_META[k].holdSec, cooldownMin: ALERT_META[k].cooldownMin });

export const DEFAULT_GUIDES: GuideSettings = { bottomWidth: 0.78, topWidth: 0.3, top: 0.42, bands: [0.85, 0.68, 0.52], offsetX: 0 };

export function camera(id: string, name: string, role: CameraConfig['role'], source: CameraConfig['source'], extra: Partial<CameraConfig> = {}): CameraConfig {
  return {
    id, name, role, source, device: null, url: null, width: 1280, height: 720, fps: 30, inputFormat: 'auto',
    enabled: true, record: false, guides: role === 'rear', mirror: false, ...extra,
  };
}

/** On a desk (SIM=1): four test patterns, front and rear recorded. On a Pi: the capture stick and one UVC cam. */
export function defaultCameras(sim: boolean): CameraConfig[] {
  if (sim) {
    return [
      camera('rear', 'Rear', 'rear', 'test', { width: 640, height: 360, fps: 15, record: true }),
      camera('front', 'Front', 'front', 'test', { width: 640, height: 360, fps: 15, record: true }),
      camera('bed', 'Bed', 'bed', 'test', { width: 640, height: 360, fps: 15 }),
      camera('surround', '360°', '360', 'test', { width: 640, height: 360, fps: 15 }),
    ];
  }
  return [
    // The 360 kit's stitched output (or the Slate's own backup camera through a splitter) on a composite/AHD stick.
    camera('rear', 'Rear', 'rear', 'capture', { device: '/dev/video0', width: 720, height: 480, fps: 30, inputFormat: 'yuyv422', record: true }),
    camera('front', 'Front', 'front', 'uvc', { device: '/dev/video2', inputFormat: 'mjpeg', record: true, enabled: false }),
  ];
}

export function defaultRemote(sim: boolean): RemoteSettings {
  return {
    cams: { cameras: defaultCameras(sim), guides: structuredClone(DEFAULT_GUIDES), autoRear: true, defaultLayout: 'grid' },
    dashcam: { enabled: true, segmentSec: 60, capGb: sim ? 1 : 64, preSec: 60, postSec: 30, parkedMotion: true, sceneThreshold: 0.12 },
    alerts: {
      rules: Object.fromEntries(ALERT_KINDS.map((k) => [k, defaultRule(k)])) as Record<AlertKind, AlertRule>,
      geofence: { zones: [], quietStart: '22:00', quietEnd: '06:00' },
      chargeTargetSoc: 80,
      chargerPlugEntity: null,
      delivery: { ha: { service: null }, ntfy: { server: 'https://ntfy.sh', topic: null } },
    },
    power: { sleepAfterMin: 10, maxAwakeMin: 60 },
    lte: { apn: '', user: null },
    watch: { prefix: 'slate/watch' },
    remote: { token: newToken() },
  };
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : structuredClone(patch);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : structuredClone(v);
  }
  return out;
}

/** A secret patch: masked = keep, "" / null = remove, else the new value. */
function secret(base: string | undefined, v: unknown): string | undefined {
  if (v === undefined) return base;
  if (v === null || v === '') return undefined;
  if (typeof v === 'string' && v.includes(MASK)) return base;
  if (typeof v !== 'string') throw new RemoteSettingsError('secrets must be text');
  return v.trim() || undefined;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new RemoteSettingsError(`${name} must be a number from ${min} to ${max}`);
  return v;
}
const bool = (v: unknown, name: string) => { if (typeof v !== 'boolean') throw new RemoteSettingsError(`${name} must be true or false`); return v; };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLES = ['rear', 'front', 'bed', 'hitch', '360', 'cabin', 'other'];

export function validateCamera(c: unknown, i: number): CameraConfig {
  if (!isObj(c)) throw new RemoteSettingsError(`camera ${i + 1} must be an object`);
  const x = { ...camera('x', 'Camera', 'other', 'test'), ...c } as CameraConfig;
  const where = `camera "${typeof x.id === 'string' ? x.id : i + 1}"`;
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(x.id)) throw new RemoteSettingsError(`${where}: id must be lowercase letters, digits, - and _ (it is the stream name)`);
  if (typeof x.name !== 'string' || !x.name.trim()) throw new RemoteSettingsError(`${where}: name is required`);
  x.name = x.name.trim().slice(0, 24);
  if (!ROLES.includes(x.role)) throw new RemoteSettingsError(`${where}: role must be one of ${ROLES.join(', ')}`);
  if (!['uvc', 'capture', 'rtsp', 'test'].includes(x.source)) throw new RemoteSettingsError(`${where}: source must be uvc, capture, rtsp or test`);
  if (x.source === 'uvc' || x.source === 'capture') {
    if (typeof x.device !== 'string' || !/^\/dev\/[A-Za-z0-9_./:-]+$/.test(x.device)) throw new RemoteSettingsError(`${where}: device must be a /dev path (best: /dev/v4l/by-id/…)`);
  } else x.device = null;
  if (x.source === 'rtsp') {
    if (typeof x.url !== 'string' || !/^(rtsps?|https?):\/\/\S+$/.test(x.url)) throw new RemoteSettingsError(`${where}: url must start with rtsp:// or http://`);
  } else x.url = null;
  x.width = Math.round(num(x.width, `${where} width`, 160, 3840));
  x.height = Math.round(num(x.height, `${where} height`, 120, 2160));
  x.fps = Math.round(num(x.fps, `${where} fps`, 1, 60));
  if (!['mjpeg', 'yuyv422', 'auto'].includes(x.inputFormat)) throw new RemoteSettingsError(`${where}: inputFormat must be mjpeg, yuyv422 or auto`);
  for (const k of ['enabled', 'record', 'guides', 'mirror'] as const) bool(x[k], `${where} ${k}`);
  return { id: x.id, name: x.name, role: x.role, source: x.source, device: x.device, url: x.url, width: x.width, height: x.height, fps: x.fps, inputFormat: x.inputFormat, enabled: x.enabled, record: x.record, guides: x.guides, mirror: x.mirror };
}

export function validateRemote(s: RemoteSettings): RemoteSettings {
  const c = s.cams;
  if (!isObj(c) || !Array.isArray(c.cameras)) throw new RemoteSettingsError('cams.cameras must be a list');
  if (c.cameras.length > 8) throw new RemoteSettingsError('at most 8 cameras (4 + the 360 view is the plan)');
  c.cameras = c.cameras.map(validateCamera);
  if (new Set(c.cameras.map((x) => x.id)).size !== c.cameras.length) throw new RemoteSettingsError('two cameras have the same id');
  const g = c.guides;
  if (!isObj(g)) throw new RemoteSettingsError('cams.guides must be an object');
  num(g.bottomWidth, 'guides.bottomWidth', 0.1, 1); num(g.topWidth, 'guides.topWidth', 0, 1); num(g.top, 'guides.top', 0.05, 0.95); num(g.offsetX, 'guides.offsetX', -0.5, 0.5);
  if (!Array.isArray(g.bands) || g.bands.length !== 3) throw new RemoteSettingsError('guides.bands must be three numbers');
  g.bands.forEach((b, i) => num(b, `guides.bands[${i}]`, 0, 1));
  bool(c.autoRear, 'cams.autoRear');
  if (c.defaultLayout !== 'grid' && c.defaultLayout !== 'single') throw new RemoteSettingsError('cams.defaultLayout must be grid or single');
  const d = s.dashcam;
  bool(d.enabled, 'dashcam.enabled'); bool(d.parkedMotion, 'dashcam.parkedMotion');
  d.segmentSec = Math.round(num(d.segmentSec, 'dashcam.segmentSec', 10, 600));
  num(d.capGb, 'dashcam.capGb', 0.1, 4000);
  d.preSec = Math.round(num(d.preSec, 'dashcam.preSec', 0, 600));
  d.postSec = Math.round(num(d.postSec, 'dashcam.postSec', 0, 600));
  num(d.sceneThreshold, 'dashcam.sceneThreshold', 0.01, 1);
  const a = s.alerts;
  if (!isObj(a) || !isObj(a.rules)) throw new RemoteSettingsError('alerts.rules must be an object');
  for (const k of ALERT_KINDS) {
    const r = { ...defaultRule(k), ...(isObj(a.rules[k]) ? a.rules[k] : {}) } as AlertRule;
    const m = ALERT_META[k];
    bool(r.enabled, `alerts.${k}.enabled`);
    if (m.threshold === null) r.threshold = null; else num(r.threshold, `alerts.${k}.threshold`, m.min!, m.max!);
    r.holdSec = Math.round(num(r.holdSec, `alerts.${k}.holdSec`, 0, 3600));
    num(r.cooldownMin, `alerts.${k}.cooldownMin`, 0, 1440);
    a.rules[k] = r;
  }
  for (const k of Object.keys(a.rules)) if (!(ALERT_KINDS as string[]).includes(k)) delete (a.rules as Record<string, unknown>)[k];
  const gf = a.geofence;
  if (!isObj(gf) || !Array.isArray(gf.zones)) throw new RemoteSettingsError('alerts.geofence.zones must be a list');
  gf.zones = gf.zones.map((z, i) => {
    if (!isObj(z) || typeof z.name !== 'string' || !z.name.trim()) throw new RemoteSettingsError(`geofence zone ${i + 1} needs a name`);
    return { name: z.name.trim().slice(0, 30), lat: num(z.lat, `zone ${i + 1} lat`, -90, 90), lon: num(z.lon, `zone ${i + 1} lon`, -180, 180), radiusM: num(z.radiusM ?? 150, `zone ${i + 1} radiusM`, 20, 50_000) };
  });
  if (!HHMM.test(gf.quietStart) || !HHMM.test(gf.quietEnd)) throw new RemoteSettingsError('geofence quiet hours must be HH:MM, 24-hour');
  num(a.chargeTargetSoc, 'alerts.chargeTargetSoc', 1, 100);
  if (a.chargerPlugEntity === '' || a.chargerPlugEntity === undefined) a.chargerPlugEntity = null;
  if (a.chargerPlugEntity !== null && !/^(binary_sensor|sensor|switch)\.[a-z0-9_]+$/.test(String(a.chargerPlugEntity))) throw new RemoteSettingsError('alerts.chargerPlugEntity must look like binary_sensor.wall_charger_plug');
  const ha = a.delivery?.ha, nt = a.delivery?.ntfy;
  if (!isObj(ha) || !isObj(nt)) throw new RemoteSettingsError('alerts.delivery needs ha and ntfy');
  if (ha.service === '' || ha.service === undefined) ha.service = null;
  if (ha.service !== null) {
    const svc = String(ha.service).trim().replace(/^notify\./, '');
    if (!/^[a-z0-9_]+$/.test(svc)) throw new RemoteSettingsError('alerts.delivery.ha.service must look like notify.mobile_app_jeffs_iphone');
    ha.service = `notify.${svc}`;
  }
  if (typeof nt.server !== 'string' || !/^https?:\/\/[^\s/]+/.test(nt.server.trim())) throw new RemoteSettingsError('ntfy server must start with https:// (e.g. https://ntfy.sh)');
  nt.server = nt.server.trim().replace(/\/+$/, '');
  if (nt.topic === '' || nt.topic === undefined) nt.topic = null;
  if (nt.topic !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(String(nt.topic))) throw new RemoteSettingsError('ntfy topic: letters, digits, - and _ (pick something hard to guess)');
  const p = s.power;
  p.sleepAfterMin = num(p.sleepAfterMin, 'power.sleepAfterMin', 1, 240);
  p.maxAwakeMin = num(p.maxAwakeMin, 'power.maxAwakeMin', 0, 1440);
  if (typeof s.lte.apn !== 'string') throw new RemoteSettingsError('lte.apn must be text');
  s.lte.apn = s.lte.apn.trim();
  if (s.lte.apn && !/^[A-Za-z0-9._-]{1,63}$/.test(s.lte.apn)) throw new RemoteSettingsError('lte.apn: letters, digits, . - _ (e.g. fast.t-mobile.com)');
  if (s.lte.user === '' || s.lte.user === undefined) s.lte.user = null;
  if (typeof s.watch.prefix !== 'string' || !/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(s.watch.prefix)) throw new RemoteSettingsError('watch.prefix must be an MQTT topic like slate/watch');
  return s;
}

export function mergeRemote(base: RemoteSettings, patch: unknown): RemoteSettings {
  if (!isObj(patch)) throw new RemoteSettingsError('body must be a JSON object');
  const p = structuredClone(patch) as Record<string, any>;
  const lteSecret = secret(base.lte.password, p.lte?.password);
  const ntfySecret = secret(base.alerts.delivery.ntfy.token, p.alerts?.delivery?.ntfy?.token);
  let token = base.remote.token;
  if (isObj(p.remote) && 'token' in p.remote) token = p.remote.token === 'new' ? newToken() : secret(base.remote.token, p.remote.token);
  if (isObj(p.lte)) delete p.lte.password;
  if (isObj(p.alerts?.delivery?.ntfy)) delete p.alerts.delivery.ntfy.token;
  delete p.remote;
  const next = deepMerge(base, p) as RemoteSettings;
  if (lteSecret) next.lte.password = lteSecret; else delete next.lte.password;
  if (ntfySecret) next.alerts.delivery.ntfy.token = ntfySecret; else delete next.alerts.delivery.ntfy.token;
  next.remote = token ? { token } : {};
  return validateRemote(next);
}

export function maskRemote(s: RemoteSettings): RemoteSettings {
  const out = structuredClone(s);
  if (out.lte.password) out.lte.password = maskSecret(out.lte.password);
  if (out.alerts.delivery.ntfy.token) out.alerts.delivery.ntfy.token = maskSecret(out.alerts.delivery.ntfy.token);
  if (out.remote.token) out.remote.token = maskSecret(out.remote.token);
  return out;
}

export function loadRemote(raw: unknown, sim: boolean): RemoteSettings {
  const base = defaultRemote(sim);
  if (!isObj(raw)) return base;
  const merged = deepMerge(base, raw) as RemoteSettings;
  if (Array.isArray((raw as any).cams?.cameras)) merged.cams.cameras = structuredClone((raw as any).cams.cameras);
  if (!merged.remote?.token) merged.remote = { token: newToken() };
  return validateRemote(merged);
}

type Listener = (s: RemoteSettings, prev: RemoteSettings) => void;

export class RemoteStore {
  private file: string;
  private s: RemoteSettings;
  private listeners: Listener[] = [];
  constructor(dataDir: string, sim: boolean) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'remote.json');
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[remote] ${this.file} unreadable, using defaults: ${(e as Error).message}`);
    }
    try { this.s = loadRemote(raw, sim); } catch (e) {
      console.warn(`[remote] ${this.file} invalid, using defaults: ${(e as Error).message}`);
      this.s = defaultRemote(sim);
    }
    this.write();
  }
  get(): RemoteSettings { return this.s; }
  update(patch: unknown): RemoteSettings {
    const prev = this.s;
    this.s = mergeRemote(structuredClone(this.s), patch);
    this.write();
    for (const l of this.listeners) { try { l(this.s, prev); } catch (e) { console.error('[remote] listener', e); } }
    return this.s;
  }
  onChange(l: Listener) { this.listeners.push(l); }
  private write() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
