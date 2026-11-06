// SIM=1: a truck on a desk. Drives a loop around Phoenix and speaks the same
// truck-box topics and GPS fixes as the real hardware, so everything downstream
// runs the real code path.
//
// Two modes. `auto` is the self-driving loop (park, reverse out, drive a leg,
// arrive, repeat). `manual` is the test panel (/api/sim, ui/src/sim/): gear,
// ignition, target speed, which leg, sensor overrides, and a tow-away for the
// theft alert. Either way the brain only ever sees truck-box topics and fixes.
import { bearingDeg, haversineMi, type LatLon } from './geo.ts';
import type { GpsFix } from './gps.ts';

type Leg = LatLon[];

/** Home (Arcadia) -> Tempe -> downtown -> home. Each leg ends at a stop. */
export const SIM_ROUTE: Leg[] = [
  [{ lat: 33.4990, lon: -111.9800 }, { lat: 33.4945, lon: -111.9800 }, { lat: 33.4945, lon: -111.9262 }, { lat: 33.4400, lon: -111.9262 }, { lat: 33.4255, lon: -111.9262 }, { lat: 33.4255, lon: -111.9400 }],
  [{ lat: 33.4255, lon: -111.9400 }, { lat: 33.4255, lon: -111.9790 }, { lat: 33.4370, lon: -112.0200 }, { lat: 33.4480, lon: -112.0400 }, { lat: 33.4484, lon: -112.0740 }],
  [{ lat: 33.4484, lon: -112.0740 }, { lat: 33.4800, lon: -112.0740 }, { lat: 33.4990, lon: -112.0740 }, { lat: 33.4990, lon: -112.0200 }, { lat: 33.4990, lon: -111.9800 }],
];
export const SIM_HOME = SIM_ROUTE[0][0];
export const SIM_LEG_NAMES = ['Home → Tempe', 'Tempe → Downtown (freeway)', 'Downtown → Home'];

/** Ambient light for the brightness loop: a day curve from the local clock, with passing shade. */
export function simLux(now: Date, t: number): number {
  const h = now.getHours() + now.getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
  const shade = 0.55 + 0.45 * Math.abs(Math.sin(t / 37));
  return Math.round(2 + 30_000 * sun ** 1.5 * shade);
}

type Phase = 'parked' | 'reverse' | 'drive' | 'arrived';
const PHASE_S: Record<Exclude<Phase, 'drive'>, number> = { parked: 200, reverse: 5, arrived: 12 };

export type SimGear = 'park' | 'reverse' | 'drive';
export type Wheel = 'fl' | 'fr' | 'rl' | 'rr';
/** The test panel's controls. */
export type SimControl = {
  mode: 'auto' | 'manual';
  gear: SimGear;
  ignition: boolean;
  targetMph: number;          // in drive
  loop: boolean;              // at the end of a leg, carry on with the next one (else stop there)
  cabinF: number | null;      // overrides; null = the normal curve
  auxV: number | null;
  lowTire: Wheel | null;      // that tire reads 22 psi
  switches: boolean[];        // the Five Switch, 1–5
};
export type SimStatus = SimControl & {
  leg: number; legs: string[]; speedMph: number; pos: LatLon; headingDeg: number;
  arrived: boolean; towing: boolean; ignitionOn: boolean; reverseOn: boolean; speedup: number;
};

export class SimError extends Error { status = 400; }

const GEARS: SimGear[] = ['park', 'reverse', 'drive'];
const WHEELS: Wheel[] = ['fl', 'fr', 'rl', 'rr'];

