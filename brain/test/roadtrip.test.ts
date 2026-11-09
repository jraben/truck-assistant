import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { defaultCharging, defaultSettings } from '../src/settings.ts';
import { genericCurve, kwAt, learnCurve, minutesToCharge, socAfterMinutes, MIN_SAMPLES, type RateSample } from '../src/roadtrip/curve.ts';
import { plan, energyModel, sitePenalty, MAX_CHARGE, STOP_OVERHEAD_MIN, type Candidate, type PlanInput } from '../src/roadtrip/planner.ts';
import { coach } from '../src/roadtrip/coach.ts';
import { rateKw, SampleStore, sitePerformance, type SampleRow } from '../src/roadtrip/samples.ts';
import { fetchRoute, locate, withMiles, type Route } from '../src/roadtrip/route.ts';
import { RoadTripService } from '../src/roadtrip/service.ts';
import { osrmAnswer } from '../src/demo/backend.ts';
import type { Charger } from '../src/types.ts';
import type { ChargerFinder, FinderSettings } from '../src/chargers/finder.ts';

const tmpDb = () => openDb(mkdtempSync(path.join(tmpdir(), 'rt-')));

/** A flat, straight 300-mile route due east at 60 mph. */
function flatRoute(miles = 300): Route {
  const pts = Array.from({ length: miles + 1 }, (_, i) => ({ lat: 33, lon: -112 + i / 53.3 }));
  const r = withMiles(pts);
  const k = miles / r.at(-1)!.mi;
  for (const p of r) p.mi *= k;
  return { points: r, miles, minutes: miles, source: 'osrm', elevation: false };
}

function charger(id: string, mi: number, over: Partial<Charger> = {}): Candidate {
  return {
    charger: { id, source: 'ocm', name: `Charger ${id}`, network: 'Net', lat: 33, lon: -112 + mi / 53.3, distanceMi: 0, maxKw: 150, connectors: ['CCS'], amenities: [], price: null, score: 70, reasons: [], ...over },
    routeMi: mi, offMi: 0.3, perfRatio: 1,
  };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    route: flatRoute(), startMi: 0, startSoc: 90, packKwh: 52.7, effMiPerKwh: 3.5, tempF: 75, curve: genericCurve(),
    candidates: [60, 100, 140, 180, 220, 260].map((m) => charger(`c${m}`, m)),
    arriveMinSoc: 15, destMinSoc: 15, now: Date.parse('2027-06-01T08:00:00Z'), ...over,
  };
}

describe('charging curve', () => {
  it('is flat to 50% and slow past 80%', () => {
    const c = genericCurve(120);
    expect(kwAt(c, 30)).toBe(120);
    expect(kwAt(c, 85)).toBeLessThan(40);
    expect(kwAt(c, 30, 50)).toBeCloseTo(47.5);   // a 50 kW stall is the limit
  });

  it('times a charge from the curve, and 10-60% beats 40-90%', () => {
    const c = genericCurve(120);
    const low = minutesToCharge(c, 52.7, 10, 60);
    const high = minutesToCharge(c, 52.7, 40, 90);
    expect(low).toBeGreaterThan(10);
    expect(low).toBeLessThan(16);
    expect(high).toBeGreaterThan(low * 1.3);
    expect(socAfterMinutes(c, 52.7, 10, low)).toBeCloseTo(60, 0);
  });

  it('learns bins from DC samples, ignoring stalls slower than the truck', () => {
    const samples: RateSample[] = [];
    for (let i = 0; i < MIN_SAMPLES; i++) samples.push({ socFrom: 30, socTo: 32, kw: 95, stationKw: 350 });
    samples.push({ socFrom: 30, socTo: 32, kw: 45, stationKw: 50 });     // a 50 kW stall: says nothing about the pack
    samples.push({ socFrom: 50, socTo: 52, kw: 6, stationKw: null });    // Level 2: ignored
    const c = learnCurve(samples, 120);
    expect(c.learnedBins).toBe(1);
    expect(c.points[6]).toMatchObject({ soc: 30, kw: 95, learned: true, samples: 3 });
    // Unlearned bins follow the learned bin's scale (95/120).
    expect(c.points[2].kw).toBeCloseTo(120 * (95 / 120), 0);
  });
});

