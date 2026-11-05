// The brain's core: one State, fed by the truck box (MQTT or SIM) and GPS
// (gpsd or SIM), with SoC, trips and charge sessions derived from it.
import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { kvGet, kvSet, type Db } from './db.ts';
import { haversineMi } from './geo.ts';
import { GpsdClient, type GpsFix } from './gps.ts';
import { chargesTopic, discoveryConfigs, haEntityStateTopic, stateTopic, statusTopic, tripEndedTopic } from './ha.ts';
import { MqttLink } from './mqtt.ts';
import { RELAY_IDS, type SettingsStore } from './settings.ts';
import { SimTruck } from './sim.ts';
import { rangeMi, SocModel, type SocChange, type SocSnapshot } from './soc.ts';
import { TripDetector } from './tripDetector.ts';
import { TripStore } from './trips.ts';
import { applyTruckbox, parseTruckbox } from './truckbox.ts';
import { ChargerFinder } from './chargers/finder.ts';
import { ChargeService } from './charges/service.ts';
import { ChargeStore } from './charges/store.ts';
import type { Health, Settings, State } from './types.ts';

/** Ignore GPS jumps faster than this between fixes (multipath, cold start). */
const MAX_PLAUSIBLE_MPH = 120;
/** GPS jitter while parked shouldn't drain the estimate or grow a trip. */
const MIN_MOVING_MPH = 1;

export class Brain extends EventEmitter {
  readonly startedAt = Date.now();
  readonly trips: TripStore;
  readonly finder: ChargerFinder;
  readonly charges: ChargeService;
  readonly mqtt: MqttLink | null;
  private gpsd: GpsdClient | null = null;
  private sim: SimTruck | null = null;
  private soc: SocModel;
  private detector: TripDetector;
  private tilt = { pitch: null as number | null, roll: null as number | null };
  private lastFix: GpsFix | null = null;
  private lastGpsAt = 0;
  private haKwh: number | null = null;
  private s: State;
  private tickTimer: NodeJS.Timeout | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private lastStatePub = 0;
  private socSaveAt = 0;
  private discoveryOn = false;

  private db: Db;
  readonly settings: SettingsStore;

  constructor(db: Db, settings: SettingsStore) {
    super();
    this.db = db;
    this.settings = settings;
    this.setMaxListeners(100);
    const st = settings.get();
    this.trips = new TripStore(db);
    const orphans = this.trips.closeOrphans();
    if (orphans) console.log(`[trips] closed ${orphans} trip(s) left open by a restart`);
    this.finder = new ChargerFinder(db);
    this.charges = new ChargeService(new ChargeStore(db));
    this.soc = new SocModel(kvGet<SocSnapshot>(db, 'soc') ?? undefined, (c) => this.onSocAnchor(c));
    this.detector = new TripDetector(false);
    this.s = {
      ts: new Date().toISOString(),
      speedMph: null, soc: null, socSource: null, rangeMi: null, gear: null, gps: null,
      ignition: null, reverse: null, cabinTempF: null, aux12v: null, tilt: null, tpms: null,
      relays: Object.fromEntries(RELAY_IDS.map((id) => [id, { name: st.relays[id], on: null }])),
      fiveSwitch: [null, null, null, null, null],
      trip: null, truckbox: false,
    };
    this.mqtt = config.mqttDisabled ? null : new MqttLink(config.mqttUrl, statusTopic(st.truckId));
    settings.onChange((next, prev) => this.onSettings(next, prev));
    this.charges.onChange(() => this.publishCharges());
  }

  start() {
    const st = this.settings.get();
    this.mqtt?.start((topic, payload) => this.onMqtt(topic, payload), () => this.onMqttUp());
    this.mqtt?.setSubscriptions(this.subscriptions(st));
    if (config.sim) {
      console.log(`[sim] simulated truck around Phoenix${config.simSpeedup > 1 ? ` at ${config.simSpeedup}x` : ''}`);
      if (this.soc.value === null) this.soc.setManual(78);
      this.sim = new SimTruck((sub, p) => this.onTruckbox(sub, p), (f) => this.onFix(f), config.simSpeedup);
      this.sim.start();
    } else {
      this.gpsd = new GpsdClient(config.gpsdHost, config.gpsdPort, (f) => this.onFix(f));
      this.gpsd.start();
    }
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  async stop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.sim?.stop();
    this.gpsd?.stop();
    this.saveSoc(true);
    await this.mqtt?.stop().catch(() => {});
  }

  // ---- inputs ------------------------------------------------------------

  private subscriptions(st: Settings): string[] {
    const t = [`${st.truckId}/truckbox/#`];
    if (st.homeAssistant.homeChargerEnergyEntity) t.push(haEntityStateTopic(st.homeAssistant.homeChargerEnergyEntity));
    return t;
  }

