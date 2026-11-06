// Track C wired to the brain: cameras + dashcam, the tier 1 watch over MQTT,
// alerts, theft, and tier 2 sleep. Reads the brain's State and MQTT; never
// changes anything in the brain except through its public methods (relays).
import { execFile } from 'node:child_process';
import { driversAtTruck, type Brain } from '../brain.ts';
import { kvGet, kvSet, type Db } from '../db.ts';
import { presenceOf } from '../ha/client.ts';
import { CamManager, go2rtcConfigPath } from '../cams/manager.ts';
import { Dashcam } from '../cams/dashcam.ts';
import { AlertEngine, type AlertInput, type Fired } from './alerts.ts';
import { remoteConfig } from './config.ts';
import { Notifier } from './notify.ts';
import { PowerManager } from './power.ts';
import { RemoteStore } from './store.ts';
import { theftCheck } from './theft.ts';
import type { Alert, AlertKind, Clip, PowerStatus, TruckSnapshot, WatchStatus } from './types.ts';
import { emptyWatch, parseWatch, watchCommand } from './watch.ts';

const TICK_MS = 5000;
const CLIP_COOLDOWN_MS = 2 * 60_000;

type LatLon = { lat: number; lon: number };

export class RemoteService {
  readonly store: RemoteStore;
  readonly dashcam: Dashcam;
  readonly cams: CamManager;
  readonly power: PowerManager;
  readonly engine: AlertEngine;
  readonly notifier: Notifier;
  watch: WatchStatus = emptyWatch();
  private brain: Brain;
  private db: Db;
  private sim: boolean;
  private timer: NodeJS.Timeout | null = null;
  private simTimer: NodeJS.Timeout | null = null;
  private motion: { camera: string | null; how: string } | null = null;
  private lastClipAt = 0;
  private truckboxOfflineSince: number | null = null;
  private wasTruckbox: boolean | null = null;
  private lastIgnition: boolean | null = null;
  private park: LatLon | null;
  private pluggedIn: boolean | null = null;
  private plugPolledAt = 0;
  private presenceCache: { at: number; names: string[] | null } | null = null;

  constructor(brain: Brain, db: Db, dataDir: string, sim: boolean) {
    this.brain = brain; this.db = db; this.sim = sim;
    this.store = new RemoteStore(dataDir, sim);
    const s = this.store.get();
    db.exec(`CREATE TABLE IF NOT EXISTS remote_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
      title TEXT NOT NULL, message TEXT NOT NULL, source TEXT NOT NULL,
      delivered TEXT NOT NULL DEFAULT '[]', error TEXT
    ); CREATE INDEX IF NOT EXISTS remote_alerts_at ON remote_alerts(at);`);
    this.dashcam = new Dashcam(remoteConfig.dashcamDir, remoteConfig.ffmpegBin);
    this.cams = new CamManager(s, this.dashcam, {
      go2rtcBin: remoteConfig.go2rtcBin, ffmpegBin: remoteConfig.ffmpegBin, external: remoteConfig.go2rtcExternal, disabled: remoteConfig.camsDisabled,
      ports: { api: remoteConfig.go2rtcApi, rtsp: remoteConfig.go2rtcRtsp, webrtc: remoteConfig.go2rtcWebrtc }, configFile: go2rtcConfigPath(dataDir),
    });
    this.power = new PowerManager();
    this.engine = new AlertEngine(s.alerts);
    this.notifier = new Notifier();
    this.park = kvGet<LatLon>(db, 'remote.park');
    this.store.onChange((next, prev) => {
      this.cams.apply(next);
      this.engine.setSettings(next.alerts);
      if (next.watch.prefix !== prev.watch.prefix) this.brain.addTopics([`${next.watch.prefix}/#`]);
    });
    this.cams.onMotion = (camera, score) => this.onMotion(camera, `Motion on the ${this.cams.camera(camera)?.name ?? camera} camera (scene ${score.toFixed(2)})`);
    this.dashcam.onClip = (c) => { console.log(`[dashcam] clip ${c.id}: ${c.state}${c.error ? ` (${c.error})` : ''}`); this.brain.emit('clip', c); };
  }

  async start() {
    this.brain.addTopics([`${this.store.get().watch.prefix}/#`]);
    this.brain.on('mqtt', (topic: string, payload: string) => this.onMqtt(topic, payload));
    await this.cams.start();
    this.dashcam.start();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    if (this.sim) {
      const f = () => this.simWatch();
      f(); this.simTimer = setInterval(f, 30_000);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.simTimer) clearInterval(this.simTimer);
    this.dashcam.stop();
    this.cams.stop();
  }

