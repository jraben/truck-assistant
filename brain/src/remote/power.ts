// Tier 2 power: who is watching, and when the Pi goes back to sleep.
//
// The Pi is awake either because the truck is on (ignition: the car power
// board keeps it up and shuts it down on its own after ignition off) or
// because the tier 1 watch woke it for a remote viewer ("remote"). Only a
// remote wake goes back to sleep by itself: after `sleepAfterMin` with no
// viewer, or `maxAwakeMin` in all. Never while the ignition is on, never while
// a clip is still being cut. Pure apart from the injected clock.

export type Viewer = { id: string; kind: string; lastSeen: number };

export type PowerDecision = {
  action: 'none' | 'sleep';
  awakeReason: 'ignition' | 'remote' | 'unknown';
  viewers: number;
  sleepAt: number | null;
  why: string;
};

/** A viewer that hasn't pinged for this long is gone (pages ping every 20 s; streams register while open). */
export const VIEWER_TTL_MS = 45_000;

export class PowerManager {
  private viewers = new Map<string, Viewer>();
  private streams = new Map<string, number>();     // open live streams count as viewers
  private lastViewerAt: number;
  private wokeAt: number;
  awakeReason: PowerDecision['awakeReason'] = 'unknown';
  sleeping = false;
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
    this.lastViewerAt = now();
    this.wokeAt = now();
  }

  ping(id: string, kind = 'page') {
    const t = this.now();
    this.viewers.set(id, { id, kind, lastSeen: t });
    this.lastViewerAt = t;
  }

  /** An open stream (MJPEG or go2rtc WebSocket). Returns the "closed" function. */
  openStream(): () => void {
    const id = `s${Math.random().toString(36).slice(2)}`;
    this.streams.set(id, this.now());
    this.lastViewerAt = this.now();
    return () => { this.streams.delete(id); this.lastViewerAt = this.now(); };
  }

  count(): number {
    const t = this.now();
    for (const [id, v] of this.viewers) if (t - v.lastSeen > VIEWER_TTL_MS) this.viewers.delete(id);
    if (this.streams.size) this.lastViewerAt = t;
    return this.viewers.size + this.streams.size;
  }

  /**
   * The ignition says why we're awake: on = driving. Off at boot (or the watch
   * says it woke us) = a remote wake. Ignition off after a drive stays
   * "ignition": the power board handles that shutdown on its own.
   */
  observe(ignition: boolean | null, watchWokeUs: boolean | null) {
    if (ignition === true) { if (this.awakeReason !== 'ignition') this.awakeReason = 'ignition'; this.sleeping = false; return; }
    if (this.awakeReason === 'unknown' && (ignition === false || watchWokeUs === true)) {
      this.awakeReason = 'remote';
      this.wokeAt = this.now();
      this.lastViewerAt = this.now();
    }
  }

  /** A fresh remote wake (the watch raised the line again after a sleep request that didn't happen). */
  rearm() { this.awakeReason = 'remote'; this.sleeping = false; this.wokeAt = this.now(); this.lastViewerAt = this.now(); }

  decide(opts: { sleepAfterMin: number; maxAwakeMin: number; busy: string | null }): PowerDecision {
    const t = this.now();
    const viewers = this.count();
    const base = { awakeReason: this.awakeReason, viewers };
    if (this.sleeping) return { ...base, action: 'none', sleepAt: null, why: 'Going to sleep' };
    if (this.awakeReason === 'ignition') return { ...base, action: 'none', sleepAt: null, why: 'Truck on: the power board decides' };
    if (this.awakeReason === 'unknown') return { ...base, action: 'none', sleepAt: null, why: 'Waiting for the truck box to say whether the ignition is on' };
    const idleAt = this.lastViewerAt + opts.sleepAfterMin * 60_000;
    const hardAt = opts.maxAwakeMin > 0 ? this.wokeAt + opts.maxAwakeMin * 60_000 : Infinity;
    const sleepAt = viewers ? hardAt : Math.min(idleAt, hardAt);
    if (t >= sleepAt) {
      if (opts.busy) return { ...base, action: 'none', sleepAt: null, why: `Staying up: ${opts.busy}` };
      return { ...base, action: 'sleep', sleepAt: t, why: t >= hardAt ? `Awake ${opts.maxAwakeMin} min (the limit)` : `No viewer for ${opts.sleepAfterMin} min` };
    }
    const when = Number.isFinite(sleepAt) ? new Date(sleepAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    return { ...base, action: 'none', sleepAt: Number.isFinite(sleepAt) ? sleepAt : null, why: viewers ? `${viewers} viewer${viewers > 1 ? 's' : ''}${when ? `; sleeps by ${when} at the latest` : ''}` : `Sleeps at ${when} with no viewer` };
  }
}
