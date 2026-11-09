// A trip's energy, for looking back at after the drive (not a live gauge):
// power used and regenerated along the way, against distance, height and
// speed, so the effect of hills, speed and load can be seen on the map.
//
// Where it comes from:
//  - MEASURED: the truck box publishes the pack's power
//    (`<truckId>/truckbox/sensor/pack_power_kw/state`, kW, + drawing,
//    − regenerating) once a CAN bridge can read it. Each 2-second sample keeps
//    the latest reading.
//  - MODEL: until then (and for any stretch without readings) it's worked out
//    from physics: rolling resistance, air drag, climbing and speeding up, at
//    the trip's weight (truck + driver + load), with regen giving back part of
//    what braking and descents would waste. The coefficients are settings and
//    start as estimates, so a modelled trip shows WHERE the energy went
//    (which hill, which stretch of 75 mph) better than HOW MUCH. The screen
//    says which one it is.
//
// Height is the GPS's (gpsd `altMSL`/`alt`), smoothed: single readings jump by
// metres, which on a 2-second step would read as cliffs.
import { haversineMi } from '../geo.ts';

/** techW: the dash electronics (Pi, screen, cameras, tablet); accW: the relay loads that were on. Both rated watts (estimates); null = not recorded. */
export type EnergySample = { t: string; lat: number; lon: number; altM: number | null; speedMph: number | null; powerKw: number | null; techW?: number | null; accW?: number | null };

/** The physics model's numbers. Defaults are estimates for a small EV pickup until the Slate's are published or fitted. */
export type EnergyModel = {
  curbLb: number;      // the truck, empty
  driverLb: number;    // the driver (passengers and cargo are the trip's load)
  cdA: number;         // drag area, m² (drag coefficient × frontal area)
  crr: number;         // rolling resistance coefficient
  driveEff: number;    // battery → wheels
  regenEff: number;    // wheels → battery when slowing or descending
  auxKw: number;       // steady draw for the cabin, lights, electronics
};
export const DEFAULT_ENERGY_MODEL: EnergyModel = { curbLb: 3600, driverLb: 180, cdA: 1.0, crr: 0.011, driveEff: 0.88, regenEff: 0.6, auxKw: 0.4 };

/** 12 V side from the pack. */
const DCDC_EFF = 0.9;
const G = 9.81, RHO = 1.2, LB = 0.45359237, MPH = 0.44704, M_PER_MI = 1609.344;
/** Samples further apart than this are a gap (GPS lost, parked mid-trip): no energy is spread across it. */
const GAP_S = 30;
/** Height is averaged over this window either side. */
const ALT_WINDOW_S = 15;
/** Speed is averaged over this window either side. */
const SPEED_WINDOW_S = 5;
/** At most this many points go to the screen. */
export const SERIES_MAX = 800;

export type EnergyPoint = { t: string; mi: number; lat: number; lon: number; altM: number | null; speedMph: number | null; powerKw: number; measured: boolean };
export type TripEnergy = {
  source: 'measured' | 'model' | 'mixed' | 'none';
  /** Share of driving time with measured power, 0-1. */
  measuredShare: number;
  totals: {
    miles: number; movingS: number;
    usedKwh: number; regenKwh: number; netKwh: number; whPerMi: number | null;
    climbM: number | null; descentM: number | null;
    maxKw: number; maxRegenKw: number;
    /**
     * Where the net went: the truck moving itself (and its own climate and
     * systems), the dash's tech, and switched accessories. Tech and
     * accessories are rated watts over time; driving is the rest.
     */
    driveKwh: number; techKwh: number; accessoryKwh: number;
  };
  /** Model only: where the energy went (kWh at the battery). Null when measured. */
  breakdown: { rolling: number; aero: number; climbing: number; accelerating: number; aux: number; tech: number; accessories: number } | null;
  massLb: number;
  series: EnergyPoint[];
};