  // ---- inputs ----------------------------------------------------------------

  private onMqtt(topic: string, payload: string) {
    const truckId = this.brain.settings.get().truckId;
    if (topic === `${truckId}/truckbox/binary_sensor/vibration/state`) {
      if (payload.trim() === 'ON') this.onMotion(null, 'Vibration (truck box)');
      return;
    }
    const prefix = `${this.store.get().watch.prefix}/`;
    if (!topic.startsWith(prefix)) return;
    const e = parseWatch(topic.slice(prefix.length), payload);
    if (!e) return;
    if (e.type === 'status') this.watch = { ...this.watch, online: e.online };
    else if (e.type === 'state') {
      const before = this.watch.vibration;
      this.watch = { ...this.watch, ...e.patch, online: true };
      if (e.patch.vibration && e.patch.vibration > 0 && e.patch.vibration !== before) this.onMotion(null, `Vibration (${e.patch.vibration}× since the watch's last report)`);
    } else if (e.type === 'alert') {
      // The watch already reached the phone through HA; keep it in the list, don't push it twice.
      this.record({ kind: e.kind === 'other' ? 'motionParked' : e.kind, title: e.title, message: e.message, priority: 'default' }, 'watch', { delivered: ['watch'], error: null }, e.at);
    }
  }

  onMotion(camera: string | null, how: string) {
    const st = this.brain.getState();
    const parked = st.ignition !== true;
    if (!parked) return;
    this.motion = { camera, how };
    const d = this.store.get().dashcam;
    if (d.parkedMotion && Date.now() - this.lastClipAt > CLIP_COOLDOWN_MS) {
      const cams = this.cams.recordedCameras();
      if (cams.length) {
        this.lastClipAt = Date.now();
        this.dashcam.saveClip(cams, Math.min(d.preSec, 30), d.postSec, 'motion');
        this.motion = { camera: cams.map((c) => this.cams.camera(c)?.name ?? c).join(' + '), how };
      }
    }
  }

  // ---- periodic ----------------------------------------------------------------

  private async tick() {
    const st = this.brain.getState();
    const s = this.store.get();
    const now = Date.now();
    const parked = st.ignition !== true && (st.speedMph === null || st.speedMph < 1);
    this.cams.setParked(parked && st.ignition === false);

    if (this.wasTruckbox !== st.truckbox) { this.truckboxOfflineSince = st.truckbox ? null : now; this.wasTruckbox = st.truckbox; }

    // Theft: arm where it parks; check whenever it is somewhere else.
    const pos = st.gps?.fix ? { lat: st.gps.lat, lon: st.gps.lon } : this.watch.fix && this.watch.lat !== null ? { lat: this.watch.lat, lon: this.watch.lon! } : null;
    if (st.ignition === false && this.lastIgnition !== false && pos) this.setPark(pos);
    if (st.ignition === false && !this.park && pos) this.setPark(pos);
    this.lastIgnition = st.ignition;
    let theft: AlertInput['theft'] = null;
    if (this.park && pos) {
      const radiusM = s.alerts.rules.theft.threshold ?? 200;
      const first = theftCheck({ park: this.park, pos, ignition: st.ignition, driversNear: [], radiusM });
      if (first.kind !== 'ok') {
        const v = theftCheck({ park: this.park, pos, ignition: st.ignition, driversNear: await this.driversNear(pos), radiusM });
        if (v.kind === 'drive') { console.log(`[theft] moved ${Math.round(v.movedM)} m with ${v.drivers.join(', ')}: a drive, re-armed later`); this.setPark(null); }
        else if (v.kind === 'theft') theft = { movedM: v.movedM, at: pos, why: v.why };
      }
    }

    if (s.alerts.chargerPlugEntity && this.brain.ha.configured() && now - this.plugPolledAt > 60_000) {
      this.plugPolledAt = now;
      try { const e = await this.brain.ha.state(s.alerts.chargerPlugEntity); this.pluggedIn = ['on', 'true', 'plugged', 'connected', 'charging'].includes(e.state.toLowerCase()) ? true : ['off', 'false', 'unplugged', 'disconnected', 'available'].includes(e.state.toLowerCase()) ? false : null; }
      catch { this.pluggedIn = null; }
      this.brain.setPluggedIn(this.pluggedIn);
    }

    const tpms = st.tpms ? (['fl', 'fr', 'rl', 'rr'] as const).flatMap((w) => (st.tpms![w].psi !== null ? [{ wheel: w, psi: st.tpms![w].psi! }] : [])) : [];
    const fired = this.engine.evaluate({
      now, parked,
      cabinTempF: st.cabinTempF ?? this.watch.cabinTempF, aux12v: st.aux12v ?? this.watch.aux12v,
      tpms, truckboxOnline: st.truckbox, truckboxOfflineSince: this.truckboxOfflineSince,
      motion: this.motion, theft, position: pos, soc: st.soc, pluggedIn: this.pluggedIn,
      chargePeak: st.chargePeak,
    });
    this.motion = null;
    for (const f of fired) void this.deliver(f);

    // Tier 2: back to sleep after a remote wake with nobody watching.
    this.power.observe(st.ignition, st.ignition !== true ? this.watch.piAwake : null);
    const busy = this.dashcam.clips(20).some((c) => c.state === 'recording') ? 'cutting a dashcam clip' : null;
    const d = this.power.decide({ sleepAfterMin: s.power.sleepAfterMin, maxAwakeMin: s.power.maxAwakeMin, busy });
    if (d.action === 'sleep') this.sleep(d.why);
  }

