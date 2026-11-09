// The brain's core: one State, fed by the truck box (MQTT or SIM) and GPS
// (gpsd or SIM), with SoC, trips, stops and charge sessions derived from it.
import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import { kvGet, kvSet, type Db } from './db.ts';
import { haversineMi, metersBetween } from './geo.ts';
import { GpsdClient, type GpsFix } from './gps.ts';
import { chargesTopic, discoveryConfigs, goalTopic, haEntityStateTopic, stateTopic, statusTopic, tripEndedTopic } from './ha.ts';
import { HaClient, presenceOf } from './ha/client.ts';
import { MqttLink } from './mqtt.ts';
import { RELAY_IDS, type SettingsStore } from './settings.ts';
import { SimTruck } from './sim.ts';
import { rangeMi, SocModel, type SocChange, type SocSnapshot } from './soc.ts';
import { TripDetector } from './tripDetector.ts';
import { TripStore } from './trips.ts';
import { applyTruckbox, parseTruckbox } from './truckbox.ts';
import { ChargerFinder, type FinderSettings } from './chargers/finder.ts';
import { ChargeService, isHome } from './charges/service.ts';
import { chargePeakState, powerKw } from './charges/peak.ts';
import { ChargeStore } from './charges/store.ts';
import { SampleStore } from './roadtrip/samples.ts';
import { RoadTripService } from './roadtrip/service.ts';
import { TrafficService } from './traffic/service.ts';
import { ContactService, SYNC_MS as CONTACT_SYNC_MS } from './contacts/service.ts';
import { PickupService } from './pickup/service.ts';
import { HazardService } from './hazards/service.ts';
import { DEMO_CONTACTS, DEMO_DESTINATIONS, DEMO_TRIPS } from './demo/world.ts';
import { genericCurve, kwAt } from './roadtrip/curve.ts';
import { sameNowPlaying } from './media.ts';
import { StopDetector, type StopEvent } from './stops/detector.ts';
import { StopService } from './stops/service.ts';
import { Geocoder } from './places/geocode.ts';
import { GasService, POLL_MS } from './gas/gas.ts';
import { VehicleLookup } from './gas/vehicles.ts';
import { PhoneImporter } from './import/phone.ts';
import { NetManager, pickBackend, SimBackend, UnavailableBackend } from './network.ts';
import { DriveService } from './drive/service.ts';
import { GoalService } from './goal/service.ts';
import { goalLine } from './goal/ledger.ts';
import { demoArea } from './demo/area.ts';
import type { CompareVehicle, Driver, Health, NowPlaying, Settings, State, Stop } from './types.ts';

/** Ignore GPS jumps faster than this between fixes (multipath, cold start). */
const MAX_PLAUSIBLE_MPH = 120;
/** GPS jitter while parked shouldn't drain the estimate or grow a trip. */
const MIN_MOVING_MPH = 1;
/** A phone tracker this close to the truck, heard from this recently, is "at the truck". */
export const PRESENCE_M = 150;
export const PRESENCE_MAX_AGE_MS = 10 * 60_000;
/** The suggestion may still pick the driver while the trip is this young; after that it never switches. */
const SUGGEST_WINDOW_MS = 2 * 60_000;
const SUGGEST_WINDOW_MI = 0.3;

/** Drivers whose phone is at the truck: within PRESENCE_M and heard from in the last PRESENCE_MAX_AGE_MS. Pure. */
export function driversAtTruck(drivers: Driver[], presence: Map<string, { lat: number; lon: number; at: number } | null>, truck: { lat: number; lon: number }, now = Date.now()): Driver[] {
  return drivers.filter((d) => {
    const p = d.tracker ? presence.get(d.tracker) : null;
    return !!p && now - p.at <= PRESENCE_MAX_AGE_MS && metersBetween(p, truck) <= PRESENCE_M;
  });
}

/** SIM: the simulated truck's own DC curve (peaks at 110 kW, not the generic 120). */
const SIM_TRUE_CURVE = genericCurve(110);

