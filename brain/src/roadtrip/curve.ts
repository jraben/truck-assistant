// The truck's DC charging curve: how many kW it takes at each charge level.
//
// Slate hasn't published one, so this starts from a generic curve shaped like
// other ~120 kW packs (flat to about 50%, then tapering hard past 80%) and is
// replaced, bin by bin, by what this truck actually took on DC chargers. The
// samples come from the charge level rising while plugged in (charge_samples,
// samples.ts). Pure: no Node APIs, so the UI can import it too.

/** The truck's DC peak (~120 kW). Same number the charger scoring uses. */
export const PEAK_KW = 120;
/** Bin width, in charge-level points. */
export const BIN = 5;
/** A learned bin needs this many samples before it replaces the generic one. */
export const MIN_SAMPLES = 3;
/** Charger power is never fully delivered to the pack. */
const STATION_EFF = 0.95;

/** Share of PEAK_KW at the start of each 5% bin (0-5%, 5-10%, ... 95-100%). */
const SHAPE = [0.8, 0.9, 1, 1, 1, 1, 1, 1, 1, 1, 0.95, 0.9, 0.8, 0.72, 0.62, 0.52, 0.4, 0.3, 0.2, 0.12];

export type CurvePoint = { soc: number; kw: number; learned: boolean; samples: number };
export type Curve = { points: CurvePoint[]; learnedBins: number; peakKw: number };

/** A measured rate while charging: from one charge level to the next, and the station's rated power if known. */
export type RateSample = { socFrom: number; socTo: number; kw: number; stationKw: number | null };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const binOf = (soc: number) => clamp(Math.floor(soc / BIN), 0, SHAPE.length - 1);

export function genericCurve(peakKw = PEAK_KW): Curve {
  return { points: SHAPE.map((f, i) => ({ soc: i * BIN, kw: Math.round(f * peakKw * 10) / 10, learned: false, samples: 0 })), learnedBins: 0, peakKw };
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/**
 * The curve from samples. Only DC samples (over 20 kW) on a charger that could
 * have given more than the truck takes (or of unknown power) teach the truck's
 * own limit: a 50 kW stall says nothing about what the pack accepts at 30%. The
 * 75th percentile, so one slow stall doesn't drag the curve down. Bins with too
 * few samples keep the generic shape, scaled by how the learned bins compare.
 */
export function learnCurve(samples: RateSample[], peakKw = PEAK_KW): Curve {
  const base = genericCurve(peakKw);
  const byBin: number[][] = SHAPE.map(() => []);
  for (const s of samples) {
    if (!(s.kw > 20) || !(s.socTo > s.socFrom)) continue;
    const mid = (s.socFrom + s.socTo) / 2;
    const expect = base.points[binOf(mid)].kw;
    if (s.stationKw !== null && s.stationKw * STATION_EFF < expect) continue;   // the stall was the limit, not the pack
    byBin[binOf(mid)].push(s.kw);
  }
  const ratios: number[] = [];
  const learned = byBin.map((xs, i) => {
    if (xs.length < MIN_SAMPLES) return null;
    const kw = quantile(xs, 0.75);
    ratios.push(kw / base.points[i].kw);
    return kw;
  });
  // Unlearned bins follow the learned ones' scale, kept within reason.
  const scale = ratios.length ? clamp(quantile(ratios, 0.5), 0.5, 1.5) : 1;
  const points = base.points.map((p, i) => learned[i] !== null
    ? { soc: p.soc, kw: Math.round(learned[i]! * 10) / 10, learned: true, samples: byBin[i].length }
    : { soc: p.soc, kw: Math.round(p.kw * scale * 10) / 10, learned: false, samples: byBin[i].length });
  return { points, learnedBins: ratios.length, peakKw };
}

/** What the truck should take at this charge level on this charger (kW). L2 and slow DC are capped by the station. */
export function kwAt(curve: Curve, soc: number, stationKw: number | null = null): number {
  const truck = curve.points[binOf(soc)].kw;
  return stationKw === null ? truck : Math.min(truck, stationKw * STATION_EFF);
}

/** Minutes to charge from `from`% to `to`% (1-point steps). 0 when to <= from; Infinity when nothing flows. */
export function minutesToCharge(curve: Curve, packKwh: number, from: number, to: number, stationKw: number | null = null, perfRatio = 1): number {
  if (!(to > from)) return 0;
  let min = 0;
  for (let s = Math.floor(from); s < Math.ceil(to); s++) {
    const step = Math.min(s + 1, to) - Math.max(s, from);
    const kw = kwAt(curve, s, stationKw) * perfRatio;
    if (!(kw > 0)) return Infinity;
    min += ((step / 100) * packKwh / kw) * 60;
  }
  return min;
}

/** Charge level reached after `minutes` from `from`%. */
export function socAfterMinutes(curve: Curve, packKwh: number, from: number, minutes: number, stationKw: number | null = null): number {
  let soc = from, left = minutes;
  while (left > 0 && soc < 100) {
    const kw = kwAt(curve, soc, stationKw);
    if (!(kw > 0)) break;
    const perPoint = ((packKwh / 100) / kw) * 60;   // minutes per 1%
    const step = Math.min(1 - (soc % 1 || 0), 1);
    const need = perPoint * step;
    if (need > left) { soc += (left / perPoint); break; }
    soc += step; left -= need;
  }
  return clamp(soc, 0, 100);
}

/** Miles added per minute of charging at this charge level, at an efficiency in mi/kWh. */
export function milesPerMinute(curve: Curve, soc: number, effMiPerKwh: number, stationKw: number | null = null): number {
  return (kwAt(curve, soc, stationKw) / 60) * effMiPerKwh;
}
