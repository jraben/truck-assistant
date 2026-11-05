// Track A in the brain: one service the Brain feeds (speed, miles, truck-box
// topics) and reads (State.drive). Owns the range model, since-charge, weather,
// speed limits, lockout, heat and brightness. Everything here degrades to null
// with a reason; nothing in it can stop the rest of the brain.
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import type { LatLon } from '../geo.ts';
import { resolveName } from '../places/naming.ts';
import type { SettingsStore } from '../settings.ts';
import { isDaytime } from '../sun.ts';
import type { ChargeSession, Trip } from '../types.ts';
import { pickBrightnessBackend, smoothLux, targetPct, WRITE_MIN_MS, WRITE_MIN_STEP, type Backend } from './brightness.ts';
import { cpuReader, heatLevel, heatMessage, parkedInSun, requestShutdown, SHUTDOWN_HOLD_MS, type CpuReader } from './heat.ts';
import { bigTargets, lockStep, type LockState } from './lockout.ts';
import { SpeedLimits } from './maxspeed.ts';
import { rangeFor, RangeModel, type RangeSnapshot } from './range.ts';
import { lastEndedCharge, sinceCharge } from './sinceCharge.ts';
import type { DriveState, RangeMode, RangeOverride, SinceCharge, SpeedLimit } from './types.ts';
import { briefOf, needsRefresh, WeatherService } from './weather.ts';

/** What the Brain tells the drive service every tick. */
export type DriveInputs = {
  speedMph: number | null;
  gps: { lat: number; lon: number; headingDeg: number | null; fix: boolean } | null;
  soc: number | null; socSource: 'manual' | 'estimate' | 'can' | null;
  cabinTempF: number | null; ignition: boolean | null;
  tilt: { pitch: number; roll: number } | null;
  tripId: number | null;
  online: boolean;
  placeName: string | null;              // the stop the truck is at, if named
};

export type DriveDeps = {
  db: Db; settings: SettingsStore; version: string; sim: boolean;
  charges: () => ChargeSession[];
  tripsSince: (iso: string) => Trip[];
  tiers: () => Parameters<typeof resolveName>[1];
  changed: () => void;
};

const MPH_PARKED = 1;
const LIMIT_FORGET_MS = 30_000;

export class DriveService {
  readonly range: RangeModel;
  readonly weather: WeatherService;
  readonly limits: SpeedLimits;
  private d: DriveDeps;
  private inputs: () => DriveInputs;
  private timer: NodeJS.Timeout | null = null;
  private n = 0;
  private lock: LockState = { locked: false, slowSince: null };
  private since: SinceCharge | null = null;
  private sinceWhy: string | null = 'No charge logged yet';
  private limit: SpeedLimit | null = null;
  private limitSeenAt = 0;
  private cpu: { c: number | null; source: DriveState['heat']['source'] } = { c: null, source: null };
  private readCpu: CpuReader;
  private hotSince: number | null = null;
  private shutdownAsked = false;
  private lux: number | null = null;
  private luxAt = 0;
  private bright: { backend: Backend | null; pct: number | null; writtenAt: number; error: string | null } = { backend: null, pct: null, writtenAt: 0, error: null };
  private snapAt = 0;
  private last: string = '';

  constructor(d: DriveDeps, inputs: () => DriveInputs) {
    this.d = d;
    this.inputs = inputs;
    const st = d.settings.get();
    this.range = new RangeModel({ city: st.drive.efficiency.cityMiPerKwh, highway: st.drive.efficiency.highwayMiPerKwh }, kvGet<RangeSnapshot>(d.db, 'driveRange'));
    this.weather = new WeatherService(d.db, d.version);
    this.limits = new SpeedLimits(d.db, d.version);
    this.readCpu = cpuReader(d.sim);
    d.settings.onChange((n) => this.range.reseed({ city: n.drive.efficiency.cityMiPerKwh, highway: n.drive.efficiency.highwayMiPerKwh }));
  }

  start() {
    void pickBrightnessBackend(this.d.sim).then((b) => { this.bright.backend = b; console.log(`[brightness] ${b.kind}`); }).catch(() => {});
    this.timer = setInterval(() => this.tick(), 1000);
    this.refreshSince();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.save(true); }

  // ---- inputs from the Brain ---------------------------------------------------------

  /** `sub` is the topic after "<truckId>/truckbox/". Only what Track A adds. */
  onTruckbox(sub: string, payload: string) {
    if (sub !== 'sensor/ambient_lux/state') return;
    const v = Number(payload.trim());
    if (!Number.isFinite(v) || v < 0) return;
    this.lux = smoothLux(this.lux, v);
    this.luxAt = Date.now();
  }

