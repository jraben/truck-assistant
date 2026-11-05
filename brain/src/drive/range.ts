// City / highway range (docs/drive-v2.md §6). Pure pieces plus a small model:
// - a rolling 2-minute, time-weighted average speed picks the mode (>= highwayMph = highway);
// - each mode keeps its own mi/kWh, an EWMA over windows of real energy readings
//   (CAN, or two manual SoC anchors with driving between), seeded from Settings;
// - range in a mode = soc% x pack x that mode's mi/kWh.
import type { RangeMode, RangeOverride } from './types.ts';

export const WINDOW_MS = 2 * 60_000;
/** A learning window closes once it has this many miles in one mode. */
export const LEARN_WINDOW_MI = 2;

export type SpeedSample = { t: number; mph: number };

/**
 * Time-weighted mean speed over the last `windowMs` (each sample holds until the
 * next). null when the samples cover less than a quarter of the window.
 */
export function rollingAvg(samples: SpeedSample[], now: number, windowMs = WINDOW_MS): number | null {
  const from = now - windowMs;
  let area = 0, covered = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = i + 1 < samples.length ? samples[i + 1].t : now;
    const t0 = Math.max(a.t, from), t1 = Math.min(b, now);
    if (t1 <= t0) continue;
    // a gap of more than 10 s between samples is unknown, not "still at that speed"
    const t1c = Math.min(t1, a.t + 10_000);
    if (t1c <= t0) continue;
    area += a.mph * (t1c - t0);
    covered += t1c - t0;
  }
  if (covered < windowMs / 4) return null;
  return area / covered;
}

/** Highway at or over the threshold. A null average (just started) is city. */
export function classify(avgMph: number | null, highwayMph: number): RangeMode {
  return avgMph !== null && avgMph >= highwayMph ? 'highway' : 'city';
}

/** The mode shown: the override when set, else the classifier's. */
export const effectiveMode = (auto: RangeMode, override: RangeOverride): RangeMode => (override === 'auto' ? auto : override);

/** One EWMA step: a window's measured mi/kWh pulls the estimate by `alpha`, scaled by how much of a full window it was. */
export function ewma(prev: number, sample: number, alpha: number, weight = 1): number {
  const a = Math.max(0, Math.min(1, alpha * Math.max(0, Math.min(1, weight))));
  return prev + a * (sample - prev);
}

/** A measured window is believable: positive energy, and between 1 and 8 mi/kWh. */
export const plausible = (miles: number, kwh: number) => miles > 0 && kwh > 0 && miles / kwh >= 1 && miles / kwh <= 8;

export function rangeFor(soc: number | null, packKwh: number, miPerKwh: number): number | null {
  if (soc === null || !(packKwh > 0) || !(miPerKwh > 0)) return null;
  return Math.round((soc / 100) * packKwh * miPerKwh);
}

export type ModeStats = { eff: number; learnedMiles: number };
export type RangeSnapshot = { city: ModeStats; highway: ModeStats; override: RangeOverride };

/**
 * The live model: feed it speed samples, driven miles and SoC readings; ask it
 * the mode and per-mode efficiency. `soc` readings count for learning only when
 * their source is a real reading ('can' or 'manual'), never the estimate.
 */
export class RangeModel {
  samples: SpeedSample[] = [];
  stats: { city: ModeStats; highway: ModeStats };
  override: RangeOverride;
  private window: { mode: RangeMode; miles: number; startSoc: number } | null = null;

  constructor(seed: { city: number; highway: number }, snap?: RangeSnapshot | null) {
    this.stats = {
      city: snap?.city && snap.city.learnedMiles > 0 ? { ...snap.city } : { eff: seed.city, learnedMiles: 0 },
      highway: snap?.highway && snap.highway.learnedMiles > 0 ? { ...snap.highway } : { eff: seed.highway, learnedMiles: 0 },
    };
    this.override = snap?.override ?? 'auto';
  }

  /** New seeds from Settings apply to a mode that hasn't learned anything yet. */
  reseed(seed: { city: number; highway: number }) {
    if (this.stats.city.learnedMiles === 0) this.stats.city.eff = seed.city;
    if (this.stats.highway.learnedMiles === 0) this.stats.highway.eff = seed.highway;
  }

  addSample(t: number, mph: number | null) {
    if (mph === null || !Number.isFinite(mph)) return;
    this.samples.push({ t, mph: Math.max(0, mph) });
    const cut = t - WINDOW_MS - 15_000;
    while (this.samples.length > 2 && this.samples[1].t < cut) this.samples.shift();
  }

  avg(now: number) { return rollingAvg(this.samples, now); }
  autoMode(now: number, highwayMph: number): RangeMode { return classify(this.avg(now), highwayMph); }
  mode(now: number, highwayMph: number): RangeMode { return effectiveMode(this.autoMode(now, highwayMph), this.override); }
  eff(mode: RangeMode) { return this.stats[mode].eff; }

  /**
   * Miles driven in `mode` (always the auto mode: what the road was, whatever is
   * shown). `soc` is the reading now and whether it is real. Returns the mode's
   * stats when a window closed and was learned from.
   */
  addMiles(mode: RangeMode, miles: number, soc: { value: number | null; real: boolean }, packKwh: number, alpha: number): boolean {
    if (!(miles > 0)) return false;
    if (!soc.real || soc.value === null) { this.window = null; return false; }
    if (!this.window || this.window.mode !== mode) { this.window = { mode, miles: 0, startSoc: soc.value }; }
    this.window.miles += miles;
    if (this.window.miles < LEARN_WINDOW_MI) return false;
    const kwh = ((this.window.startSoc - soc.value) / 100) * packKwh;
    const w = this.window;
    this.window = { mode, miles: 0, startSoc: soc.value };
    if (!plausible(w.miles, kwh)) return false;
    const s = this.stats[mode];
    s.eff = Math.round(ewma(s.eff, w.miles / kwh, alpha, w.miles / LEARN_WINDOW_MI) * 1000) / 1000;
    s.learnedMiles = Math.round((s.learnedMiles + w.miles) * 10) / 10;
    return true;
  }

  snapshot(): RangeSnapshot { return { city: { ...this.stats.city }, highway: { ...this.stats.highway }, override: this.override }; }
}