  private onMqtt(topic: string, payload: string) {
    const st = this.settings.get();
    const prefix = `${st.truckId}/truckbox/`;
    if (topic.startsWith(prefix)) {
      if (config.sim) return; // the simulated truck box owns these topics on a desk
      this.onTruckbox(topic.slice(prefix.length), payload);
      return;
    }
    const ent = st.homeAssistant.homeChargerEnergyEntity;
    if (ent && topic === haEntityStateTopic(ent)) {
      const v = Number(payload.replace(/^"|"$/g, ''));
      this.haKwh = Number.isFinite(v) && v >= 0 ? v : null;
    }
  }

  private onTruckbox(sub: string, payload: string) {
    const p = parseTruckbox(sub, payload);
    if (!p) return;
    if (p.truckbox === undefined && !this.s.truckbox) this.s.truckbox = true; // data implies it is up
    applyTruckbox(this.s, p, this.tilt);
    this.changed();
  }

  private onFix(f: GpsFix) {
    const prev = this.lastFix;
    this.lastFix = f;
    this.lastGpsAt = Date.now();
    this.s.gps = { lat: f.lat, lon: f.lon, headingDeg: f.headingDeg, fix: f.fix };
    this.s.speedMph = f.speedMph;
    if (prev && prev.fix && f.fix) {
      const mi = haversineMi(prev, f);
      const hours = Math.max(0.2, (f.at.getTime() - prev.at.getTime()) / 1000) / 3600;
      const moving = (f.speedMph ?? mi / hours) >= MIN_MOVING_MPH;
      // SIM_SPEEDUP packs several simulated seconds into one real one.
      const limit = MAX_PLAUSIBLE_MPH * (config.sim ? config.simSpeedup : 1);
      if (moving && mi / hours <= limit && mi > 0) this.addMiles(mi);
    }
    if (this.s.trip && f.fix) this.trips.addPoint(this.s.trip.id, { t: f.at, lat: f.lat, lon: f.lon, speedMph: f.speedMph, headingDeg: f.headingDeg });
    this.changed();
  }

  private addMiles(mi: number) {
    const st = this.settings.get();
    this.soc.addMiles(mi, st.efficiencyMiPerKwh, st.packKwh);
    if (this.s.trip) {
      this.s.trip.miles = Math.round((this.s.trip.miles + mi) * 1000) / 1000;
      this.trips.addMiles(this.s.trip.id, mi);
    }
    this.saveSoc();
  }

  /** Manual charge level from the UI (WS {"type":"soc"}). */
  setManualSoc(v: number) {
    this.soc.setManual(v);
    this.saveSoc(true);
    this.changed();
  }

  /** Relay command (WS {"type":"relay"}). State changes only when the truck box echoes it. */
  setRelay(id: string, on: boolean): { ok: boolean; error?: string } {
    if (!(RELAY_IDS as readonly string[]).includes(id)) return { ok: false, error: `unknown relay ${id}` };
    if (this.sim) { this.sim.command(id, on); return { ok: true }; }
    if (!this.s.truckbox) return { ok: false, error: 'truck box offline' };
    const sent = this.mqtt?.publish(`${this.settings.get().truckId}/truckbox/switch/${id}/command`, on ? 'ON' : 'OFF', { qos: 1 }) ?? false;
    return sent ? { ok: true } : { ok: false, error: 'MQTT broker not connected' };
  }

  private onSocAnchor(c: SocChange) {
    const st = this.settings.get();
    const parked = this.s.speedMph === null || this.s.speedMph < MIN_MOVING_MPH;
    try {
      const session = this.charges.onSocAnchor(c, {
        settings: st, parked,
        gps: this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null,
        homeChargerKwh: st.homeAssistant.homeChargerEnergyEntity ? this.haKwh : null,
        nearestStation: (lat, lon) => this.finder.nearestKnown(lat, lon),
      });
      if (session) console.log(`[charges] ${session.place} session #${session.id}: ${c.prev}% -> ${c.next}%${session.cost !== null ? `, $${session.cost.toFixed(2)}` : ', cost to enter'}`);
    } catch (e) { console.error('[charges] detection failed', e); }
  }

  // ---- periodic ------------------------------------------------------------