  /** Miles just driven: split by the road's mode (the classifier, not the override) onto the trip. */
  onMiles(mi: number, tripId: number | null) {
    const st = this.d.settings.get();
    const i = this.inputs();
    const mode = this.range.autoMode(Date.now(), st.drive.highwayMph);
    if (this.range.addMiles(mode, mi, { value: i.soc, real: i.socSource === 'can' }, st.packKwh, st.drive.efficiency.alpha)) this.save(true);
    if (tripId !== null) {
      try { this.d.db.prepare(`UPDATE trips SET ${mode}_miles = COALESCE(${mode}_miles, 0) + ? WHERE id = ?`).run(mi, tripId); } catch (e) { console.error('[drive] split', e); }
    }
  }

  /** The mi/kWh the SoC estimate should decay by right now. */
  efficiencyNow(): number {
    return this.range.eff(this.range.mode(Date.now(), this.d.settings.get().drive.highwayMph));
  }

  /** A trip closed: price its split in kWh and make kwhEst their sum (when there is a split). */
  onTripEnd(id: number) {
    try {
      const r = this.d.db.prepare('SELECT city_miles, highway_miles FROM trips WHERE id = ?').get(id) as { city_miles: number | null; highway_miles: number | null } | undefined;
      if (!r || (r.city_miles === null && r.highway_miles === null)) return;
      const ck = r.city_miles ? r.city_miles / this.range.eff('city') : 0, hk = r.highway_miles ? r.highway_miles / this.range.eff('highway') : 0;
      this.d.db.prepare('UPDATE trips SET city_kwh = ?, highway_kwh = ?, kwh_est = ? WHERE id = ?').run(r.city_miles === null ? null : Math.round(ck * 100) / 100, r.highway_miles === null ? null : Math.round(hk * 100) / 100, Math.round((ck + hk) * 100) / 100, id);
    } catch (e) { console.error('[drive] trip end', e); }
    this.refreshSince();
  }

  setOverride(m: RangeOverride) { this.range.override = m; this.save(true); this.d.changed(); }

  /** The charge list changed (a session ended): since-charge resets. */
  refreshSince() {
    try {
      const st = this.d.settings.get();
      const c = lastEndedCharge(this.d.charges());
      if (!c) { this.since = null; this.sinceWhy = 'No charge logged yet: it starts counting when a charge session ends'; return; }
      const i = this.inputs();
      this.since = sinceCharge(c, this.d.tripsSince(c.endedAt!).filter((t) => t.source === 'truck'), { soc: i.soc, packKwh: st.packKwh, eff: { city: this.range.eff('city'), highway: this.range.eff('highway') } });
      this.sinceWhy = null;
    } catch (e) { console.error('[drive] since charge', e); }
  }

  // ---- the 1 s tick ---------------------------------------------------------------------

  private tick() {
    const now = Date.now();
    const st = this.d.settings.get();
    const i = this.inputs();
    this.n++;
    this.range.addSample(now, i.speedMph);
    this.lock = lockStep(this.lock, i.speedMph, now, st.drive.lockoutMph);
    const pos: LatLon | null = i.gps?.fix ? { lat: i.gps.lat, lon: i.gps.lon } : null;

    if (this.n % 10 === 0) this.refreshSince();
    if (this.n % 30 === 1 && pos && needsRefresh(this.weather.lastFetch(), pos, now, i.online)) {
      void this.weather.refresh(pos, (p) => i.placeName ?? resolveName(p, this.d.tiers())?.name ?? null).then((ok) => { if (ok) this.d.changed(); });
    }
    if (st.drive.speedLimits && pos) this.speedLimit(pos, i, now);
    else if (!st.drive.speedLimits) this.limit = null;
    if (this.n % 5 === 0) void this.heat(i, now);
    if (this.n % 2 === 0) void this.brightness(pos, now);
    if (now - this.snapAt > 60_000) this.save();

    const key = JSON.stringify(this.state());
    if (key !== this.last) { this.last = key; this.d.changed(); }
  }

  private speedLimit(pos: LatLon, i: DriveInputs, now: number) {
    const hit = this.limits.lookupCached(pos, i.gps?.headingDeg ?? null);
    if (hit) { this.limit = { ...hit, at: new Date(now).toISOString() }; this.limitSeenAt = now; return; }
    if (now - this.limitSeenAt > LIMIT_FORGET_MS) this.limit = null;
    const moving = (i.speedMph ?? 0) > MPH_PARKED;
    if (moving && i.online) void this.limits.query(pos, now);
  }

  private async heat(i: DriveInputs, now: number) {
    try { this.cpu = await this.readCpu(); } catch { this.cpu = { c: null, source: null }; }
    const st = this.d.settings.get();
    const level = heatLevel(this.cpu.c, st.drive.heat);
    if (level === 'shutdown') {
      this.hotSince ??= now;
      if (!this.shutdownAsked && now - this.hotSince >= SHUTDOWN_HOLD_MS) { this.shutdownAsked = true; requestShutdown(this.d.sim); }
    } else { this.hotSince = null; this.shutdownAsked = false; }
    void i;
  }