/** Validate a panel patch against the current controls. Pure (tested). */
export function mergeControl(cur: SimControl, patch: Partial<SimControl>): SimControl {
  const c: SimControl = { ...cur, switches: [...cur.switches] };
  const num = (v: unknown, lo: number, hi: number, what: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new SimError(`${what}: ${lo} to ${hi}`);
    return n;
  };
  if (patch.mode !== undefined) { if (patch.mode !== 'auto' && patch.mode !== 'manual') throw new SimError('mode: auto or manual'); c.mode = patch.mode; }
  if (patch.gear !== undefined) { if (!GEARS.includes(patch.gear)) throw new SimError('gear: park, reverse or drive'); c.gear = patch.gear; }
  if (patch.ignition !== undefined) c.ignition = !!patch.ignition;
  if (patch.targetMph !== undefined) c.targetMph = num(patch.targetMph, 0, 90, 'targetMph');
  if (patch.loop !== undefined) c.loop = !!patch.loop;
  if (patch.cabinF !== undefined) c.cabinF = patch.cabinF === null ? null : num(patch.cabinF, -20, 180, 'cabinF');
  if (patch.auxV !== undefined) c.auxV = patch.auxV === null ? null : num(patch.auxV, 9, 15.5, 'auxV');
  if (patch.lowTire !== undefined) { if (patch.lowTire !== null && !WHEELS.includes(patch.lowTire)) throw new SimError('lowTire: fl, fr, rl, rr or null'); c.lowTire = patch.lowTire; }
  if (patch.switches !== undefined) {
    if (!Array.isArray(patch.switches) || patch.switches.length !== 5) throw new SimError('switches: five booleans');
    c.switches = patch.switches.map(Boolean);
  }
  // Touching anything but the mode takes the wheel from the loop.
  if (patch.mode !== 'auto' && Object.keys(patch).some((k) => k !== 'mode')) c.mode = 'manual';
  if (c.gear !== 'park') c.ignition = true; // in gear means on
  return c;
}

export class SimTruck {
  private t = 0;
  private phase: Phase = 'parked';
  private phaseT = 0;
  private leg = 0;
  private seg = 0;
  private pos: LatLon = { ...SIM_HOME };
  private speed = 0;
  private heading = 180;
  private relays: Record<string, boolean> = {};
  private timer: NodeJS.Timeout | null = null;
  private ctl: SimControl = { mode: 'auto', gear: 'park', ignition: false, targetMph: 35, loop: true, cabinF: null, auxV: null, lowTire: null, switches: [true, false, false, true, false] };
  private ign = false;
  private rev = false;
  private towLeft = 0;          // simulated seconds of being towed still to go
  private arrived = false;

  private emit: (sub: string, payload: string) => void;
  private onFix: (f: GpsFix) => void;
  private speedup: number;

  constructor(emit: (sub: string, payload: string) => void, onFix: (f: GpsFix) => void, speedup = 1) {
    this.emit = emit; this.onFix = onFix; this.speedup = speedup;
  }