  private setPark(p: LatLon | null) {
    this.park = p;
    try { kvSet(this.db, 'remote.park', p); } catch { /* best effort */ }
  }

  /** Driver names whose phone is at the truck; null = can't tell (no HA, or no trackers set). Cached for a minute. */
  private async driversNear(pos: LatLon): Promise<string[] | null> {
    if (this.presenceCache && Date.now() - this.presenceCache.at < 60_000) return this.presenceCache.names;
    let names: string[] | null = null;
    const drivers = this.brain.settings.get().drivers.filter((d) => d.tracker);
    if (this.brain.ha.configured() && drivers.length) {
      const presence = new Map<string, { lat: number; lon: number; at: number } | null>();
      let any = false;
      for (const d of drivers) {
        if (presence.has(d.tracker!)) continue;
        try { presence.set(d.tracker!, presenceOf(await this.brain.ha.state(d.tracker!))); any = true; } catch { presence.set(d.tracker!, null); }
      }
      names = any ? driversAtTruck(drivers, presence, pos).map((d) => d.name) : null;
    }
    this.presenceCache = { at: Date.now(), names };
    return names;
  }

  // ---- alerts ----------------------------------------------------------------

  private async deliver(f: Fired) {
    const r = await this.notifier.send({ ...f, clickUrl: null }, this.brain.settings.get(), this.store.get().alerts);
    const a = this.record(f, 'brain', r);
    console.log(`[alerts] ${f.kind}: ${f.title} -> ${a.delivered.join(', ') || 'not delivered'}${a.error ? ` (${a.error})` : ''}`);
  }

  private record(f: Pick<Fired, 'kind' | 'title' | 'message' | 'priority'>, source: Alert['source'], r: { delivered: string[]; error: string | null }, at = new Date().toISOString()): Alert {
    const res = this.db.prepare('INSERT INTO remote_alerts (at, kind, title, message, source, delivered, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(at, f.kind, f.title, f.message, source, JSON.stringify(r.delivered), r.error);
    const a: Alert = { id: Number(res.lastInsertRowid), at, kind: f.kind, title: f.title, message: f.message, source, delivered: r.delivered, error: r.error };
    this.brain.emit('alert', a);
    return a;
  }

