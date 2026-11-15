import { describe, expect, it } from 'vitest';
import { parseLatLng, parseTimeline, TimelineError } from '../src/import/timeline.ts';
import { busiestWeek } from '../src/weekSim.ts';

describe('Google Timeline exports', () => {
  it('reads coordinates in all three shapes', () => {
    expect(parseLatLng('33.4567°, -112.0123°')).toEqual({ lat: 33.4567, lon: -112.0123 });
    expect(parseLatLng('geo:33.4567,-112.0123')).toEqual({ lat: 33.4567, lon: -112.0123 });
    expect(parseLatLng({ latitudeE7: 334567000, longitudeE7: -1120123000 })).toEqual({ lat: 33.4567, lon: -112.0123 });
    expect(parseLatLng('nowhere')).toBeNull();
  });
  it('Android Timeline.json: drives only, with Google distances', () => {
    const d = parseTimeline({ semanticSegments: [
      { startTime: '2026-06-01T08:00:00.000-07:00', endTime: '2026-06-01T08:30:00.000-07:00', activity: { start: { latLng: '33.45°, -112.07°' }, end: { latLng: '33.60°, -112.00°' }, distanceMeters: 20000, topCandidate: { type: 'IN_PASSENGER_VEHICLE' } } },
      { startTime: '2026-06-01T09:00:00.000-07:00', endTime: '2026-06-01T09:10:00.000-07:00', activity: { start: { latLng: '33.60°, -112.00°' }, end: { latLng: '33.61°, -112.00°' }, distanceMeters: 800, topCandidate: { type: 'WALKING' } } },
      { startTime: '2026-06-01T12:00:00.000-07:00', endTime: '2026-06-01T18:00:00.000-07:00', visit: { topCandidate: { placeLocation: { latLng: '33.6°, -112.0°' } } } },
    ] });
    expect(d).toHaveLength(1);
    expect(d[0].miles).toBeCloseTo(12.43, 1);
    expect(d[0].start).toEqual({ lat: 33.45, lon: -112.07 });
  });
  it('iPhone export and Takeout month files', () => {
    expect(parseTimeline([{ startTime: '2026-07-04T10:00:00Z', endTime: '2026-07-04T11:00:00Z', activity: { start: 'geo:33.4,-112.0', end: 'geo:34.2,-111.3', distanceMeters: '160934', topCandidate: { type: 'in passenger vehicle', probability: '0.9' } } }])[0].miles).toBeCloseTo(100, 0);
    const t = parseTimeline({ timelineObjects: [
      { activitySegment: { startLocation: { latitudeE7: 334500000, longitudeE7: -1120700000 }, endLocation: { latitudeE7: 335000000, longitudeE7: -1120000000 }, duration: { startTimestamp: '2026-08-01T15:00:00Z', endTimestamp: '2026-08-01T15:20:00Z' }, activityType: 'IN_VEHICLE' } },
      { placeVisit: {} },
    ] });
    expect(t).toHaveLength(1);
    expect(t[0].miles).toBeGreaterThan(5); // no distance: straight line x1.25
  });
  it('measures a drive along the GPS path when Google\'s distance is short', () => {
    // An hour south on a straight road, a fix a minute, ~1 mi apart (60 mph): Google says 5 mi.
    const t0 = Date.parse('2026-10-29T14:00:00Z');
    const path = Array.from({ length: 61 }, (_, i) => ({ point: `geo:${(33.5 - i * 0.01449).toFixed(5)},-112.0`, durationMinutesOffsetFromStartTime: String(i) }));
    const t = parseTimeline([
      { startTime: '2026-10-29T13:30:00Z', endTime: '2026-10-29T14:00:00Z', visit: { topCandidate: { placeLocation: 'geo:33.5,-112.0' } } },
      { startTime: '2026-10-29T14:00:00Z', endTime: '2026-10-29T15:00:00Z', activity: { start: 'geo:33.2,-112.0', end: 'geo:33.0,-112.0', distanceMeters: '8047', topCandidate: { type: 'in passenger vehicle' } } },
      { startTime: '2026-10-29T14:00:00Z', endTime: '2026-10-29T16:00:00Z', timelinePath: path },
      // A bad fix far away mid-drive, then back: skipped, not driven.
      { startTime: '2026-10-29T15:00:00Z', endTime: '2026-10-29T15:30:00Z', visit: { topCandidate: { placeLocation: 'geo:32.62,-112.0' } } },
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].miles).toBeGreaterThan(58);
    expect(t[0].miles).toBeLessThan(62);
    expect(t[0].path.length).toBeGreaterThan(50);
    expect(t0).toBe(t[0].startedAt);
    // Never more than 80 mph average, whatever the fixes say.
    const wild = parseTimeline([
      { startTime: '2026-10-29T14:00:00Z', endTime: '2026-10-29T14:10:00Z', activity: { start: 'geo:33.5,-112.0', end: 'geo:33.4,-112.0', distanceMeters: '1000', topCandidate: { type: 'in passenger vehicle' } } },
      { startTime: '2026-10-29T14:00:00Z', endTime: '2026-10-29T16:00:00Z', timelinePath: Array.from({ length: 11 }, (_, i) => ({ point: `geo:${33.5 + (i % 2) * 0.3},-112.0`, durationMinutesOffsetFromStartTime: String(i) })) },
    ]);
    expect(wild[0].miles).toBeLessThanOrEqual(80 * 10 / 60 + 0.01);
  });
  it('refuses a file that is not a Timeline export', () => {
    expect(() => parseTimeline({ hello: 1 })).toThrow(TimelineError);
  });
});

describe('busiest week', () => {
  it('finds the 7 consecutive days with the most miles', () => {
    const at = (m: number, d: number, miles: number) => ({ startedAt: new Date(2026, m, d, 9).getTime(), endedAt: new Date(2026, m, d, 10).getTime(), miles });
    const trips = [at(5, 1, 20), at(6, 10, 50), at(6, 12, 60), at(6, 15, 40), at(6, 17, 10), at(8, 1, 30)];
    const b = busiestWeek(trips, new Date(2026, 4, 15), new Date(2026, 10, 15))!;
    expect(b.miles).toBe(150);              // Jul 10, 12 and 15 fit in one 7-day window; Jul 17 doesn't with Jul 10
    expect(b.start <= '2026-07-10').toBe(true);
    expect(b.daily).toHaveLength(7);
    expect(busiestWeek([], new Date(2026, 4, 15), new Date(2026, 10, 15))).toBeNull();
  });
});