  private tick() {
    const now = Date.now();
    // A fix older than 10 s is no fix.
    if (this.s.gps && now - this.lastGpsAt > 10_000) {
      this.s.gps = { ...this.s.gps, fix: false };
      this.s.speedMph = null;
      this.changed();
    }
    const ev = this.detector.update({ t: now, ignition: this.s.ignition, speedMph: this.s.speedMph });
    const st = this.settings.get();
    const pos = this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null;
    if (ev?.type === 'start') {
      const t = this.trips.start(new Date(now), this.soc.value, pos);
      this.s.trip = { id: t.id, startedAt: t.startedAt, miles: 0 };
      if (pos && this.lastFix) this.trips.addPoint(t.id, { t: new Date(now), lat: pos.lat, lon: pos.lon, speedMph: this.s.speedMph, headingDeg: this.s.gps?.headingDeg ?? null });
      console.log(`[trips] #${t.id} started (${ev.reason})`);
      this.changed();
    } else if (ev?.type === 'end' && this.s.trip) {
      const t = this.trips.end(this.s.trip.id, new Date(now), this.soc.value, pos, st.efficiencyMiPerKwh, ev.reason);
      this.s.trip = null;
      if (t) {
        console.log(`[trips] #${t.id} ended (${ev.reason}): ${t.miles.toFixed(1)} mi`);
        this.mqtt?.publish(tripEndedTopic(st.truckId), JSON.stringify(t), { qos: 1 });
        this.emit('trip', t);
      }
      this.saveSoc(true);
      this.changed();
    }
  }

  private saveSoc(force = false) {
    if (!force && Date.now() - this.socSaveAt < 30_000) return;
    this.socSaveAt = Date.now();
    try { kvSet(this.db, 'soc', this.soc.snapshot()); } catch (e) { console.error('[soc] save', e); }
  }

  // ---- outputs -------------------------------------------------------------

  getState(): State {
    const st = this.settings.get();
    const soc = this.soc.value === null ? null : Math.round(this.soc.value * 10) / 10;
    const r = rangeMi(soc, st.packKwh, st.efficiencyMiPerKwh);
    return {
      ...this.s,
      ts: new Date().toISOString(),
      speedMph: this.s.speedMph === null ? null : Math.round(this.s.speedMph * 10) / 10,
      soc, socSource: soc === null ? null : this.soc.source,
      rangeMi: r === null ? null : Math.round(r),
      trip: this.s.trip ? { ...this.s.trip, miles: Math.round(this.s.trip.miles * 100) / 100 } : null,
      relays: Object.fromEntries(Object.entries(this.s.relays).map(([k, v]) => [k, { ...v }])),
      fiveSwitch: [...this.s.fiveSwitch],
    };
  }

  health(): Health {
    const mqtt = !this.mqtt ? 'disabled' : this.mqtt.status === 'connected' ? 'connected' : `${this.mqtt.status}${this.mqtt.lastError ? ` (${this.mqtt.lastError})` : ''}`;
    const gps = this.sim ? 'sim' : this.gpsd?.status ?? 'no gpsd';
    return { ok: true, version: config.version, mqtt, gps, uptimeS: Math.round((Date.now() - this.startedAt) / 1000) };
  }

  private changed() {
    this.emit('change');
    // MQTT state: retained, at most once a second.
    if (this.stateTimer) return;
    const wait = Math.max(0, 1000 - (Date.now() - this.lastStatePub));
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.lastStatePub = Date.now();
      this.mqtt?.publish(stateTopic(this.settings.get().truckId), JSON.stringify(this.getState()), { retain: true });
    }, wait);
  }

  private onMqttUp() {
    const st = this.settings.get();
    this.publishDiscovery(st);
    this.mqtt?.publish(stateTopic(st.truckId), JSON.stringify(this.getState()), { retain: true });
    this.publishCharges();
  }

  /** homeAssistant.bridge on: publish discovery; off: clear it, so HA drops the entities. */
  private publishDiscovery(st: Settings, prevId?: string) {
    if (!this.mqtt?.connected) return;
    if (prevId && prevId !== st.truckId) for (const d of discoveryConfigs(prevId, config.version)) this.mqtt.publish(d.topic, '', { retain: true });
    if (st.homeAssistant.bridge) {
      for (const d of discoveryConfigs(st.truckId, config.version)) this.mqtt.publish(d.topic, JSON.stringify(d.payload), { retain: true, qos: 1 });
      this.discoveryOn = true;
    } else if (this.discoveryOn || prevId !== undefined) {
      for (const d of discoveryConfigs(st.truckId, config.version)) this.mqtt.publish(d.topic, '', { retain: true });
      this.discoveryOn = false;
    }
  }

  private publishCharges() {
    try {
      this.mqtt?.publish(chargesTopic(this.settings.get().truckId), JSON.stringify(this.charges.haSummary()), { retain: true });
    } catch (e) { console.error('[charges] publish', e); }
    this.emit('charges');
  }

  private onSettings(next: Settings, prev: Settings) {
    for (const id of RELAY_IDS) this.s.relays[id].name = next.relays[id];
    if (next.truckId !== prev.truckId && this.mqtt) {
      this.mqtt.publish(statusTopic(prev.truckId), 'offline', { retain: true });
      console.warn('[mqtt] truck id changed; restart the brain so the last-will topic follows it');
    }
    this.mqtt?.setSubscriptions(this.subscriptions(next));
    if (next.truckId !== prev.truckId || next.homeAssistant.bridge !== prev.homeAssistant.bridge) this.publishDiscovery(next, prev.truckId);
    this.changed();
  }
}