describe('planner', () => {
  it('needs no stop when the charge covers the trip', () => {
    const r = plan(input({ route: flatRoute(100) }));
    expect(r.feasible).toBe(true);
    expect(r.stops).toHaveLength(0);
    expect(r.note).toBe('No charging stop needed.');
    expect(r.arriveSoc).toBeGreaterThan(15);
  });

  it('plans stops that keep every arrival above the minimum, never charging past 90%', () => {
    const r = plan(input());
    expect(r.feasible).toBe(true);
    expect(r.stops.length).toBeGreaterThanOrEqual(1);
    for (const s of r.stops) {
      expect(s.arriveSoc).toBeGreaterThanOrEqual(15);
      expect(s.departSoc).toBeLessThanOrEqual(MAX_CHARGE);
      expect(s.departSoc).toBeGreaterThan(s.arriveSoc);
      expect(Date.parse(s.departAt)).toBeGreaterThan(Date.parse(s.arriveAt));
    }
    expect(r.arriveSoc).toBeGreaterThanOrEqual(15);
    expect(r.chargeMin).toBeGreaterThan(0);
    expect(r.totalMin).toBeCloseTo(r.driveMin + r.chargeMin + r.stops.length * STOP_OVERHEAD_MIN, -1);
  });

  it('gives each stop a backup that is a different charger', () => {
    const r = plan(input());
    for (const s of r.stops) {
      expect(s.backup).not.toBeNull();
      expect(s.backup!.id).not.toBe(s.id);
      expect(s.backup!.extraMin).toBeGreaterThanOrEqual(0);
    }
  });

  it('avoids a full or ruled-out charger', () => {
    const base = plan(input());
    const first = base.stops[0].id;
    const r = plan(input({ avoid: new Set([first]) }));
    expect(r.feasible).toBe(true);
    expect(r.stops.map((s) => s.id)).not.toContain(first);
  });

  it('says where the gap is when no chain of chargers reaches', () => {
    const r = plan(input({ startSoc: 50, candidates: [charger('far', 280)] }));
    expect(r.feasible).toBe(false);
    expect(r.note).toMatch(/No charger in reach between mile 0 and mile 280/);
  });

  it('prefers a stop at a fast, well-scored site over a slow one', () => {
    const slow = charger('slow', 120, { maxKw: 50 });
    const fast = charger('fast', 125);
    const r = plan(input({ route: flatRoute(250), candidates: [slow, fast] }));
    expect(r.stops.map((s) => s.id)).toEqual(['fast']);
  });

  it('penalises a site that was slow before, and one that is full now', () => {
    expect(sitePenalty({ ...charger('a', 1), perfRatio: 0.5 })).toBeGreaterThan(sitePenalty(charger('b', 1)));
    expect(sitePenalty(charger('c', 1, { availability: { available: 0, total: 8, outOfService: 0, updatedAt: null } }))).toBeGreaterThan(20);
  });

  it('counts climbs, heat and speed', () => {
    const flat = flatRoute(100);
    const hilly: Route = { ...flat, elevation: true, points: flat.points.map((p) => ({ ...p, elevM: p.mi * 20 })) };   // 2,000 m climb
    const base = { packKwh: 52.7, effMiPerKwh: 3.5 };
    const e0 = energyModel({ ...base, route: flat, tempF: 75 }).kwh(0, 100);
    expect(energyModel({ ...base, route: hilly, tempF: 75 }).kwh(0, 100)).toBeGreaterThan(e0 + 8);
    expect(energyModel({ ...base, route: flat, tempF: 110 }).kwh(0, 100)).toBeGreaterThan(e0);
    expect(energyModel({ ...base, route: { ...flat, minutes: 80 }, tempF: 75 }).kwh(0, 100)).toBeGreaterThan(e0);   // 75 mph
  });
});

describe('route geometry', () => {
  it('locates a point along and off the route', () => {
    const r = flatRoute(100);
    const at = locate(r, { lat: 33.05, lon: -112 + 50 / 53.3 });
    expect(at.mi).toBeCloseTo(50, 0);
    expect(at.offMi).toBeCloseTo(3.45, 1);
  });

  it('falls back to a straight line plus 25% when the router fails', async () => {
    const r = await fetchRoute({ lat: 33.45, lon: -112.07 }, { lat: 35.2, lon: -111.65 }, { fetchFn: (async () => { throw new Error('offline'); }) as typeof fetch });
    expect(r.source).toBe('straight');
    expect(r.miles).toBeGreaterThan(150);
  });

  it('reads an OSRM answer (the demo router)', async () => {
    const f = (async (u: string | URL) => osrmAnswer(new URL(String(u)))) as typeof fetch;
    const r = await fetchRoute({ lat: 33.45, lon: -112.07 }, { lat: 35.1983, lon: -111.6513 }, { fetchFn: f });
    expect(r.source).toBe('osrm');
    expect(r.miles).toBeGreaterThan(130);
    expect(r.miles).toBeLessThan(170);
    expect(r.points.at(-1)!.mi).toBeCloseTo(r.miles, 0);
  });
});