  alerts(limit = 50): Alert[] {
    const rows = this.db.prepare('SELECT * FROM remote_alerts ORDER BY at DESC, id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({ id: Number(r.id), at: String(r.at), kind: r.kind as AlertKind, title: String(r.title), message: String(r.message), source: r.source as Alert['source'], delivered: JSON.parse(String(r.delivered)), error: (r.error as string | null) ?? null }));
  }

  async testAlert(): Promise<Alert> {
    const f: Fired = { kind: 'motionParked', title: 'Test alert from the truck', message: 'If you can read this on your phone, truck alerts work.', priority: 'default' };
    const r = await this.notifier.send({ ...f, clickUrl: null }, this.brain.settings.get(), this.store.get().alerts);
    return this.record(f, 'brain', r);
  }

  // ---- power -----------------------------------------------------------------

  /** Back to sleep: tell the watch to drop the wake line, then shut down cleanly. */
  sleep(why: string) {
    if (this.power.sleeping) return;
    this.power.sleeping = true;
    const s = this.store.get();
    const sent = this.brain.mqtt?.publish(`${s.watch.prefix}/command`, watchCommand.sleep(), { qos: 1 }) ?? false;
    console.log(`[power] going to sleep: ${why}${sent ? '' : ' (MQTT down: the watch will time the wake out by itself)'}`);
    if (this.sim) { console.log('[power] SIM: not powering off; the next viewer "wakes" it'); return; }
    if (!remoteConfig.poweroffCmd) { console.log('[power] POWEROFF_CMD empty: staying up'); return; }
    const [cmd, ...args] = remoteConfig.poweroffCmd.split(/\s+/);
    setTimeout(() => execFile(cmd, args, (e) => { if (e) { console.error(`[power] ${remoteConfig.poweroffCmd}: ${e.message}`); this.power.sleeping = false; } }), 5000);
  }

  /** "Wake & view cameras": if this answers, the Pi is up. Keep it up and tell the watch to hold the line. */
  wake(viewerId: string): PowerStatus {
    if (this.power.sleeping) this.power.rearm();
    this.power.ping(viewerId, 'wake');
    this.brain.mqtt?.publish(`${this.store.get().watch.prefix}/command`, watchCommand.wake(), { qos: 1 });
    return this.powerStatus();
  }

  powerStatus(): PowerStatus {
    const s = this.store.get();
    const busy = null;
    const d = this.power.decide({ sleepAfterMin: s.power.sleepAfterMin, maxAwakeMin: s.power.maxAwakeMin, busy });
    return { awakeReason: d.awakeReason, viewers: d.viewers, sleepAt: d.sleepAt ? new Date(d.sleepAt).toISOString() : null, sleeping: this.power.sleeping, why: d.why };
  }

  /** Relay from the Truck page: through the truck box if it's here, else queued to the watch (it forwards over its UART link). */
  relay(id: string, on: boolean): { ok: boolean; via: 'truckbox' | 'watch' | null; error?: string } {
    const r = this.brain.setRelay(id, on);
    if (r.ok) return { ok: true, via: 'truckbox' };
    if (this.watch.online && this.brain.mqtt?.publish(`${this.store.get().watch.prefix}/command`, watchCommand.relay(id, on), { qos: 1 })) return { ok: true, via: 'watch' };
    return { ok: false, via: null, error: r.error };
  }

  // ---- out -------------------------------------------------------------------

  snapshot(): TruckSnapshot {
    const st = this.brain.getState();
    const position = st.gps?.fix ? { lat: st.gps.lat, lon: st.gps.lon, at: st.ts, source: 'gps' as const }
      : this.watch.lat !== null && this.watch.lon !== null ? { lat: this.watch.lat, lon: this.watch.lon, at: this.watch.gpsAt, source: 'watch' as const } : null;
    return {
      ts: new Date().toISOString(), truckId: this.brain.settings.get().truckId, position,
      soc: st.soc, rangeMi: st.rangeMi, aux12v: st.aux12v ?? this.watch.aux12v, cabinTempF: st.cabinTempF ?? this.watch.cabinTempF,
      ignition: st.ignition ?? this.watch.ignition, gear: st.gear, speedMph: st.speedMph, truckbox: st.truckbox, relays: st.relays,
      lastSeen: new Date().toISOString(), watch: { ...this.watch }, power: this.powerStatus(), alerts: this.alerts(20), clips: this.clips(12),
      place: st.place ? { name: st.place.name, since: st.place.since } : null,
    };
  }

  clips(limit = 100): Clip[] { return this.dashcam.clips(limit); }

  saveClip(camera?: string): Clip[] {
    const d = this.store.get().dashcam;
    const cams = camera ? [camera].filter((c) => this.cams.recordedCameras().includes(c)) : this.cams.recordedCameras();
    return this.dashcam.saveClip(cams, d.preSec, d.postSec, 'manual');
  }

  camStatus() {
    const st = this.dashcam.stats();
    return this.cams.status(st, this.dashcam.lastError);
  }

  /** SIM: a watch that reports what the simulated truck does. */
  private simWatch() {
    const st = this.brain.getState();
    this.watch = {
      ...this.watch, online: true, lastSeen: new Date().toISOString(),
      ...(st.gps?.fix ? { lat: st.gps.lat, lon: st.gps.lon, fix: true, gpsAt: new Date().toISOString() } : {}),
      aux12v: st.aux12v, cabinTempF: st.cabinTempF, vibration: 0, moved: false, ignition: st.ignition, piAwake: true, rssi: -87, backupMv: 3950, fw: 'sim',
    };
  }
}

