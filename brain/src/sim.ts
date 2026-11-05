// SIM=1: a truck on a desk. Drives a loop around Phoenix and speaks the same
// truck-box topics and GPS fixes as the real hardware, so everything downstream
// runs the real code path.
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

/** Ambient light for the brightness loop: a day curve from the local clock, with passing shade. */
export function simLux(now: Date, t: number): number {
  const h = now.getHours() + now.getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
  const shade = 0.55 + 0.45 * Math.abs(Math.sin(t / 37));
  return Math.round(2 + 30_000 * sun ** 1.5 * shade);
}

type Phase = 'parked' | 'reverse' | 'drive' | 'arrived';
const PHASE_S: Record<Exclude<Phase, 'drive'>, number> = { parked: 200, reverse: 5, arrived: 12 };

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

  private emit: (sub: string, payload: string) => void;
  private onFix: (f: GpsFix) => void;
  private speedup: number;

  constructor(emit: (sub: string, payload: string) => void, onFix: (f: GpsFix) => void, speedup = 1) {
    this.emit = emit; this.onFix = onFix; this.speedup = speedup;
  }

  start() {
    this.emit('status', 'online');
    for (let i = 1; i <= 6; i++) { this.relays[`relay_${i}`] = false; this.emit(`switch/relay_${i}/state`, 'OFF'); }
    [true, false, false, true, false].forEach((on, i) => this.emit(`binary_sensor/five_switch_${i + 1}/state`, on ? 'ON' : 'OFF'));
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

  private setPhase(p: Phase) {
    this.phase = p; this.phaseT = 0;
    if (p === 'parked') this.emit('binary_sensor/ignition/state', 'OFF');
    if (p === 'reverse') { this.emit('binary_sensor/ignition/state', 'ON'); this.emit('binary_sensor/reverse/state', 'ON'); }
    if (p === 'drive') this.emit('binary_sensor/reverse/state', 'OFF');
  }

  private tick() {
    const dt = this.speedup;
    this.t += dt; this.phaseT += dt;
    const route = SIM_ROUTE[this.leg];

    if (this.phase === 'parked') { this.speed = 0; if (this.phaseT >= PHASE_S.parked) this.setPhase('reverse'); }
    else if (this.phase === 'reverse') { this.speed = 2; if (this.phaseT >= PHASE_S.reverse) this.setPhase('drive'); }
    else if (this.phase === 'arrived') {
      this.speed = 0;
      if (this.phaseT >= PHASE_S.arrived) { this.leg = (this.leg + 1) % SIM_ROUTE.length; this.seg = 0; this.setPhase('parked'); }
    } else {
      const target = route[this.seg + 1];
      const remainingLeg = haversineMi(this.pos, target) + route.slice(this.seg + 1).reduce((a, p, i, arr) => (i + 1 < arr.length ? a + haversineMi(p, arr[i + 1]) : a), 0);
      // Leg 2 (Tempe to downtown) runs on the freeway, so the city/highway split has both.
      let want = this.leg === 1 ? 60 + 5 * Math.sin(this.t / 30) : 34 + 10 * Math.sin(this.t / 40) + 4 * Math.sin(this.t / 7);
      if (remainingLeg < 0.25) want = Math.max(6, want * (remainingLeg / 0.25));
      if (this.t % 180 < 20 && remainingLeg > 0.5) want = 0; // a red light now and then
      this.speed += Math.max(-6, Math.min(4, want - this.speed)) * Math.min(1, dt);
      this.speed = Math.max(0, this.speed);
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
          if (this.seg >= route.length - 1) { this.setPhase('arrived'); this.speed = 0; break; }
        }
      }
    }

    const driving = this.phase === 'drive' || this.phase === 'reverse';
    this.onFix({ lat: this.pos.lat, lon: this.pos.lon, speedMph: Math.round(this.speed * 10) / 10, headingDeg: Math.round(this.heading), fix: true, at: new Date() });

    const s = this.t;
    this.emit('sensor/cabin_temp/state', (74 + 3 * Math.sin(s / 300)).toFixed(1));
    this.emit('sensor/cabin_humidity/state', (22 + 2 * Math.sin(s / 500)).toFixed(0));
    this.emit('sensor/ambient_lux/state', String(simLux(new Date(), s)));
    this.emit('sensor/aux_battery_v/state', (driving ? 13.8 + 0.1 * Math.sin(s / 9) : 12.6 + 0.05 * Math.sin(s / 50)).toFixed(2));
    this.emit('sensor/pitch/state', (1.5 * Math.sin(s / 23) + (driving ? 0.4 * Math.sin(s * 1.3) : 0)).toFixed(1));
    this.emit('sensor/roll/state', (-0.8 + 1.2 * Math.sin(s / 31) + (driving ? 0.4 * Math.cos(s * 1.1) : 0)).toFixed(1));
    if (s % 10 < dt) {
      const warm = driving ? 6 : 0;
      ([['fl', 38], ['fr', 38], ['rl', 40], ['rr', 33]] as const).forEach(([w, psi]) => {
        this.emit(`sensor/tpms_${w}_psi/state`, (psi + warm / 6 + 0.3 * Math.sin(s / 60)).toFixed(1));
        this.emit(`sensor/tpms_${w}_temp/state`, (82 + warm + Math.sin(s / 90)).toFixed(0));
      });
    }
  }
}