describe('charging samples', () => {
  it('turns a rise in charge level into kW, ignoring noise and gaps', () => {
    expect(rateKw(30, 32, 60_000, 52.7)).toBeCloseTo(63.2, 1);
    expect(rateKw(30, 32, 5_000, 52.7)).toBeNull();
    expect(rateKw(30, 32, 3600_000, 52.7)).toBeNull();
    expect(rateKw(32, 30, 60_000, 52.7)).toBeNull();
  });

  it('remembers a slow site', () => {
    const c = genericCurve(120);
    const row = (kw: number): SampleRow => ({ at: '2027-06-01T10:00:00Z', socFrom: 30, socTo: 32, kw, stationKw: 150, lat: 33.1, lon: -112.1, sessionId: 1, simulated: false });
    expect(sitePerformance([row(50), row(55)], 33.1, -112.1, c)).toBeNull();
    const p = sitePerformance([row(50), row(55), row(60)], 33.1001, -112.1001, c)!;
    expect(p.ratio).toBeLessThan(0.7);
    expect(p.kwSeen).toBe(55);
    expect(sitePerformance([row(50), row(55), row(60)], 34, -112.1, c)).toBeNull();
  });

  it('stores samples and learns from them', () => {
    const s = new SampleStore(tmpDb());
    for (let i = 0; i < 4; i++) s.add({ at: new Date(Date.now() - i * 60_000).toISOString(), socFrom: 40, socTo: 42, kw: 100, stationKw: null, lat: null, lon: null, sessionId: 7 });
    expect(s.curve(Date.now() + 120_000).points[8]).toMatchObject({ kw: 100, learned: true });
    expect(s.forSession(7)).toHaveLength(4);
  });
});

describe('coach', () => {
  const c = genericCurve(120);
  const base = { samples: [] as SampleRow[], stationKw: 150, curve: c, packKwh: 52.7, effMiPerKwh: 3.5, next: { name: 'Blythe', needSoc: 60 }, now: Date.parse('2027-06-01T10:10:00Z') };
  const sample = (kw: number, mins: number): SampleRow => ({ at: new Date(base.now - mins * 60_000).toISOString(), socFrom: 30, socTo: 32, kw, stationKw: 150, lat: null, lon: null, sessionId: 1, simulated: false });

  it('counts down to the planned level', () => {
    const r = coach({ ...base, soc: 30, targetSoc: 60 });
    expect(r.state).toBe('charging');
    expect(r.minutesLeft).toBeGreaterThan(5);
    expect(r.message).toMatch(/Charge to 60%, about \d+ min left/);
  });

  it('says GO at the target, and what staying is worth', () => {
    const r = coach({ ...base, soc: 61, targetSoc: 60 });
    expect(r.state).toBe('go');
    expect(r.message).toBe('GO: enough for Blythe');
    expect(r.detail).toMatch(/per 10 minutes/);
  });

  it('flags a slow stall on two slow readings', () => {
    expect(coach({ ...base, soc: 32, targetSoc: 60, samples: [sample(40, 2)] }).state).toBe('charging');
    const r = coach({ ...base, soc: 32, targetSoc: 60, samples: [sample(40, 3), sample(42, 1)] });
    expect(r.state).toBe('slow');
    expect(r.message).toMatch(/This stall is slow: 41 kW/);
  });

  it('does not blame the stall for the taper past 80%', () => {
    const r = coach({ ...base, soc: 85, targetSoc: 90, samples: [sample(20, 2), sample(20, 1)].map((s) => ({ ...s, socFrom: 84, socTo: 85 })) });
    expect(r.state).toBe('charging');
  });
});

