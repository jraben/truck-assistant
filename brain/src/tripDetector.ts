// When a trip starts and ends. Pure: feed it samples, it says start/end.
//
// Start: ignition turns ON, or (no ignition signal, or ignition ON after an
//        earlier stationary end) sustained movement: >= MOVE_MPH for MOVE_MS.
// End:   ignition turns OFF, or stationary (< STILL_MPH, or no speed) for STILL_MS.
// An ignition reading of null (truck box offline) is "no signal", not OFF.

export const MOVE_MPH = 3;
export const MOVE_MS = 15_000;
export const STILL_MPH = 1;
export const STILL_MS = 5 * 60_000;

export type TripSample = { t: number; ignition: boolean | null; speedMph: number | null };
export type TripEvent = { type: 'start'; reason: 'ignition' | 'movement' } | { type: 'end'; reason: 'ignition off' | 'stationary' };

export class TripDetector {
  active = false;
  private lastIgn: boolean | null = null;
  private movingSince: number | null = null;
  private stillSince: number | null = null;

  constructor(active = false) { this.active = active; }

  update(s: TripSample): TripEvent | null {
    const moving = s.speedMph !== null && s.speedMph >= MOVE_MPH;
    const still = s.speedMph === null || s.speedMph < STILL_MPH;
    const ignOn = s.ignition === true && this.lastIgn !== true;
    const ignOff = s.ignition === false && this.lastIgn === true;
    if (s.ignition !== null) this.lastIgn = s.ignition;

    if (this.active) {
      if (ignOff) return this.end('ignition off');
      if (still) {
        this.stillSince ??= s.t;
        if (s.t - this.stillSince >= STILL_MS) return this.end('stationary');
      } else this.stillSince = null;
      return null;
    }

    if (ignOn) return this.start('ignition');
    if (s.ignition !== false && moving) {
      this.movingSince ??= s.t;
      if (s.t - this.movingSince >= MOVE_MS) return this.start('movement');
    } else this.movingSince = null;
    return null;
  }

  /** The brain ended the trip itself (a stop was detected). */
  forceEnd() { this.active = false; this.stillSince = null; this.movingSince = null; }

  /** A too-short stop was folded back into the trip: carry on. */
  resume() { this.active = true; this.stillSince = null; this.movingSince = null; }

  private start(reason: 'ignition' | 'movement'): TripEvent {
    this.active = true; this.stillSince = null; this.movingSince = null;
    return { type: 'start', reason };
  }

  private end(reason: 'ignition off' | 'stationary'): TripEvent {
    this.active = false; this.stillSince = null; this.movingSince = null;
    return { type: 'end', reason };
  }
}