  private async brightness(pos: LatLon | null, now: number, force = false) {
    const b = this.bright.backend;
    if (!b) return;
    const st = this.d.settings.get().drive.brightness;
    const lux = now - this.luxAt < 60_000 ? this.lux : null;
    const pct = targetPct({ ...st, lux, night: !isDaytime(new Date(now), pos) });
    if (pct === this.bright.pct) return;
    if (!force && this.bright.pct !== null && (now - this.bright.writtenAt < WRITE_MIN_MS || Math.abs(pct - this.bright.pct) < WRITE_MIN_STEP)) return;
    try { await b.set(pct); this.bright.pct = pct; this.bright.error = null; }
    catch (e) { this.bright.error = (e as Error).message.split('\n')[0].slice(0, 160); }
    this.bright.writtenAt = now;
  }

  /** POST /api/brightness: {auto?, pct?}. pct sets the manual level (and turns auto off unless auto is given). */
  setBrightness(body: { auto?: unknown; pct?: unknown }) {
    const cur = this.d.settings.get().drive.brightness;
    const next = { ...cur };
    if (typeof body.pct === 'number') { next.manualPct = Math.round(body.pct); if (typeof body.auto !== 'boolean') next.auto = false; }
    if (typeof body.auto === 'boolean') next.auto = body.auto;
    this.d.settings.update({ drive: { brightness: next } });
    const g = this.inputs().gps;
    void this.brightness(g?.fix ? g : null, Date.now(), true);
  }

  private save(force = false) {
    if (!force && Date.now() - this.snapAt < 60_000) return;
    this.snapAt = Date.now();
    try { kvSet(this.d.db, 'driveRange', this.range.snapshot()); } catch { /* best effort */ }
  }

  // ---- output ---------------------------------------------------------------------------

  state(): DriveState {
    const now = Date.now();
    const st = this.d.settings.get();
    const i = this.inputs();
    const mode: RangeMode = this.range.mode(now, st.drive.highwayMph);
    const avg = this.range.avg(now);
    const city = rangeFor(i.soc, st.packKwh, this.range.eff('city')), highway = rangeFor(i.soc, st.packKwh, this.range.eff('highway'));
    const parked = i.speedMph === null || i.speedMph < MPH_PARKED || i.ignition === false;
    const pos = i.gps?.fix ? i.gps : null;
    const sun = parkedInSun({ parked, daytime: isDaytime(new Date(now), pos), cabinF: i.cabinTempF, limitF: st.drive.heat.parkedSunF });
    const level = heatLevel(this.cpu.c, st.drive.heat);
    const r = this.weather.report;
    const t = i.tilt;
    const worst = t ? Math.max(Math.abs(t.pitch), Math.abs(t.roll)) : null;
    return {
      mode, override: this.range.override,
      avgMph2min: avg === null ? null : Math.round(avg * 10) / 10,
      efficiency: { city: this.range.eff('city'), highway: this.range.eff('highway'), learnedMiles: { city: this.range.stats.city.learnedMiles, highway: this.range.stats.highway.learnedMiles } },
      range: { city, highway, current: mode === 'city' ? city : highway },
      sinceCharge: this.since, sinceChargeWhy: this.since ? null : this.sinceWhy,
      speedLimit: this.limit,
      speedLimitWhy: this.limit ? null : !st.drive.speedLimits ? 'Speed limits are off in settings' : !pos ? 'No GPS fix' : !i.online ? 'Offline: limits come from OpenStreetMap' : this.limits.error ?? 'No limit mapped for this road yet',
      weather: r ? briefOf(r, now) : null,
      weatherWhy: r ? null : !pos ? 'Waiting for a GPS fix' : !i.online ? 'Offline: no weather yet' : this.weather.error ?? 'Fetching weather…',
      lockout: { locked: this.lock.locked, bigTargets: bigTargets(i.speedMph) },
      heat: { cpuC: this.cpu.c, source: this.cpu.source, level, parkedInSun: sun, message: heatMessage(level, this.cpu.c, sun, i.cabinTempF) },
      brightness: { pct: this.bright.pct, auto: st.drive.brightness.auto, lux: now - this.luxAt < 60_000 ? this.lux : null, night: !isDaytime(new Date(now), pos), backend: this.bright.backend?.kind ?? 'none', error: this.bright.error },
      tilt: { warnDeg: st.drive.tilt.warnDeg, dangerDeg: st.drive.tilt.dangerDeg, level: worst === null ? null : worst >= st.drive.tilt.dangerDeg ? 'danger' : worst >= st.drive.tilt.warnDeg ? 'warn' : 'ok' },
    };
  }
}