describe('road trip service', () => {
  function setup() {
    const db = tmpDb();
    const settings: FinderSettings = { ...defaultSettings(), charging: { ...defaultCharging(), arriveMinSoc: 15 } };
    // Chargers every 40 miles along I-10 west of Phoenix (the demo router's highway).
    const stations = [40, 80, 120, 160, 200, 240, 280, 320].map((m, i) => ({ id: `s${i}`, source: 'ocm' as const, name: `Stop ${m}`, network: 'Net', lat: 33.45 + (i % 2 ? 0.02 : -0.02) * 0.1, lon: -112.07 - m / 60, maxKw: 150, connectors: ['CCS'], amenities: ['food'], price: null }));
    const finder = {
      stationsAround: async (lat: number, lon: number) => ({ stations: stations.filter((s) => Math.abs(s.lon - lon) < 0.5 && Math.abs(s.lat - lat) < 0.5), error: null }),
      liveAround: async () => [],
      nearestKnown: () => null,
    } as unknown as ChargerFinder;
    const fetchFn = (async (u: string | URL) => {
      const url = new URL(String(u));
      if (url.hostname === 'router.project-osrm.org') {
        const m = url.pathname.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
        const a = { lat: Number(m[2]), lon: Number(m[1]) }, b = { lat: Number(m[4]), lon: Number(m[3]) };
        const n = 200;
        const coords = Array.from({ length: n + 1 }, (_, i) => [a.lon + (b.lon - a.lon) * i / n, a.lat + (b.lat - a.lat) * i / n]);
        return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 330 * 1609.34, duration: 330 / 65 * 3600, geometry: { coordinates: coords } }] }));
      }
      return new Response('nope', { status: 500 });   // elevation: unavailable
    }) as typeof fetch;
    let soc: number | null = 80;
    let gps = { lat: 33.45, lon: -112.07 };
    const svc = new RoadTripService({
      db, finder, samples: new SampleStore(db), settings: () => settings, soc: () => soc, gps: () => gps,
      speedMph: () => 0, charging: () => false, tempF: () => 90, highwayEff: () => 3.4, sessionId: () => null, fetchFn,
    });
    return { svc, setSoc: (v: number | null) => { soc = v; }, setGps: (p: { lat: number; lon: number }) => { gps = p; } };
  }

  it('does not "arrive" when the truck is parked at the destination before driving the route', async () => {
    const { svc, setGps } = setup();
    const p = await svc.planTrip({ to: { lat: 33.45, lon: -117.6, name: 'West' } });
    svc.start(p.id);
    setGps({ lat: 33.45, lon: -117.6 });    // parked at the end, never drove it
    await svc.tick();
    expect(svc.view().active).not.toBeNull();
    setGps({ lat: 40, lon: -100 });          // far off the route: nothing passes or arrives
    await svc.tick();
    expect(svc.view().active).not.toBeNull();
    expect(svc.view().progress?.nextStop).toBe(0);
  });

  it('plans a trip from GPS and the charge level, with warnings for what it could not get', async () => {
    const { svc } = setup();
    const p = await svc.planTrip({ to: { lat: 33.45, lon: -117.6, name: 'West' } });
    expect(p.routeMiles).toBe(330);
    expect(p.warnings.join(' ')).toMatch(/elevation/i);
    expect(p.result.feasible).toBe(true);
    expect(p.result.stops.length).toBeGreaterThanOrEqual(1);
    expect(svc.view().draft?.id).toBe(p.id);
  });

  it('starts, replans from where the truck is, and stops', async () => {
    const { svc, setSoc } = setup();
    const p = await svc.planTrip({ to: { lat: 33.45, lon: -117.6, name: 'West' } });
    svc.start(p.id);
    expect(svc.view().active?.to.name).toBe('West');
    expect(svc.brief()?.nextStop).not.toBeNull();
    setSoc(60);
    const r = svc.replan('test');
    expect(r?.startSoc).toBe(60);
    expect(svc.view().alerts[0].message).toBe('test');
    svc.stop();
    expect(svc.view().active).toBeNull();
  });

  it('refuses without a charge level', async () => {
    const { svc, setSoc } = setup();
    setSoc(null);
    await expect(svc.planTrip({ to: { lat: 33.45, lon: -117.6 } })).rejects.toThrow(/Charge level unknown/);
  });
});