  start() {
    this.emit('status', 'online');
    for (let i = 1; i <= 6; i++) { this.relays[`relay_${i}`] = false; this.emit(`switch/relay_${i}/state`, 'OFF'); }
    this.ctl.switches.forEach((on, i) => this.emit(`binary_sensor/five_switch_${i + 1}/state`, on ? 'ON' : 'OFF'));
    this.emit('binary_sensor/ignition/state', 'OFF');
    this.emit('binary_sensor/reverse/state', 'OFF');
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  /** Relay command: the "truck box" echoes the new state a moment later, like the real one. */
  command(id: string, on: boolean) {
    if (!(id in this.relays)) return;
    setTimeout(() => { this.relays[id] = on; this.emit(`switch/${id}/state`, on ? 'ON' : 'OFF'); }, 150);
  }

  status(): SimStatus {
    return {
      ...this.ctl, switches: [...this.ctl.switches],
      leg: this.leg, legs: SIM_LEG_NAMES, speedMph: Math.round(this.speed * 10) / 10, pos: { ...this.pos }, headingDeg: Math.round(this.heading),
      arrived: this.arrived, towing: this.towLeft > 0, ignitionOn: this.ign, reverseOn: this.rev, speedup: this.speedup,
    };
  }

  /** Change controls from the test panel. */
  control(patch: Partial<SimControl>): SimStatus {
    const prev = this.ctl;
    let c = mergeControl(prev, patch);
    // Taking over from the loop keeps whatever it was doing, unless told otherwise.
    if (prev.mode === 'auto' && c.mode === 'manual') {
      const keep: Partial<SimControl> = {};
      if (patch.gear === undefined) keep.gear = this.phase === 'drive' ? 'drive' : this.phase === 'reverse' ? 'reverse' : 'park';
      if (patch.ignition === undefined) keep.ignition = this.ign;
      c = mergeControl(c, keep);
    }
    this.ctl = c;
    if (c.switches.some((on, i) => on !== prev.switches[i])) c.switches.forEach((on, i) => this.emit(`binary_sensor/five_switch_${i + 1}/state`, on ? 'ON' : 'OFF'));
    if (prev.mode === 'manual' && c.mode === 'auto') { this.towLeft = 0; this.arrived = false; this.setPhase(this.speed > 1 ? 'drive' : 'parked'); }
    if (c.mode === 'manual') {
      if (c.gear !== 'park' || c.ignition) this.towLeft = 0;
      if (patch.gear !== undefined || patch.loop !== undefined) this.arrived = false;
      this.applyManualPins();
    }
    return this.status();
  }

  /** Put the truck at the start of a leg (0 = home). Only while stopped. */
  jump(leg: number): SimStatus {
    if (!Number.isInteger(leg) || leg < 0 || leg >= SIM_ROUTE.length) throw new SimError(`leg: 0 to ${SIM_ROUTE.length - 1}`);
    if (this.speed > 1) throw new SimError('Stop first: park, or wait for 0 mph');
    this.leg = leg; this.seg = 0; this.pos = { ...SIM_ROUTE[leg][0] }; this.arrived = false;
    this.heading = bearingDeg(SIM_ROUTE[leg][0], SIM_ROUTE[leg][1]);
    if (this.ctl.mode === 'auto') this.setPhase('parked');
    return this.status();
  }

  /** Theft test: ignition off, in park, and the truck rolls away at tow speed for `seconds` (simulated). */
  tow(seconds = 90): SimStatus {
    this.control({ mode: 'manual', gear: 'park', ignition: false });
    this.towLeft = Math.max(10, Math.min(600, Number(seconds) || 90));
    return this.status();
  }

  private setIgnition(on: boolean) { if (on !== this.ign) { this.ign = on; this.emit('binary_sensor/ignition/state', on ? 'ON' : 'OFF'); } }
  private setReverse(on: boolean) { if (on !== this.rev) { this.rev = on; this.emit('binary_sensor/reverse/state', on ? 'ON' : 'OFF'); } }
  private applyManualPins() { this.setIgnition(this.ctl.ignition); this.setReverse(this.ctl.gear === 'reverse'); }

  private setPhase(p: Phase) {
    this.phase = p; this.phaseT = 0;
    if (p === 'parked') { this.setIgnition(false); this.setReverse(false); }
    if (p === 'reverse') { this.setIgnition(true); this.setReverse(true); }
    if (p === 'drive') { this.setIgnition(true); this.setReverse(false); }
  }

  /** Miles left on the current leg. */
  private remainingLeg(): number {
    const route = SIM_ROUTE[this.leg];
    const target = route[Math.min(this.seg + 1, route.length - 1)];
    return haversineMi(this.pos, target) + route.slice(this.seg + 1).reduce((a, p, i, arr) => (i + 1 < arr.length ? a + haversineMi(p, arr[i + 1]) : a), 0);
  }

  /** Move along the route at the current speed. True when the leg's end was reached. */
  private advance(dt: number): boolean {
    const route = SIM_ROUTE[this.leg];
    let move = (this.speed / 3600) * dt; // miles this tick
    while (move > 0) {
      const nxt = route[this.seg + 1];
      const d = haversineMi(this.pos, nxt);
      this.heading = bearingDeg(this.pos, nxt);
      if (d > move) {
        const f = move / d;
        this.pos = { lat: this.pos.lat + (nxt.lat - this.pos.lat) * f, lon: this.pos.lon + (nxt.lon - this.pos.lon) * f };
        move = 0;
      } else {
        this.pos = { ...nxt }; move -= d; this.seg++;
        if (this.seg >= route.length - 1) return true;
      }
    }
    return false;
  }

  private approach(want: number, dt: number) {
    this.speed += Math.max(-6, Math.min(4, want - this.speed)) * Math.min(1, dt);
    this.speed = Math.max(0, this.speed);
  }

  private nextLeg() { this.leg = (this.leg + 1) % SIM_ROUTE.length; this.seg = 0; }

  private tick() {
    const dt = this.speedup;
    this.t += dt; this.phaseT += dt;
    if (this.ctl.mode === 'manual') this.manualTick(dt); else this.autoTick(dt);

    const driving = this.ign;
    this.onFix({ lat: this.pos.lat, lon: this.pos.lon, speedMph: Math.round(this.speed * 10) / 10, headingDeg: Math.round(this.heading), fix: true, at: new Date() });

    const s = this.t;
    this.emit('sensor/cabin_temp/state', (this.ctl.cabinF ?? 74 + 3 * Math.sin(s / 300)).toFixed(1));
    this.emit('sensor/cabin_humidity/state', (22 + 2 * Math.sin(s / 500)).toFixed(0));
    this.emit('sensor/ambient_lux/state', String(simLux(new Date(), s)));
    this.emit('sensor/aux_battery_v/state', (this.ctl.auxV ?? (driving ? 13.8 + 0.1 * Math.sin(s / 9) : 12.6 + 0.05 * Math.sin(s / 50))).toFixed(2));
    this.emit('sensor/pitch/state', (1.5 * Math.sin(s / 23) + (this.speed > 0 ? 0.4 * Math.sin(s * 1.3) : 0)).toFixed(1));
    this.emit('sensor/roll/state', (-0.8 + 1.2 * Math.sin(s / 31) + (this.speed > 0 ? 0.4 * Math.cos(s * 1.1) : 0)).toFixed(1));
    // Tires every 10 s, or straight away when the panel changed the low one.
    if (s % 10 < dt || this.ctl.lowTire !== this.lastLowTire) {
      this.lastLowTire = this.ctl.lowTire;
      const warm = driving ? 6 : 0;
      ([['fl', 38], ['fr', 38], ['rl', 40], ['rr', 33]] as const).forEach(([w, psi]) => {
        const p = this.ctl.lowTire === w ? 22 : psi + warm / 6 + 0.3 * Math.sin(s / 60);
        this.emit(`sensor/tpms_${w}_psi/state`, p.toFixed(1));
        this.emit(`sensor/tpms_${w}_temp/state`, (82 + warm + Math.sin(s / 90)).toFixed(0));
      });
    }
  }
  private lastLowTire: Wheel | null = null;

  private manualTick(dt: number) {
    this.applyManualPins();
    if (this.towLeft > 0) {
      this.towLeft -= dt;
      this.approach(15, dt);
      if (this.advance(dt)) this.nextLeg();
      if (this.towLeft <= 0) { this.towLeft = 0; this.speed = 0; }
      return;
    }
    if (this.ctl.gear === 'park') { this.speed = 0; return; }
    if (this.ctl.gear === 'reverse') { this.speed = 2; return; }
    if (this.arrived) { this.speed = 0; return; }
    let want = this.ctl.targetMph;
    const left = this.remainingLeg();
    if (!this.ctl.loop && left < 0.25) want = Math.max(4, want * (left / 0.25));
    this.approach(want, dt);
    if (this.advance(dt)) {
      if (this.ctl.loop) this.nextLeg();
      else { this.arrived = true; this.speed = 0; }
    }
  }

  private autoTick(dt: number) {
    if (this.phase === 'parked') { this.speed = 0; if (this.phaseT >= PHASE_S.parked) this.setPhase('reverse'); }
    else if (this.phase === 'reverse') { this.speed = 2; if (this.phaseT >= PHASE_S.reverse) this.setPhase('drive'); }
    else if (this.phase === 'arrived') {
      this.speed = 0;
      if (this.phaseT >= PHASE_S.arrived) { this.nextLeg(); this.setPhase('parked'); }
    } else {
      const remainingLeg = this.remainingLeg();
      // Leg 2 (Tempe to downtown) runs on the freeway, so the city/highway split has both.
      let want = this.leg === 1 ? 60 + 5 * Math.sin(this.t / 30) : 34 + 10 * Math.sin(this.t / 40) + 4 * Math.sin(this.t / 7);
      if (remainingLeg < 0.25) want = Math.max(6, want * (remainingLeg / 0.25));
      if (this.t % 180 < 20 && remainingLeg > 0.5) want = 0; // a red light now and then
      this.approach(want, dt);
      if (this.advance(dt)) { this.setPhase('arrived'); this.speed = 0; }
    }
  }
}
