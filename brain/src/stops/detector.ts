// Stops: where the truck (or a phone) stayed put. Pure; feed it samples.
//
// A stop starts when the ignition turns OFF, or when every sample for at
// least STOP_MIN_MS stays within STOP_RADIUS_M of where it slowed down and the
// speed (when known) is under STOP_MPH. The arrival time is backdated to the
// first sample of that dwell. A stop ends when a sample is outside the radius.
//
// Sparse data (phone history): when the next point outside the radius arrives
// long after the last one inside, the departure is estimated as that point's
// time minus the straight-line distance at DEPART_MPH, so an overnight at home
// with one point at 18:00 and the next at 08:00 two km away is a stop.
//
// Stops shorter than STOP_MIN_MS are reported as `short` on departure (only an
// ignition-off stop can be short; a dwell stop is >= STOP_MIN_MS by
// construction). The caller folds those into the trip.
import { metersBetween, type LatLon } from '../geo.ts';

export const STOP_RADIUS_M = 75;
export const STOP_MIN_MS = 3 * 60_000;
export const STOP_MPH = 2;
export const DEPART_MPH = 30;

export type StopSample = { t: number; lat: number; lon: number; speedMph: number | null; ignition?: boolean | null };
export type StopArrive = { type: 'arrive'; at: number; lat: number; lon: number; reason: 'ignition' | 'dwell' };
export type StopDepart = { type: 'depart'; at: number; arrivedAt: number; short: boolean };
export type StopEvent = StopArrive | StopDepart;

type Pt = LatLon & { t: number };

export class StopDetector {
  /** The confirmed stop the vehicle is at, if any. */
  stop: { at: number; lat: number; lon: number; reason: 'ignition' | 'dwell' } | null = null;
  private anchor: Pt | null = null;   // first sample of a possible dwell
  private lastIn: Pt | null = null;   // last sample inside the anchor or stop radius
  private lastIgn: boolean | null = null;
  private minMs: number;
  get minDwellMs() { return this.minMs; }

  /** timeScale > 1 shortens the 3-minute rule (SIM_SPEEDUP packs simulated time into real seconds). */
  constructor(timeScale = 1) { this.minMs = STOP_MIN_MS / Math.max(1, timeScale); }

  /** Resume at a stop that was open before a restart. */
  restore(stop: { at: number; lat: number; lon: number; reason: 'ignition' | 'dwell' }) {
    this.stop = { ...stop };
    this.lastIn = { lat: stop.lat, lon: stop.lon, t: stop.at };
    this.anchor = null;
  }

  update(s: StopSample): StopEvent[] {
    const ev: StopEvent[] = [];
    const ignOff = s.ignition === false && this.lastIgn !== false;
    if (s.ignition !== null && s.ignition !== undefined) this.lastIgn = s.ignition;
    const p: Pt = { lat: s.lat, lon: s.lon, t: s.t };

    if (this.stop) {
      if (metersBetween(this.stop, p) <= STOP_RADIUS_M) { this.lastIn = p; return ev; }
      const at = this.departTime(p);
      ev.push({ type: 'depart', at, arrivedAt: this.stop.at, short: at - this.stop.at < this.minMs });
      this.stop = null;
      this.anchor = this.slow(s) ? p : null;
      this.lastIn = this.anchor;
      return ev;
    }

    if (ignOff) {
      // Arrived when it stopped moving, if that was close by; else now.
      const from = this.anchor && metersBetween(this.anchor, p) <= STOP_RADIUS_M ? this.anchor : p;
      this.arrive(ev, from, 'ignition');
      this.lastIn = p;
      return ev;
    }

    if (this.anchor && metersBetween(this.anchor, p) <= STOP_RADIUS_M && this.slow(s)) {
      this.lastIn = p;
      if (p.t - this.anchor.t >= this.minMs) this.arrive(ev, this.anchor, 'dwell');
      return ev;
    }

    // Left the candidate radius (or sped up). A long silent gap inside it still counts as a stop.
    if (this.anchor && this.lastIn) {
      const at = this.departTime(p);
      const a = this.anchor;
      if (at - a.t >= this.minMs) {
        this.arrive(ev, a, 'dwell');
        ev.push({ type: 'depart', at, arrivedAt: a.t, short: false });
        this.stop = null;
      }
    }
    this.anchor = this.slow(s) ? p : null;
    this.lastIn = this.anchor;
    return ev;
  }

  /** The start of a dwell still building, if any. */
  pending(): Pt | null { return this.anchor ? { ...this.anchor } : null; }

  private slow(s: StopSample) { return s.speedMph === null || s.speedMph < STOP_MPH; }

  private arrive(ev: StopEvent[], at: Pt, reason: 'ignition' | 'dwell') {
    this.stop = { at: at.t, lat: at.lat, lon: at.lon, reason };
    this.anchor = null;
    ev.push({ type: 'arrive', at: at.t, lat: at.lat, lon: at.lon, reason });
  }

  /** When it left: now, or for a long gap, the latest time it could have left and still got here. */
  private departTime(p: Pt): number {
    const last = this.lastIn ?? p;
    const travelMs = (metersBetween(last, p) / 1609.344 / DEPART_MPH) * 3600_000;
    return Math.max(last.t, Math.round(p.t - travelMs));
  }
}