describe('trip costs', () => {
  it('reads a per-kWh price from the site text, not per-minute ones', async () => {
    const { listedPerKwh } = await import('../src/roadtrip/planner.ts');
    expect(listedPerKwh('$0.56/kWh')).toBe(0.56);
    expect(listedPerKwh('0.48 per kWh')).toBe(0.48);
    expect(listedPerKwh('$0.32/min')).toBeNull();
    expect(listedPerKwh(null)).toBeNull();
  });

  it('prices a stop from what you paid, else the listing, else a typical price', async () => {
    const { priceStop, TYPICAL_DC_PER_KWH } = await import('../src/roadtrip/planner.ts');
    const base = charger('x', 1).charger;
    expect(priceStop({ ...base, price: '$0.50/kWh', lastPaid: { sessionId: 1, at: '', cost: 20, kwh: 50, perKwh: 0.4, sessions: 1 } }, 30)).toMatchObject({ pricePerKwh: 0.4, priceSource: 'paid', cost: 12 });
    expect(priceStop({ ...base, price: '$0.50/kWh' }, 30)).toMatchObject({ priceSource: 'listed', cost: 15 });
    expect(priceStop(base, 10)).toMatchObject({ priceSource: 'typical', pricePerKwh: TYPICAL_DC_PER_KWH });
  });

  it('totals the trip', () => {
    const r = plan(input({ candidates: [60, 100, 140, 180, 220, 260].map((m) => charger(`c${m}`, m, { price: '$0.50/kWh' })) }));
    expect(r.chargeCost).toBeCloseTo(r.stops.reduce((a, s) => a + s.cost, 0), 1);
    expect(r.chargeCost).toBeGreaterThan(0);
    expect(r.typicalPriceStops).toBe(0);
  });
});

describe('layout upgrade', () => {
  it('adds the Road trip screen after Charge once, and respects removing it', async () => {
    const { migrateRoadTripLayout } = await import('../src/layout.ts');
    const old = { views: [{ id: 'drive', label: 'Drive', widgets: [] }, { id: 'charge', label: 'Charge', widgets: [] }, { id: 'trips', label: 'Trips', widgets: [] }] };
    const up = migrateRoadTripLayout(old);
    expect(up.views.map((v) => v.id)).toEqual(['drive', 'charge', 'roadtrip', 'trips']);
    expect(up.roadTripAdded).toBe(true);
    const removed = { ...up, views: up.views.filter((v) => v.id !== 'roadtrip') };
    expect(migrateRoadTripLayout(removed).views.map((v) => v.id)).toEqual(['drive', 'charge', 'trips']);
  });
});

describe('stops along the way', () => {
  it('plans each leg, waits the stay, and counts charging there', async () => {
    const { planLegs } = await import('../src/roadtrip/planner.ts');
    const base = input({ startSoc: 80 });
    const noCharge = planLegs(base, [{ name: 'Lunch', lat: 33, lon: -112 + 120 / 53.3, placeId: null, kind: 'restaurant', stayMin: 60, chargeKw: null, routeMi: 120 }]);
    expect(noCharge.result.feasible).toBe(true);
    expect(noCharge.via).toHaveLength(1);
    const lunch = noCharge.via[0];
    expect(lunch.departSoc).toBe(lunch.arriveSoc);
    expect(Date.parse(lunch.departAt) - Date.parse(lunch.arriveAt)).toBe(60 * 60_000);
    // A friend's house with a 7.2 kW charger and a night's stay: leaves nearly full, needs fewer fast stops.
    const friend = planLegs(base, [{ name: 'Sam’s', lat: 33, lon: -112 + 120 / 53.3, placeId: 3, kind: 'friend', stayMin: 600, chargeKw: 7.2, routeMi: 120 }]);
    expect(friend.via[0].departSoc).toBe(90);
    expect(friend.result.chargeMin).toBeLessThan(noCharge.result.chargeMin);
    expect(friend.result.totalMin).toBeGreaterThan(600);
  });

  it('says which leg cannot be done', async () => {
    const { planLegs } = await import('../src/roadtrip/planner.ts');
    const r = planLegs(input({ startSoc: 30, candidates: [] }), [{ name: 'Far café', lat: 0, lon: 0, placeId: null, kind: 'restaurant', stayMin: 30, chargeKw: null, routeMi: 200 }]);
    expect(r.result.feasible).toBe(false);
    expect(r.result.note).toMatch(/^On the way to Far café: /);
  });
});

describe('a charger beside a stop', () => {
  it('can be used on the leg that starts at the stop', async () => {
    const { planLegs } = await import('../src/roadtrip/planner.ts');
    // Lunch at mile 100; the only charger is beside the diner, a hair past it on the route (out of the first leg).
    const r = planLegs(input({ startSoc: 75, candidates: [charger('beside', 100.3), charger('later', 200)] }), [{ name: 'Diner', lat: 33, lon: -112 + 100 / 53.3, placeId: null, kind: 'restaurant', stayMin: 45, chargeKw: null, routeMi: 100 }]);
    expect(r.result.feasible).toBe(true);
    expect(r.result.stops[0].id).toBe('beside');
    expect(Date.parse(r.result.stops[0].arriveAt)).toBeGreaterThanOrEqual(Date.parse(r.via[0].departAt));
  });
});