/** Smoothed height per sample (time window), null where none is known. Pure. */
export function smoothAlt(s: { t: number; alt: number | null }[], windowS = ALT_WINDOW_S): (number | null)[] {
  let lo = 0, hi = 0, sum = 0, n = 0;
  return s.map((p) => {
    while (hi < s.length && s[hi].t <= p.t + windowS * 1000) { if (s[hi].alt !== null) { sum += s[hi].alt!; n++; } hi++; }
    while (s[lo].t < p.t - windowS * 1000) { if (s[lo].alt !== null) { sum -= s[lo].alt!; n--; } lo++; }
    return n ? sum / n : null;
  });
}

/** The trip's energy from its samples. Pure. */
export function tripEnergy(samples: EnergySample[], model: EnergyModel = DEFAULT_ENERGY_MODEL, loadLb = 0): TripEnergy {
  const massLb = model.curbLb + model.driverLb + Math.max(0, loadLb);
  const m = massLb * LB;
  const pts = samples.map((p) => ({ ...p, ms: Date.parse(p.t) })).filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
  const alt = smoothAlt(pts.map((p) => ({ t: p.ms, alt: p.altM })));
  // Speed is smoothed too: GPS speed wobbles by a mph or two between samples, and every wobble
  // would count as speeding up and slowing down, which the model charges for and only partly gets back.
  const spd = smoothAlt(pts.map((p) => ({ t: p.ms, alt: p.speedMph })), SPEED_WINDOW_S);
  const empty: TripEnergy = { source: 'none', measuredShare: 0, totals: { miles: 0, movingS: 0, usedKwh: 0, regenKwh: 0, netKwh: 0, whPerMi: null, climbM: null, descentM: null, maxKw: 0, maxRegenKw: 0, driveKwh: 0, techKwh: 0, accessoryKwh: 0 }, breakdown: null, massLb, series: [] };
  if (pts.length < 2) return empty;

  let mi = 0, movingS = 0, usedJ = 0, regenJ = 0, measuredS = 0, climb = 0, descent = 0, hadAlt = false, maxKw = 0, maxRegen = 0;
  const br = { rolling: 0, aero: 0, climbing: 0, accelerating: 0, aux: 0, tech: 0, accessories: 0 };
  let techJ = 0, accJ = 0;
  const series: EnergyPoint[] = [{ t: pts[0].t, mi: 0, lat: pts[0].lat, lon: pts[0].lon, altM: alt[0], speedMph: pts[0].speedMph, powerKw: 0, measured: pts[0].powerKw !== null }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dt = (b.ms - a.ms) / 1000;
    const dMi = haversineMi(a, b);
    mi += dMi;
    let kw = 0, measured = false;
    if (dt > 0 && dt <= GAP_S) {
      const ds = dMi * M_PER_MI;
      const vA = spd[i - 1] !== null ? spd[i - 1]! * MPH : ds / dt, vB = spd[i] !== null ? spd[i]! * MPH : ds / dt;
      const v = (vA + vB) / 2;
      if (v > 0.5) movingS += dt;
      const dh = alt[i - 1] !== null && alt[i] !== null ? alt[i]! - alt[i - 1]! : 0;
      if (alt[i - 1] !== null && alt[i] !== null) { hadAlt = true; if (dh > 0) climb += dh; else descent -= dh; }
      // The 12 V side (dash, accessories) runs off the pack through the DC-DC converter.
      const tW = ((a.techW ?? 0) + (b.techW ?? 0)) / 2 / DCDC_EFF, aW = ((a.accW ?? 0) + (b.accW ?? 0)) / 2 / DCDC_EFF;
      techJ += tW * dt; accJ += aW * dt;
      if (a.powerKw !== null && b.powerKw !== null) {
        measured = true; measuredS += dt;
        kw = (a.powerKw + b.powerKw) / 2;
      } else {
        const eRoll = v > 0.5 ? m * G * model.crr * ds : 0;
        const eAero = 0.5 * RHO * model.cdA * v * v * ds;
        const eClimb = m * G * dh;
        const eKin = 0.5 * m * (vB * vB - vA * vA);
        const wheel = eRoll + eAero + eClimb + eKin;
        const batt = wheel > 0 ? wheel / model.driveEff : wheel * model.regenEff;
        const aux = model.auxKw * 1000 * dt;
        kw = (batt + aux + (tW + aW) * dt) / dt / 1000;
        br.tech += tW * dt; br.accessories += aW * dt;
        if (wheel > 0) {
          // Shares of the positive work, each with the drivetrain's loss.
          const pos = eRoll + eAero + Math.max(0, eClimb) + Math.max(0, eKin);
          const f = pos > 0 ? batt / pos : 0;
          br.rolling += eRoll * f; br.aero += eAero * f; br.climbing += Math.max(0, eClimb) * f; br.accelerating += Math.max(0, eKin) * f;
        }
        br.aux += aux;
      }
      const j = kw * 1000 * dt;
      if (j >= 0) usedJ += j; else regenJ -= j;
      maxKw = Math.max(maxKw, kw); maxRegen = Math.min(maxRegen, kw);
    }
    series.push({ t: b.t, mi, lat: b.lat, lon: b.lon, altM: alt[i], speedMph: b.speedMph, powerKw: kw, measured });
  }
  const kwh = (j: number) => Math.round((j / 3.6e6) * 1000) / 1000;
  const drivingS = series.length > 1 ? Math.max(1, (pts[pts.length - 1].ms - pts[0].ms) / 1000) : 1;
  const share = Math.min(1, measuredS / drivingS);
  const usedKwh = kwh(usedJ), regenKwh = kwh(regenJ), netKwh = Math.round((usedKwh - regenKwh) * 1000) / 1000;
  return {
    source: share >= 0.95 ? 'measured' : share > 0.05 ? 'mixed' : 'model',
    measuredShare: Math.round(share * 100) / 100,
    totals: {
      miles: Math.round(mi * 100) / 100, movingS: Math.round(movingS),
      usedKwh, regenKwh, netKwh, whPerMi: mi > 0.05 ? Math.round((netKwh * 1000) / mi) : null,
      climbM: hadAlt ? Math.round(climb) : null, descentM: hadAlt ? Math.round(descent) : null,
      maxKw: Math.round(maxKw * 10) / 10, maxRegenKw: Math.round(-maxRegen * 10) / 10,
      techKwh: kwh(techJ), accessoryKwh: kwh(accJ),
      driveKwh: Math.round((netKwh - kwh(techJ) - kwh(accJ)) * 1000) / 1000,
    },
    breakdown: share >= 0.95 ? null : { rolling: kwh(br.rolling), aero: kwh(br.aero), climbing: kwh(br.climbing), accelerating: kwh(br.accelerating), aux: kwh(br.aux), tech: kwh(br.tech), accessories: kwh(br.accessories) },
    massLb: Math.round(massLb),
    series: downsample(series, SERIES_MAX),
  };
}

/** At most `max` points: buckets by distance, power averaged (so a short regen spike still shows in its bucket's sign). Pure. */
export function downsample(s: EnergyPoint[], max: number): EnergyPoint[] {
  if (s.length <= max) return s;
  const per = s.length / max, out: EnergyPoint[] = [];
  for (let k = 0; k < max; k++) {
    const part = s.slice(Math.floor(k * per), Math.floor((k + 1) * per));
    if (!part.length) continue;
    const last = part[part.length - 1];
    out.push({ ...last, powerKw: Math.round((part.reduce((x, p) => x + p.powerKw, 0) / part.length) * 100) / 100, measured: part.every((p) => p.measured) });
  }
  return out;
}

/** Keep a sample when it is at least this long after the last one. */
export const SAMPLE_EVERY_MS = 2000;