export class Brain extends EventEmitter {
  readonly startedAt = Date.now();
  readonly trips: TripStore;
  readonly finder: ChargerFinder;
  readonly charges: ChargeService;
  readonly ha: HaClient;
  readonly stops: StopService;
  readonly gas: GasService;
  readonly vehicles: VehicleLookup;
  readonly importer: PhoneImporter;
  readonly net: NetManager;
  readonly drive: DriveService;
  readonly goal: GoalService;
  /** DC charging-rate samples: the learned charging curve and how each site performed. */
  readonly samples: SampleStore;
  /** Road-trip planner and the active trip. */
  readonly roadTrip: RoadTripService;
  /** 511 cameras and incidents ahead, and enforcement cameras (OpenStreetMap). */
  readonly traffic: TrafficService;
  /** Address books (Outlook, Google, CardDAV), synced: trip destinations and call buttons. */
  readonly contacts: ContactService;
  /** Airport pickup: one flight followed by ADS-B, and when to leave. */
  readonly pickup: PickupService;
  /** Sends a notification to the driver's phone (set by Track C at start-up). */
  pushToPhone: ((title: string, message: string, clickUrl: string | null) => Promise<void>) | null = null;
  private lastPickupTick = 0;
  /** Warnings, storms, wind and fires along the trip (or around the truck). */
  readonly hazards: HazardService;
  private lastHazardTick = 0;
  private lastContactSync = 0;
  private lastGeocode = 0;
  private lastTrafficTick = 0;
  private lastTripTick = 0;
  private goalTimer: NodeJS.Timeout | null = null;
  private goalSoon: NodeJS.Timeout | null = null;
  private netTimer: NodeJS.Timeout | null = null;
  readonly mqtt: MqttLink | null;
  private gpsd: GpsdClient | null = null;
  private sim: SimTruck | null = null;
  /** The simulated truck (SIM=1 only), for the test panel's routes. */
  get simTruck(): SimTruck | null { return this.sim; }
  /** Charge level and range, for the test panel. */
  get socNow(): { soc: number | null; rangeMi: number | null } { const s = this.getState(); return { soc: s.soc, rangeMi: s.rangeMi }; }
  private soc: SocModel;
  private detector: TripDetector;
  private stopDet: StopDetector;
  private openStop: Stop | null = null;
  private lastClosedStop: { id: number; at: number } | null = null;
  private driverId: string;
  private tilt = { pitch: null as number | null, roll: null as number | null };
  private lastFix: GpsFix | null = null;
  private lastGpsAt = 0;
  private haKwh: number | null = null;
  /** Wall charger power (kW) from Settings.homeAssistant.homeChargerPowerEntity, and when it was read. */
  private haPower: { kw: number | null; plugged: boolean | null; at: number } = { kw: null, plugged: null, at: 0 };
  private powerPolling = false;
  private pluggedIn: boolean | null = null;
  private canCharging: boolean | null = null;
  private s: State;
  private tickTimer: NodeJS.Timeout | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private slowTimer: NodeJS.Timeout | null = null;
  private geoTimer: NodeJS.Timeout | null = null;
  private refreshSoon: NodeJS.Timeout | null = null;
  private lastStatePub = 0;
  private socSaveAt = 0;
  /** SIM: charge gained since the last anchor, in percentage points. */
  private simChargeOwed = 0;
  private simWasCharging = false;
  private discoveryOn = false;

  readonly db: Db;
  readonly settings: SettingsStore;

