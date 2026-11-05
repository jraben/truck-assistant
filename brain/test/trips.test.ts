import { describe, expect, it } from 'vitest';
import { MOVE_MS, STILL_MS, TripDetector, type TripSample } from '../src/tripDetector.ts';
import { keepPoint } from '../src/trips.ts';
import { simplify } from '../src/geo.ts';

/** Feed samples once a second; return the events with their time. */
function run(det: TripDetector, from: number, secs: number, f: (t: number) => Omit<TripSample, 't'>) {
  const out: { t: number; type: string; reason: string }[] = [];
  for (let s = 0; s < secs; s++) {
    const t = from + s * 1000;
    const e = det.update({ t, ...f(t) });
    if (e) out.push({ t, ...e });
  }
  return out;
}

describe('TripDetector', () => {
  it('starts on ignition ON and ends on ignition OFF', () => {
    const d = new TripDetector();
    expect(d.update({ t: 0, ignition: false, speedMph: 0 })).toBeNull();
    expect(d.update({ t: 1000, ignition: true, speedMph: 0 })).toEqual({ type: 'start', reason: 'ignition' });
    expect(d.update({ t: 2000, ignition: true, speedMph: 30 })).toBeNull();
    expect(d.update({ t: 3000, ignition: false, speedMph: 0 })).toEqual({ type: 'end', reason: 'ignition off' });
    expect(d.active).toBe(false);
  });

  it('ignition already ON at boot starts a trip', () => {
    const d = new TripDetector();
    expect(d.update({ t: 0, ignition: true, speedMph: 0 })?.type).toBe('start');
  });

  it('without an ignition signal, starts only on sustained movement', () => {
    const d = new TripDetector();
    // A short roll (5 s) is not a trip.
    expect(run(d, 0, 5, () => ({ ignition: null, speedMph: 10 }))).toEqual([]);
    run(d, 5000, 3, () => ({ ignition: null, speedMph: 0 }));
    const ev = run(d, 10_000, 30, () => ({ ignition: null, speedMph: 20 }));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'start', reason: 'movement' });
    expect(ev[0].t - 10_000).toBe(MOVE_MS);
  });

  it('ends after 5 minutes stationary, not before', () => {
    const d = new TripDetector();
    d.update({ t: 0, ignition: null, speedMph: 20 });
    d.update({ t: MOVE_MS, ignition: null, speedMph: 20 });
    expect(d.active).toBe(true);
    const start = 60_000;
    const ev = run(d, start, STILL_MS / 1000 + 5, () => ({ ignition: null, speedMph: 0 }));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'end', reason: 'stationary' });
    expect(ev[0].t - start).toBe(STILL_MS);
  });

  it('a stop shorter than 5 minutes keeps the trip going', () => {
    const d = new TripDetector();
    d.update({ t: 0, ignition: true, speedMph: 0 });
    expect(run(d, 1000, 200, () => ({ ignition: true, speedMph: 0 }))).toEqual([]);
    expect(run(d, 201_000, 10, () => ({ ignition: true, speedMph: 25 }))).toEqual([]);
    expect(run(d, 211_000, 200, () => ({ ignition: true, speedMph: 0 }))).toEqual([]);
    expect(d.active).toBe(true);
  });

  it('after a stationary end with ignition still ON, movement starts the next trip', () => {
    const d = new TripDetector();
    d.update({ t: 0, ignition: true, speedMph: 0 });
    const ended = run(d, 1000, STILL_MS / 1000 + 2, () => ({ ignition: true, speedMph: 0 }));
    expect(ended[0]?.type).toBe('end');
    const t0 = 1000 + STILL_MS + 5000;
    const next = run(d, t0, 20, () => ({ ignition: true, speedMph: 15 }));
    expect(next).toEqual([{ t: t0 + MOVE_MS, type: 'start', reason: 'movement' }]);
  });

  it('ignition OFF blocks movement starts (towed, or GPS drift)', () => {
    const d = new TripDetector();
    expect(run(d, 0, 60, () => ({ ignition: false, speedMph: 20 }))).toEqual([]);
  });

  it('truck box dropping out (ignition null) does not end the trip', () => {
    const d = new TripDetector();
    d.update({ t: 0, ignition: true, speedMph: 30 });
    expect(run(d, 1000, 30, () => ({ ignition: null, speedMph: 30 }))).toEqual([]);
    // Coming back with OFF still ends it: last known was ON.
    expect(d.update({ t: 40_000, ignition: false, speedMph: 0 })).toEqual({ type: 'end', reason: 'ignition off' });
  });
});

describe('point thinning', () => {
  const p = (lat: number, lon: number, t: number, h: number | null = 90) => ({ lat, lon, t, headingDeg: h });
  it('keeps the first point, skips jitter, keeps moves and turns', () => {
    expect(keepPoint(null, p(33.45, -112.07, 0))).toBe(true);
    expect(keepPoint(p(33.45, -112.07, 0), p(33.45001, -112.07, 1000))).toBe(false);   // ~1 m
    expect(keepPoint(p(33.45, -112.07, 0), p(33.4503, -112.07, 1000))).toBe(true);     // ~33 m
    expect(keepPoint(p(33.45, -112.07, 0, 90), p(33.45008, -112.07, 1000, 180))).toBe(true); // ~9 m, 90 deg turn
  });

  it('Douglas-Peucker drops collinear points and keeps corners', () => {
    const line = [p(33.40, -112.0, 0), p(33.41, -112.0, 1), p(33.42, -112.0, 2), p(33.42, -111.99, 3), p(33.42, -111.98, 4)];
    const s = simplify(line, 5);
    expect(s.map((x) => x.t)).toEqual([0, 2, 4]);
  });
});