  constructor(db: Db, settings: SettingsStore) {
    super();
    this.db = db;
    this.settings = settings;
    this.setMaxListeners(100);
    const st = settings.get();
    this.trips = new TripStore(db, { sim: config.sim });
    const orphans = this.trips.closeOrphans();
    if (orphans) console.log(`[trips] closed ${orphans} trip(s) left open by a restart`);
    this.finder = new ChargerFinder(db);
    this.charges = new ChargeService(new ChargeStore(db, { sim: config.sim }));
    this.ha = new HaClient(() => this.settings.get());
    this.stops = new StopService(db, this.ha, () => this.settings.get(), config.geocodeDisabled ? null : new Geocoder(db, config.version));
    this.gas = new GasService(db, this.ha, () => this.settings.get());
    this.vehicles = new VehicleLookup(db);
    this.importer = new PhoneImporter(db, this.trips, this.stops, this.ha, settings);
    this.soc = new SocModel(kvGet<SocSnapshot>(db, 'soc') ?? undefined, (c) => this.onSocAnchor(c));
    this.detector = new TripDetector(false);
    this.stopDet = new StopDetector(config.sim ? config.simSpeedup : 1);
    const saved = kvGet<string>(db, 'activeDriver');
    this.driverId = settings.driver(saved)?.id ?? st.drivers.find((d) => !d.guest)?.id ?? st.drivers[0].id;
    this.openStop = this.stops.stops.openTruckStop();
    if (this.openStop) this.stopDet.restore({ at: Date.parse(this.openStop.arrivedAt), lat: this.openStop.lat, lon: this.openStop.lon, reason: this.openStop.reason });
    this.s = {
      ts: new Date().toISOString(),
      speedMph: null, soc: null, socSource: null, rangeMi: null, gear: null, gps: null,
      ignition: null, reverse: null, cabinTempF: null, aux12v: null, tilt: null, tpms: null,
      relays: Object.fromEntries(RELAY_IDS.map((id) => [id, { name: st.relays[id], on: null, watts: st.relayWatts[id] }])),
      fiveSwitch: [null, null, null, null, null],
      trip: null, truckbox: false, nowPlaying: null,
      driver: null, driverSuggestion: null, place: null,
      network: null as unknown as State['network'],
      drive: null,
      chargePeak: null,
    };
    this.mqtt = config.mqttDisabled ? null : new MqttLink(config.mqttUrl, statusTopic(st.truckId));
    settings.onChange((next, prev) => this.onSettings(next, prev));
    this.charges.onChange(() => this.publishCharges());
    this.stops.on('renamed', () => this.refreshPlace());
    this.importer.onDone = () => this.emit('import');
    this.net = new NetManager(new UnavailableBackend('starting up'), () => this.settings.get(), () => this.driverId,
      kvGet(db, 'netBytes'), (b) => { try { kvSet(db, 'netBytes', b); } catch { /* best effort */ } }, () => this.changed());
    this.drive = new DriveService({
      db, settings, version: config.version, sim: config.sim, timeScale: config.sim ? config.simSpeedup : 1,
      charges: () => this.charges.store.list(null, null, null),
      tripsSince: (iso) => this.trips.between(iso, null, { source: 'truck' }),
      tiers: () => this.stops.tiers(),
      changed: () => this.changed(),
    }, () => ({
      speedMph: this.s.speedMph, gps: this.s.gps, soc: this.soc.value, socSource: this.soc.value === null ? null : this.soc.source,
      cabinTempF: this.s.cabinTempF, ignition: this.s.ignition, tilt: this.s.tilt, tripId: this.s.trip?.id ?? null,
      online: this.net.status?.link !== 'offline' || this.net.status?.backend !== 'nmcli',
    }));
    this.charges.onChange(() => this.drive.refreshSince());
    this.samples = new SampleStore(db, { sim: config.sim });
    this.finder.setPerformance((lat, lon) => this.samples.sitePerformance(lat, lon));
    this.roadTrip = new RoadTripService({
      db, finder: this.finder, samples: this.samples, router: config.routerUrl,
      presets: () => (config.demo ? DEMO_TRIPS : []),
      gasCompare: () => {
        const v = this.compareVehicle(this.driverId);
        const g = this.gas.status(v.fuel);
        const price = g.today?.price ?? g.manualPrice;
        return v && v.mpgHighway > 0 && price > 0 ? { label: v.label, mpg: v.mpgHighway, pricePerGallon: price } : null;
      },
      destinations: () => [
        ...(config.demo ? DEMO_DESTINATIONS : this.stops.placesWithVisits(null).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, placeId: p.id, kind: p.kind, chargeKw: p.chargeKw }))),
        ...this.contacts.places(),
      ],
      settings: () => this.finderSettings(),
      soc: () => this.soc.value,
      gps: () => (this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null),
      speedMph: () => this.s.speedMph,
      charging: () => this.isCharging(),
      tempF: () => this.drive.weather.report?.current.tempF ?? null,
      highwayEff: () => this.drive.highwayEff(),
      sessionId: () => this.openSessionId(),
      timeScale: () => { const p = this.sim?.status().charging; return p ? p.timeScale * config.simSpeedup : 1; },
    });
    this.roadTrip.onChange(() => this.changed());
    this.contacts = new ContactService({
      db, dataDir: config.dataDir,
      online: () => this.net.status?.link !== 'offline',
      geocode: (q) => this.stops.searchAddress(q),
      demo: config.demo ? DEMO_CONTACTS.map((c) => ({ sourceId: c.sourceId, name: c.name, org: c.org, phones: c.phones, address: c.address })) : null,
      demoPlaces: config.demo ? DEMO_CONTACTS : undefined,
    });
    this.pickup = new PickupService({
      db, router: config.routerUrl,
      gps: () => (this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null),
      online: () => this.net.status?.link !== 'offline',
      notify: async (title, message, clickUrl) => { if (this.pushToPhone) await this.pushToPhone(title, message, clickUrl); },
    });
    this.hazards = new HazardService({
      route: () => this.roadTrip.routeNow(),
      gps: () => (this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null),
      online: () => this.net.status?.link !== 'offline',
      firmsKey: () => this.settings.get().keys.firms ?? null,
      userAgent: `truck-assistant/${config.version} (DIY dash)`,
    });
    this.traffic = new TrafficService({
      db, settings: () => this.settings.get(),
      gps: () => (this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null),
      heading: () => this.s.gps?.headingDeg ?? null,
      speedMph: () => this.s.speedMph,
      online: () => this.net.status?.link !== 'offline',
      route: () => this.roadTrip.routeNow(),
    });
    this.goal = new GoalService(db, () => this.settings.get(), () => this.gas.rows());
    this.charges.onChange(() => this.goalChanged());
    this.on('trip', () => this.goalChanged());
    this.on('gas', () => this.goalChanged());
  }

  start() {
    const st = this.settings.get();
    this.mqtt?.start((topic, payload) => this.onMqtt(topic, payload), () => this.onMqttUp());
    this.mqtt?.setSubscriptions(this.subscriptions(st));
    if (config.sim) {
      console.log(`[sim] simulated truck around Phoenix${config.simSpeedup > 1 ? ` at ${config.simSpeedup}x` : ''}`);
      // DEMO: the charge level reads like the truck's own (CAN), not a number typed in.
      if (config.demo) this.soc.setCan(this.soc.value ?? 74);
      else if (this.soc.value === null) this.soc.setManual(78);
      this.sim = new SimTruck((sub, p) => this.onTruckbox(sub, p), (f) => this.onFix(f), config.simSpeedup, { demo: config.demo });
      this.sim.start();
    } else {
      this.gpsd = new GpsdClient(config.gpsdHost, config.gpsdPort, (f) => this.onFix(f));
      this.gpsd.start();
    }
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.tick();
    // Home Assistant zones, the places feed and gas prices: every 30 min (no-ops without HA).
    void this.slowRefresh();
    this.slowTimer = setInterval(() => void this.slowRefresh(), POLL_MS);
    if (!config.geocodeDisabled) this.geoTimer = setInterval(() => void this.stops.geocodePass(), 60_000);
    this.refreshPlace();
    void pickBackend({ sim: config.sim, iface: config.netClientIface, makeSim: () => new SimBackend(() => (this.s.gps?.fix ? this.s.gps : null), () => this.settings.get(), () => this.driverId) })
      .then((b) => { this.net.setBackend(b); console.log(`[net] ${b.kind}${b.kind === 'nmcli' ? ` on ${config.netClientIface}` : ''}`); return this.net.tick(); })
      .catch((e) => console.error('[net]', e));
    this.netTimer = setInterval(() => void this.net.tick(), 20_000);
    this.drive.start();
    this.refreshGoal();
    // Hourly: closes a month that has ended (freezing it) and keeps "today" current.
    this.goalTimer = setInterval(() => this.refreshGoal(), 3600_000);
  }

  async stop() {
    for (const t of [this.tickTimer, this.slowTimer, this.geoTimer, this.netTimer, this.goalTimer]) if (t) clearInterval(t);
    if (this.goalSoon) clearTimeout(this.goalSoon);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.refreshSoon) clearTimeout(this.refreshSoon);
    this.sim?.stop();
    this.gpsd?.stop();
    this.drive.stop();
    this.saveSoc(true);
    await this.mqtt?.stop().catch(() => {});
  }

  async slowRefresh() {
    try { await this.stops.refreshZones(); } catch (e) { console.error('[stops] zones', e); }
    try { await this.stops.refreshFeed(); } catch (e) { console.error('[stops] feed', e); }
    try { if (await this.gas.poll()) this.emit('gas'); } catch (e) { console.error('[gas] poll', e); }
  }

  /** Plugged in and taking charge: the truck's signal (or the sim's plug), else the wall charger drawing power. */
  isCharging(): boolean {
    if (this.canCharging === true) return true;
    const fresh = Date.now() - this.haPower.at < 120_000;
    return fresh && (this.haPower.kw ?? 0) > 0.5;
  }

  /** The charge session still growing (detected within the last 15 minutes), for the coach's live rate. */
  private openSessionId(): number | null {
    const last = this.charges.store.latest();
    if (!last) return null;
    const end = Date.parse(last.endedAt ?? last.startedAt);
    return Date.now() - end < 15 * 60_000 ? last.id : null;
  }

  // ---- charging on-peak ---------------------------------------------------------

  /** The Track C plug entity's reading (RemoteService polls it). */
  setPluggedIn(v: boolean | null) { this.pluggedIn = v; }

  /** Hook for the truck's own charging signal (CAN, when there is one). Counts only at home. */
  setCanCharging(v: boolean | null) { this.canCharging = v; }

  /** Every 30 s: the wall charger's power sensor from HA (W or kW, by unit_of_measurement). */
  private async pollPower(now: number) {
    const ent = this.settings.get().homeAssistant.homeChargerPowerEntity;
    if (!ent) { if (this.haPower.kw !== null || this.haPower.plugged !== null) this.haPower = { kw: null, plugged: null, at: 0 }; return; }
    if (!this.ha.configured() || this.powerPolling || now - this.haPower.at < 30_000) return;
    this.powerPolling = true;
    try {
      const s = await this.ha.state(ent);
      const a = s.attributes ?? {};
      const status = String(a.status ?? a.charger_status ?? a.state ?? '').toLowerCase();
      const plugged = /connected|plugged|waiting|ready|charging/.test(status) && !/disconnected|unplugged/.test(status) ? true : /disconnected|unplugged|available|idle/.test(status) ? false : null;
      this.haPower = { kw: powerKw(s.state, a.unit_of_measurement), plugged, at: now };
    } catch { this.haPower = { kw: null, plugged: null, at: now }; }
    finally { this.powerPolling = false; }
  }

  private updatePeak(now: number) {
    const st = this.settings.get();
    const gps = this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null;
    const last = this.charges.store.latest();
    const recent = !!last && last.place === 'home' && last.source === 'detected' && now - Date.parse(last.endedAt ?? last.startedAt) < 10 * 60_000;
    const fresh = this.haPower.at && now - this.haPower.at < 120_000;
    const cp = chargePeakState({
      now: new Date(now), rate: st.homeRate, atHome: isHome(st, gps),
      powerKw: fresh ? this.haPower.kw : null, canCharging: this.canCharging, recentHomeSession: recent,
      pluggedIn: this.pluggedIn ?? (fresh ? this.haPower.plugged : null),
    });
    if (JSON.stringify(cp) !== JSON.stringify(this.s.chargePeak)) {
      if (cp.onPeak && !this.s.chargePeak?.onPeak) console.warn(`[charges] ${cp.message}`);
      this.s.chargePeak = cp;
      this.changed();
    }
  }

  // ---- payoff goal -------------------------------------------------------------

  /** Something the ledger reads changed: refresh in a moment (several changes, one pass). */
  goalChanged() {
    if (this.goalSoon) clearTimeout(this.goalSoon);
    this.goalSoon = setTimeout(() => { this.goalSoon = null; this.refreshGoal(); }, 1500);
  }

  refreshGoal() {
    try { this.goal.refresh(); } catch (e) { console.error('[goal] refresh', e); }
    this.publishGoal();
  }

  /** "Truck payoff: $X of $Y (Z%)" for WOPR's truck block; null before there is a start date. */
  goalLine(): string | null {
    try { const g = this.goal.summary(); return g.startDate ? goalLine(g) : null; } catch { return null; }
  }

  private publishGoal() {
    try {
      const g = this.goal.summary();
      this.mqtt?.publish(goalTopic(this.settings.get().truckId), JSON.stringify({
        saved: g.saved, target: g.target, pct: g.pct, thisMonth: g.thisMonth,
        projectedPayoff: g.projection.date, projectionState: g.projection.state,
      }), { retain: true });
    } catch (e) { console.error('[goal] publish', e); }
    this.emit('goal');
  }

  // ---- drivers ---------------------------------------------------------------

  activeDriver(): Driver {
    const st = this.settings.get();
    return this.settings.driver(this.driverId) ?? st.drivers.find((d) => !d.guest) ?? st.drivers[0];
  }

  /** The truck's settings with the active driver's charging prefs, for the charger finder. */
  finderSettings(): FinderSettings { return { ...this.settings.get(), charging: this.activeDriver().charging }; }

  /** The gas vehicle to compare against: the driver's override, else the truck's. */
  compareVehicle(driverId?: string | null): CompareVehicle {
    const d = driverId ? this.settings.driver(driverId) : null;
    return d?.compareVehicle ?? this.settings.get().compareVehicle;
  }

  /** POST /api/driver. A pick during a trip re-attributes that trip: a correction, not a switch. */
  setDriver(id: string): { ok: boolean; error?: string } {
    const d = this.settings.driver(id);
    if (!d) return { ok: false, error: `no driver "${id}"` };
    this.driverId = d.id;
    kvSet(this.db, 'activeDriver', d.id);
    if (this.s.trip) this.trips.setDriver(this.s.trip.id, d.id);
    if (this.openStop) { this.stops.stops.setDriver(this.openStop.id, d.id); this.openStop = { ...this.openStop, driverId: d.id }; }
    this.s.driverSuggestion = null;
    void this.net.tick(); // the driver's phone moves up the list at once
    this.changed();
    return { ok: true };
  }

  dismissSuggestion() { this.s.driverSuggestion = null; this.changed(); }

  /**
   * On ignition: whose phone is at the truck? Exactly one tracker within
   * PRESENCE_M, heard in the last PRESENCE_MAX_AGE_MS: preselect that driver.
   * Otherwise the last driver stays. Never changes a trip that's under way.
   */
  async suggestDriver(): Promise<void> {
    const cur = this.activeDriver();
    const gps = this.s.gps?.fix ? this.s.gps : null;
    let reason = 'Last driver';
    let pick: Driver | null = null;
    if (!this.ha.configured()) reason = 'Last driver (connect Home Assistant on the settings page to spot phones)';
    else if (!gps) reason = 'Last driver (no GPS fix to match phones against)';
    else {
      const drivers = this.settings.get().drivers;
      const presence = new Map<string, { lat: number; lon: number; at: number } | null>();
      for (const d of drivers) {
        if (!d.tracker || presence.has(d.tracker)) continue;
        try { presence.set(d.tracker, presenceOf(await this.ha.state(d.tracker))); } catch { presence.set(d.tracker, null); /* that tracker or HA is away */ }
      }
      const near = driversAtTruck(drivers, presence, gps);
      if (near.length === 1) { pick = near[0]; reason = `${pick.name}'s phone is at the truck`; }
      else if (near.length > 1) reason = `${near.map((d) => d.name).join(' and ')} are both here: pick one`;
      else reason = 'Last driver (no phone at the truck)';
    }
    const t = this.s.trip;
    const young = !t || (Date.now() - Date.parse(t.startedAt) < SUGGEST_WINDOW_MS && t.miles < SUGGEST_WINDOW_MI);
    if (pick && pick.id !== cur.id && young) this.setDriver(pick.id);
    const shown = pick && young ? pick : cur;
    this.s.driverSuggestion = { id: shown.id, name: shown.name, reason };
    this.changed();
  }

  // ---- inputs ------------------------------------------------------------

  /** Topics other modules want (Track C: the tier 1 watch). Each MQTT message is also emitted as 'mqtt'. */
  private extraTopics = new Set<string>();
  addTopics(topics: string[]) {
    for (const t of topics) this.extraTopics.add(t);
    this.mqtt?.setSubscriptions(this.subscriptions(this.settings.get()));
  }

  private subscriptions(st: Settings): string[] {
    const t = [`${st.truckId}/truckbox/#`, ...this.extraTopics];
    if (st.homeAssistant.homeChargerEnergyEntity) t.push(haEntityStateTopic(st.homeAssistant.homeChargerEnergyEntity));
    if (st.homeAssistant.homeChargerPowerEntity) t.push(haEntityStateTopic(st.homeAssistant.homeChargerPowerEntity));
    return t;
  }

  private onMqtt(topic: string, payload: string) {
    this.emit('mqtt', topic, payload);
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
    const pw = st.homeAssistant.homeChargerPowerEntity;
    // mqtt_statestream carries no unit here; the REST poll (which does) wins when HA is configured.
    if (pw && topic === haEntityStateTopic(pw) && !this.ha.configured()) this.haPower = { kw: powerKw(payload, ''), plugged: this.haPower.plugged, at: Date.now() };
  }

  private onTruckbox(sub: string, payload: string) {
    this.drive.onTruckbox(sub, payload);
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
    this.soc.addMiles(mi, this.drive.efficiencyNow() || st.efficiencyMiPerKwh, st.packKwh, new Date(), { canFollows: config.demo });
    this.drive.onMiles(mi, this.s.trip?.id ?? null);
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

  /** Now playing from the cockpit (WS {"type":"media"}); null = nothing playing / CarPlay gone. */
  setNowPlaying(np: NowPlaying | null) {
    if (sameNowPlaying(this.s.nowPlaying, np)) return;
    this.s.nowPlaying = np;
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
        driverId: this.driverId,
      });
      if (session) console.log(`[charges] ${session.place} session #${session.id}: ${c.prev}% -> ${c.next}%${session.cost !== null ? `, $${session.cost.toFixed(2)}` : ', cost to enter'}`);
    } catch (e) { console.error('[charges] detection failed', e); }
  }

  // ---- periodic ------------------------------------------------------------

  /**
   * SIM: while the test panel has the truck plugged in, raise the charge level
   * the way a real charge would arrive: an anchor every 2 points, so the charge
   * history sees one session growing (ChargeService extends it), home sessions
   * are priced from the rate, and a home charge counts for the on-peak warning.
   */
  private simChargeTick() {
    const plug = this.sim?.status().charging ?? null;
    if (!plug) {
      if (this.simWasCharging) { this.simWasCharging = false; this.simChargeOwed = 0; this.setCanCharging(null); }
      return;
    }
    this.simWasCharging = true;
    this.setCanCharging(true);
    const st = this.settings.get();
    const soc = this.soc.value ?? 0;
    if (soc >= plug.targetPct) { this.sim!.unplug(); return; }
    // DC fast follows a charging curve (a little below the generic one, so the learned curve has something to learn).
    const kw = plug.kind === 'fast' ? Math.min(plug.kw, kwAt(SIM_TRUE_CURVE, soc)) : plug.kw;
    this.simChargeOwed += (kw * plug.timeScale * config.simSpeedup) / 3600 / st.packKwh * 100;
    // Anchor every 2 points, but never leave a last step under 2 (ChargeService ignores a rise that small).
    const reached = soc + this.simChargeOwed >= plug.targetPct;
    if (reached || (this.simChargeOwed >= 2 && plug.targetPct - (soc + this.simChargeOwed) >= 2)) {
      const next = Math.min(plug.targetPct, soc + this.simChargeOwed);
      this.simChargeOwed = 0;
      if (config.demo) { this.soc.setCan(next); this.saveSoc(true); this.changed(); } else this.setManualSoc(next);
      if (next >= plug.targetPct) this.sim!.unplug();
    }
  }

  private tick() {
    const now = Date.now();
    if (this.sim) { try { this.simChargeTick(); } catch (e) { console.error('[sim] charge', e); } }
    if (now - this.lastContactSync >= CONTACT_SYNC_MS) {
      this.lastContactSync = now;
      void this.contacts.syncAll().catch((e) => console.error('[contacts]', e));
    } else if (now - this.lastGeocode >= 60_000) {
      this.lastGeocode = now;
      void this.contacts.geocodePass().catch((e) => console.error('[contacts] geocode', e));
    }
    if (now - this.lastHazardTick >= 60_000) {
      this.lastHazardTick = now;
      void this.hazards.tick(now).catch((e) => console.error('[hazards]', e));
    }
    if (now - this.lastPickupTick >= 10_000) {
      this.lastPickupTick = now;
      void this.pickup.tick(now).catch((e) => console.error('[pickup]', e));
    }
    if (now - this.lastTrafficTick >= (this.sim ? 20_000 : 60_000)) {
      this.lastTrafficTick = now;
      void this.traffic.tick(now).catch((e) => console.error('[traffic]', e));
    }
    if (now - this.lastTripTick >= (this.sim ? 10_000 : 30_000)) {
      this.lastTripTick = now;
      void this.roadTrip.tick(now).catch((e) => console.error('[roadtrip]', e));
    }
    // A fix older than 10 s is no fix.
    if (this.s.gps && now - this.lastGpsAt > 10_000) {
      this.s.gps = { ...this.s.gps, fix: false };
      this.s.speedMph = null;
      this.changed();
    }
    const st = this.settings.get();
    const pos = this.s.gps?.fix ? { lat: this.s.gps.lat, lon: this.s.gps.lon } : null;
    // Stops first: one can end the trip (backdated to when the truck stopped).
    if (pos) {
      try { for (const e of this.stopDet.update({ t: now, lat: pos.lat, lon: pos.lon, speedMph: this.s.speedMph, ignition: this.s.ignition })) this.onStopEvent(e); }
      catch (e) { console.error('[stops]', e); }
    }
    const ev = this.detector.update({ t: now, ignition: this.s.ignition, speedMph: this.s.speedMph });
    if (ev?.type === 'start') {
      const from = this.openStop?.id ?? (this.lastClosedStop && now - this.lastClosedStop.at < SUGGEST_WINDOW_MS ? this.lastClosedStop.id : null);
      const t = this.trips.start(new Date(now), this.soc.value, pos, this.driverId, from);
      this.s.trip = { id: t.id, startedAt: t.startedAt, miles: 0 };
      this.net.tripStarted();
      if (pos && this.lastFix) this.trips.addPoint(t.id, { t: new Date(now), lat: pos.lat, lon: pos.lon, speedMph: this.s.speedMph, headingDeg: this.s.gps?.headingDeg ?? null });
      console.log(`[trips] #${t.id} started (${ev.reason}), driver ${this.driverId}`);
      if (ev.reason === 'ignition') void this.suggestDriver().catch((e) => console.error('[drivers] suggest', e));
      this.changed();
    } else if (ev?.type === 'end' && this.s.trip) {
      this.endTrip(new Date(now), pos, ev.reason, this.openStop?.id ?? null);
    }
    void this.pollPower(now);
    try { this.updatePeak(now); } catch (e) { console.error('[charges] peak', e); }
    // The ignition prompt goes away once the drive is properly under way.
    const t = this.s.trip;
    if (this.s.driverSuggestion && t && (now - Date.parse(t.startedAt) > SUGGEST_WINDOW_MS || t.miles > SUGGEST_WINDOW_MI)) {
      this.s.driverSuggestion = null;
      this.changed();
    }
  }

  private endTrip(at: Date, pos: { lat: number; lon: number } | null, reason: string, endStopId: number | null) {
    if (!this.s.trip) return;
    const st = this.settings.get();
    let t = this.trips.end(this.s.trip.id, at, this.soc.value, pos, st.efficiencyMiPerKwh, reason, endStopId);
    this.s.trip = null;
    if (t) { this.drive.onTripEnd(t.id); t = this.trips.get(t.id) ?? t; }
    if (t) {
      console.log(`[trips] #${t.id} ended (${reason}): ${t.miles.toFixed(1)} mi`);
      this.mqtt?.publish(tripEndedTopic(st.truckId), JSON.stringify(t), { qos: 1 });
      this.emit('trip', t);
    }
    this.saveSoc(true);
    this.changed();
  }

  private onStopEvent(e: StopEvent) {
    if (e.type === 'arrive') {
      const stop = this.stops.stops.create({ driverId: this.driverId, source: 'truck', arrivedAt: new Date(e.at).toISOString(), departedAt: null, lat: e.lat, lon: e.lon, reason: e.reason });
      this.openStop = stop;
      if (this.s.trip) {
        this.endTrip(new Date(e.at), { lat: e.lat, lon: e.lon }, e.reason === 'ignition' ? 'ignition off' : 'stop', stop.id);
        this.detector.forceEnd();
      }
      this.openStop = this.stops.nameStop(stop.id) ?? stop;
      console.log(`[stops] #${stop.id} at ${this.openStop.name ?? 'an unnamed spot'} (${e.reason})`);
      this.refreshPlace();
      return;
    }
    const stop = this.openStop;
    this.openStop = null;
    if (!stop) return;
    if (e.short) {
      // Under 3 minutes: not a stop. The trip that ended here carries on.
      const prev = this.trips.endingAt(stop.id);
      if (prev) {
        const cur = this.s.trip && this.s.trip.id !== prev.id ? this.s.trip.id : null;
        const t = this.trips.reopen(prev.id, cur);
        if (t) { this.s.trip = { id: t.id, startedAt: t.startedAt, miles: t.miles }; this.detector.resume(); }
      } else if (this.s.trip) this.trips.setStartStop(this.s.trip.id, null);
      this.stops.stops.delete(stop.id);
      console.log(`[stops] #${stop.id} lasted under 3 min: folded into the trip`);
    } else {
      this.stops.stops.close(stop.id, new Date(e.at).toISOString());
      this.lastClosedStop = { id: stop.id, at: e.at };
    }
    this.refreshPlace();
  }

  private refreshPlace() {
    if (this.openStop) this.openStop = this.stops.stops.get(this.openStop.id);
    const p = this.openStop ? { stopId: this.openStop.id, name: this.openStop.name, since: this.openStop.arrivedAt } : null;
    if (JSON.stringify(p) !== JSON.stringify(this.s.place)) { this.s.place = p; this.changed(); }
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
    const d = this.activeDriver();
    return {
      ...this.s,
      ts: new Date().toISOString(),
      speedMph: this.s.speedMph === null ? null : Math.round(this.s.speedMph * 10) / 10,
      soc, socSource: soc === null ? null : this.soc.source,
      rangeMi: r === null ? null : Math.round(r),
      trip: this.s.trip ? { ...this.s.trip, miles: Math.round(this.s.trip.miles * 100) / 100 } : null,
      relays: Object.fromEntries(Object.entries(this.s.relays).map(([k, v]) => [k, { ...v }])),
      fiveSwitch: [...this.s.fiveSwitch],
      nowPlaying: this.s.nowPlaying ? { ...this.s.nowPlaying } : null,
      driver: { id: d.id, name: d.name, initials: d.initials, color: d.color },
      roadTrip: this.roadTrip.brief(),
      traffic: this.traffic.brief(),
      pickup: this.pickup.brief(),
      hazard: this.hazards.brief(),
      driverSuggestion: this.s.driverSuggestion ? { ...this.s.driverSuggestion } : null,
      place: this.s.place ? { ...this.s.place } : null,
      network: { ...this.net.status, bytesThisMonth: { ...this.net.status.bytesThisMonth } },
      drive: this.drive.state(),
      chargePeak: this.s.chargePeak ? { ...this.s.chargePeak } : null,
      // DEMO: a neighbourhood for the top bar, never an address.
      area: config.demo ? demoArea(this.s.gps?.fix ? this.s.gps : null, this.s.speedMph, this.s.gps?.headingDeg ?? null) : null,
    };
  }

  health(): Health {
    const mqtt = !this.mqtt ? 'disabled' : this.mqtt.status === 'connected' ? 'connected' : `${this.mqtt.status}${this.mqtt.lastError ? ` (${this.mqtt.lastError})` : ''}`;
    const gps = this.sim ? 'sim' : this.gpsd?.status ?? 'no gpsd';
    return { ok: true, version: config.version, mqtt, gps, ha: this.ha.status(), uptimeS: Math.round((Date.now() - this.startedAt) / 1000) };
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
    this.publishGoal();
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
    for (const id of RELAY_IDS) { this.s.relays[id].name = next.relays[id]; this.s.relays[id].watts = next.relayWatts[id]; }
    if (next.truckId !== prev.truckId && this.mqtt) {
      this.mqtt.publish(statusTopic(prev.truckId), 'offline', { retain: true });
      console.warn('[mqtt] truck id changed; restart the brain so the last-will topic follows it');
    }
    this.mqtt?.setSubscriptions(this.subscriptions(next));
    if (next.truckId !== prev.truckId || next.homeAssistant.bridge !== prev.homeAssistant.bridge) this.publishDiscovery(next, prev.truckId);
    if (!this.settings.driver(this.driverId)) this.driverId = this.activeDriver().id;
    if (JSON.stringify([next.homeWifi, next.drivers.map((d) => [d.hotspot, d.btTetherMac])]) !== JSON.stringify([prev.homeWifi, prev.drivers.map((d) => [d.hotspot, d.btTetherMac])])) void this.net.tick();
    const ha = (s: Settings) => JSON.stringify([s.homeAssistant.url, s.homeAssistant.token, s.placesFeed, s.keys.placesFeed, s.gas]);
    const goalKey = (s: Settings) => JSON.stringify([s.payoffGoal, s.compareVehicle, s.gas.source, s.gas.manualPrice]);
    if (goalKey(next) !== goalKey(prev)) this.goalChanged();
    if (ha(next) !== ha(prev)) {
      if (next.homeAssistant.url !== prev.homeAssistant.url || next.homeAssistant.token !== prev.homeAssistant.token) this.ha.lastError = null;
      if (this.refreshSoon) clearTimeout(this.refreshSoon);
      this.refreshSoon = setTimeout(() => { this.refreshSoon = null; void this.slowRefresh(); }, 500);
    }
    this.changed();
  }
}
