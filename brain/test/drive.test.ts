import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, effectiveMode, ewma, LEARN_WINDOW_MI, rangeFor, RangeModel, rollingAvg } from '../src/drive/range.ts';
import { lastEndedCharge, sinceCharge } from '../src/drive/sinceCharge.ts';
import { briefOf, compass, needsRefresh, nwsIcon, parseNwsAlerts, parseNwsHighLow, parseNwsHourly, parseNwsObservation, parseNwsPoint, parseNwsWind, parseOpenMeteo, textIcon, wmo } from '../src/drive/weather.ts';
import { limitOn, matchWay, parseMaxspeed, parseOverpass } from '../src/drive/maxspeed.ts';
import { bigTargets, lockStep, UNLOCK_MS } from '../src/drive/lockout.ts';
import { heatLevel, parkedInSun, parseThermalZone, parseVcgencmd } from '../src/drive/heat.ts';
import { luxToPct, smoothLux, targetPct } from '../src/drive/brightness.ts';
import { defaultDrive, defaultTruck, migrateDriveLayout, validateDrive, validateDriverDrive, validateTruck } from '../src/drive/settings.ts';
import { DEFAULT_LAYOUT } from '../src/layout.ts';
import { loadSettings, migrateSettings } from '../src/settings.ts';
import { tripGallons } from '../src/charges/summary.ts';
import type { ChargeSession } from '../src/types.ts';

const fx = (n: string) => JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n), 'utf8'));

describe('city / highway classifier', () => {
  it('time-weights the last two minutes', () => {
    const now = 200_000;
    const s = Array.from({ length: 120 }, (_, i) => ({ t: 80_000 + i * 1000, mph: i < 60 ? 30 : 60 }));
    expect(rollingAvg(s, now)).toBeCloseTo(45, 0);
    expect(classify(rollingAvg(s, now), 45)).toBe('highway');
    expect(classify(44.9, 45)).toBe('city');
  });
  it('needs a quarter of the window before it answers; null is city', () => {
    expect(rollingAvg([{ t: 0, mph: 70 }, { t: 1000, mph: 70 }], 20_000)).toBeNull();
    expect(classify(null, 45)).toBe('city');
  });
  it('does not stretch a sample across a long gap', () => {
    const s = [{ t: 0, mph: 70 }, ...Array.from({ length: 60 }, (_, i) => ({ t: 60_000 + i * 1000, mph: 20 }))];
    expect(rollingAvg(s, 120_000)).toBeCloseTo((70 * 10 + 20 * 60) / 70, 0);
  });
  it('manual override wins', () => {
    expect(effectiveMode('city', 'highway')).toBe('highway');
    expect(effectiveMode('highway', 'auto')).toBe('highway');
  });
  it('the model drops samples older than the window', () => {
    const m = new RangeModel({ city: 4, highway: 3.2 });
    for (let i = 0; i < 400; i++) m.addSample(i * 1000, 50);
    expect(m.samples.length).toBeLessThan(140);
    expect(m.mode(400_000, 45)).toBe('highway');
  });
});

describe('EWMA efficiency', () => {
  it('moves toward the sample by alpha, scaled by the window weight', () => {
    expect(ewma(4, 3, 0.2)).toBeCloseTo(3.8);
    expect(ewma(4, 3, 0.2, 0.5)).toBeCloseTo(3.9);
    expect(ewma(4, 3, 5)).toBe(3);
  });
  it('learns only from real SoC readings and plausible windows', () => {
    const m = new RangeModel({ city: 4, highway: 3.2 });
    // estimate SoC: nothing learned
    expect(m.addMiles('city', 3, { value: 80, real: false }, 50, 0.2)).toBe(false);
    expect(m.addMiles('highway', 1, { value: 80, real: true }, 50, 0.2)).toBe(false);
    // 2 highway miles used 1.2% of 50 kWh = 0.6 kWh -> 3.33 mi/kWh
    expect(m.addMiles('highway', LEARN_WINDOW_MI - 1, { value: 78.8, real: true }, 50, 0.2)).toBe(true);
    expect(m.eff('highway')).toBeCloseTo(3.2 + 0.2 * (2 / 0.6 - 3.2), 2);
    expect(m.stats.highway.learnedMiles).toBe(2);
    expect(m.eff('city')).toBe(4);
    // a jump in SoC (charging) is not plausible
    expect(m.addMiles('highway', 2, { value: 95, real: true }, 50, 0.2)).toBe(false);
  });
  it('reseeds a mode only until it has learned', () => {
    const m = new RangeModel({ city: 4, highway: 3.2 }, { city: { eff: 4.4, learnedMiles: 10 }, highway: { eff: 3, learnedMiles: 0 }, override: 'city' });
    m.reseed({ city: 5, highway: 2.9 });
    expect(m.eff('city')).toBe(4.4);
    expect(m.eff('highway')).toBe(2.9);
    expect(m.override).toBe('city');
  });
  it('range per mode', () => {
    expect(rangeFor(50, 52.7, 4)).toBe(105);
    expect(rangeFor(null, 52.7, 4)).toBeNull();
  });
});

describe('gas comparison uses the split', () => {
  it('city miles at city mpg, highway at highway mpg', () => {
    const v = { mpgCity: 20, mpgHighway: 30, mpgCombined: 24 };
    expect(tripGallons({ startedAt: '', miles: 50, cityMiles: 20, highwayMiles: 30 }, v)).toBeCloseTo(2);
  });
});

const session = (p: Partial<ChargeSession>): ChargeSession => ({
  id: 1, startedAt: '2027-05-01T08:00:00Z', endedAt: '2027-05-01T10:00:00Z', place: 'public', network: null, stationName: null, lat: null, lon: null,
  kwh: 40, cost: 16, costSource: 'receipt', startSoc: 20, endSoc: 90, maxKw: null, note: null, source: 'manual', driverId: 'jeff', simulated: false, ...p,
});

describe('since last charge', () => {
  const trips = [
    { startedAt: '2027-05-01T09:00:00Z', endedAt: '2027-05-01T09:30:00Z', miles: 50, cityMiles: null, highwayMiles: null },  // before the charge ended
    { startedAt: '2027-05-01T11:00:00Z', endedAt: '2027-05-01T12:00:00Z', miles: 30, cityMiles: 10, highwayMiles: 20 },
    { startedAt: '2027-05-02T08:00:00Z', endedAt: null, miles: 10, cityMiles: 10, highwayMiles: 0 },
  ];
  it('picks the most recently ended session', () => {
    expect(lastEndedCharge([session({ id: 1 }), session({ id: 2, endedAt: '2027-05-03T00:00:00Z' }), session({ id: 3, endedAt: null })])?.id).toBe(2);
  });
  it('uses the SoC drop when the reading is real (CAN) and believable', () => {
    const r = sinceCharge(session({}), trips, { soc: 70, socReal: true, packKwh: 50, eff: { city: 4, highway: 3.2 } });
    expect(r.miles).toBe(40);
    expect(r.pctUsed).toBe(20);
    expect(r.kwh).toBe(10);
    expect(r.kwhSource).toBe('soc');
    expect(r.miPerKwh).toBe(4);
    expect(r.costPerMile).toBeCloseTo((16 / 40) * 10 / 40, 3); // $0.40/kWh x 10 kWh / 40 mi
  });
  it('falls back to miles / per-mode efficiency for an estimated or implausible SoC', () => {
    for (const now of [{ soc: 70, socReal: false }, { soc: 5, socReal: true }]) {
      const r = sinceCharge(session({ cost: null }), trips, { ...now, packKwh: 50, eff: { city: 4, highway: 3.2 } });
      expect(r.kwhSource).toBe('miles');
      expect(r.kwh).toBe(11.3); // 20 city mi / 4 + 20 highway mi / 3.2, to 0.1
      expect(r.pctUsed).toBeCloseTo(22.5, 1); // as a share of the 50 kWh pack
      expect(r.costPerMile).toBeNull();
    }
  });
  it('zero miles is zero, not NaN', () => {
    const r = sinceCharge(session({ endSoc: null }), [], { soc: null, socReal: false, packKwh: 50, eff: { city: 4, highway: 3.2 } });
    expect(r).toMatchObject({ miles: 0, kwh: 0, miPerKwh: null, costPerMile: null, pctUsed: 0 });
  });
});

describe('weather: NWS', () => {
  const now = new Date('2026-11-05T20:30:00Z');
  it('parses the point lookup', () => {
    expect(parseNwsPoint(fx('nws-points.json'))).toMatchObject({ city: 'Phoenix', state: 'AZ', forecastHourly: expect.stringContaining('/forecast/hourly') });
    expect(parseNwsPoint({})).toBeNull();
  });
  it('hourly: from now, 12 hours, icons and wind', () => {
    const h = parseNwsHourly(fx('nws-hourly.json'), now);
    expect(h).toHaveLength(12);
    expect(Date.parse(h[0].t)).toBeLessThanOrEqual(now.getTime());
    expect(h[0]).toMatchObject({ icon: 'few', condition: 'Sunny', isDay: true });
    expect(typeof h[0].tempF).toBe('number');
    expect(h[0].windMph).toBeGreaterThanOrEqual(0);
  });
  it('high and low from the 12-hour forecast', () => {
    expect(parseNwsHighLow(fx('nws-forecast.json'))).toEqual({ highF: 78, lowF: 57 });
  });
  it('observation: °C and km/h to °F and mph', () => {
    const o = parseNwsObservation(fx('nws-obs.json'))!;
    expect(o.tempF).toBe(75); // 24 °C
    expect(o.windMph).toBe(3); // 5.544 km/h
    expect(o.windDir).toBe('ESE');
    expect(o.condition).toBe('Mostly Clear');
  });
  it('alerts: polygons flipped to [lat, lon], zone-wide ones kept without one', () => {
    const a = parseNwsAlerts(fx('nws-alerts.json'), new Date('2026-11-05T12:00:00Z'));
    expect(a.length).toBe(2);
    const poly = a.find((x) => x.polygon)!;
    expect(poly.polygon![0][0][0]).toBeGreaterThan(30); // lat first
    expect(poly.polygon![0][0][1]).toBeLessThan(-100);
    expect(a.some((x) => x.polygon === null)).toBe(true);
    expect(parseNwsAlerts(fx('nws-alerts.json'), new Date('2030-01-01T00:00:00Z'))).toEqual([]);
  });
  it('wind strings, compass and icons', () => {
    expect(parseNwsWind('5 to 10 mph')).toBe(10);
    expect(parseNwsWind('0 mph')).toBe(0);
    expect(parseNwsWind('')).toBeNull();
    expect(compass(0)).toBe('N'); expect(compass(350)).toBe('N'); expect(compass(225)).toBe('SW');
    expect(nwsIcon('https://api.weather.gov/icons/land/night/tsra,40?size=small', '')).toEqual({ icon: 'storm', isDay: false });
    expect(nwsIcon('https://api.weather.gov/icons/land/day/dust?size=small', '').icon).toBe('dust');
    expect(textIcon('Blowing Dust')).toBe('dust');
    expect(textIcon('Partly Cloudy')).toBe('partly');
    expect(textIcon('Chance Showers And Thunderstorms')).toBe('storm');
  });
});

describe('weather: Open-Meteo fallback', () => {
  it('converts local wall-clock times with the offset', () => {
    const r = parseOpenMeteo(fx('openmeteo.json'), new Date('2026-11-05T20:30:00Z'))!;
    expect(r.current.tempF).toBe(78);
    expect(r.current.icon).toBe('clear');
    expect(r.current.observedAt).toBe('2026-11-05T20:30:00.000Z'); // 13:30 at UTC-7
    expect(r.hourly).toHaveLength(12);
    expect(r.hourly[0].t).toBe('2026-11-05T20:00:00.000Z');
    expect(typeof r.today.highF).toBe('number');
    expect(wmo(95).icon).toBe('storm');
    expect(parseOpenMeteo({}, new Date())).toBeNull();
  });
});

describe('weather refresh rules and brief', () => {
  const p = { lat: 33.45, lon: -112.07 };
  it('15 minutes, 10 km, or nothing yet; never offline', () => {
    expect(needsRefresh(null, p, 0, true)).toBe(true);
    expect(needsRefresh(null, p, 0, false)).toBe(false);
    expect(needsRefresh({ at: 0, ...p }, p, 14 * 60_000, true)).toBe(false);
    expect(needsRefresh({ at: 0, ...p }, p, 15 * 60_000, true)).toBe(true);
    expect(needsRefresh({ at: 0, ...p }, { lat: 33.55, lon: -112.07 }, 60_000, true)).toBe(true); // ~11 km
  });
  it('marks a 45-minute-old report stale and drops expired alerts', () => {
    const r = { source: 'nws' as const, fetchedAt: '2026-11-05T12:00:00Z', lat: 0, lon: 0, place: 'Phoenix, AZ', current: { tempF: 80, condition: 'Sunny', icon: 'clear' as const, isDay: true, windMph: 5, windDir: 'N', observedAt: null }, today: { highF: 90, lowF: 60 }, hourly: [], sun: { rise: null, set: null },
      alerts: [{ id: 'a', event: 'Heat', headline: null, severity: 'Severe' as const, onset: null, expires: '2026-11-05T12:30:00Z', polygon: null }] };
    const b = briefOf(r, Date.parse('2026-11-05T13:00:00Z'));
    expect(b.stale).toBe(true);
    expect(b.alerts).toEqual([]);
    expect(briefOf(r, Date.parse('2026-11-05T12:10:00Z')).alerts).toHaveLength(1);
  });
});

describe('speed limits (OSM maxspeed)', () => {
  it('parses units', () => {
    expect(parseMaxspeed('35 mph')).toBe(35);
    expect(parseMaxspeed('35mph')).toBe(35);
    expect(parseMaxspeed('50')).toBe(31);       // bare number = km/h
    expect(parseMaxspeed('100 km/h')).toBe(62);
    expect(parseMaxspeed('10 knots')).toBe(12);
    expect(parseMaxspeed('50;30')).toBe(31);
    for (const x of ['none', 'walk', 'signals', 'US:urban', 'RU:rural', '', 'fast', undefined, null]) expect(parseMaxspeed(x)).toBeNull();
  });
  it('matches the way the truck is on, by distance and heading', () => {
    const ways = parseOverpass(fx('overpass.json'));
    expect(ways.length).toBe(3);
    // on the east-west fixture road heading east
    const m = matchWay({ lat: 33.49401, lon: -111.9600 }, 90, ways)!;
    expect(m.way.name).toBe('Test Road (fixture)');
    expect(limitOn(m.way, m.forward)).toEqual({ mph: 35, raw: '35 mph' });
    // same spot heading north: the north-south metric street crosses here
    const n = matchWay({ lat: 33.49401, lon: -111.96001 }, 0, ways)!;
    expect(n.way.name).toBe('Metric Street (fixture)');
    expect(limitOn(n.way, n.forward).mph).toBe(31);
    // nowhere near a road
    expect(matchWay({ lat: 34, lon: -111 }, 0, ways)).toBeNull();
  });
});

describe('driving lockouts', () => {
  it('locks over the threshold and unlocks after a slow spell', () => {
    let s = lockStep({ locked: false, slowSince: null }, 4, 0, 5);
    expect(s.locked).toBe(false);
    s = lockStep(s, 6, 1000, 5); expect(s.locked).toBe(true);
    s = lockStep(s, 0, 2000, 5); expect(s.locked).toBe(true);
    s = lockStep(s, 0, 2000 + UNLOCK_MS - 1, 5); expect(s.locked).toBe(true);
    s = lockStep(s, 12, 2000 + UNLOCK_MS - 1, 5); expect(s).toEqual({ locked: true, slowSince: null }); // moving again resets the clock
    s = lockStep(s, 0, 10_000, 5); s = lockStep(s, 0, 10_000 + UNLOCK_MS, 5); expect(s.locked).toBe(false);
  });
  it('keeps the lock when speed is unknown', () => {
    expect(lockStep({ locked: true, slowSince: null }, null, 0, 5).locked).toBe(true);
  });
  it('big targets at speed', () => {
    expect(bigTargets(30)).toBe(true); expect(bigTargets(10)).toBe(false); expect(bigTargets(null)).toBe(false);
  });
});

describe('heat and brightness', () => {
  const t = { throttleC: 75, warnC: 80, shutdownC: 85 };
  it('levels', () => {
    expect(heatLevel(null, t)).toBe('ok');
    expect(heatLevel(76, t)).toBe('throttle');
    expect(heatLevel(82, t)).toBe('warn');
    expect(heatLevel(85, t)).toBe('shutdown');
    expect(parkedInSun({ parked: true, daytime: true, cabinF: 120, limitF: 110 })).toBe(true);
    expect(parkedInSun({ parked: false, daytime: true, cabinF: 120, limitF: 110 })).toBe(false);
    expect(parseVcgencmd("temp=48.3'C\n")).toBe(48.3);
    expect(parseThermalZone('52345\n')).toBe(52.3);
  });
  it('lux curve, night cap, manual', () => {
    expect(luxToPct(1, 10, 100)).toBe(10);
    expect(luxToPct(10_000, 10, 100)).toBe(100);
    expect(luxToPct(100, 10, 100)).toBe(55);
    const b = { auto: true, manualPct: 70, minPct: 10, maxPct: 100, nightMaxPct: 40 };
    expect(targetPct({ ...b, lux: 10_000, night: true })).toBe(40);
    expect(targetPct({ ...b, lux: null, night: false })).toBe(70);
    expect(targetPct({ ...b, auto: false, lux: 10_000, night: true })).toBe(70);
    expect(smoothLux(null, 500)).toBe(500);
    expect(smoothLux(10, 1000)).toBeLessThan(1000);
  });
});

describe('drive settings', () => {
  it('defaults are Jeff\'s truck and validate', () => {
    expect(validateTruck(undefined)).toEqual(defaultTruck());
    expect(validateDrive(undefined)).toEqual(defaultDrive());
    expect(defaultTruck().accessories).toEqual({ tonneau: 'nexus-flip', hitch: true, bedLights: true });
  });
  it('rejects bad values', () => {
    expect(() => validateTruck({ colors: { body: 'red' } })).toThrow(/#rrggbb/);
    expect(validateTruck({ colors: { lampPlates: 'synthwave' } }).colors.lampPlates).toBe('synthwave');
    expect(() => validateDrive({ tilt: { warnDeg: 30, dangerDeg: 20 } })).toThrow(/dangerDeg/);
    expect(() => validateDriverDrive({ speedo: 'steam' })).toThrow(/speedo/);
    expect(validateDriverDrive({ speedo: 'fifty-seven', overLimitWarn: true })).toEqual({ speedo: 'fifty-seven', overLimitWarn: true, overLimitMph: 5 });
  });
});

describe('drive layout migration', () => {
  const legacy = { views: [{ id: 'drive', label: 'Drive', widgets: ['speed', 'soc', 'nowPlaying', 'nextCharger', 'trip', 'cabin', 'aux12v', 'tilt'].map((type, i) => ({ type, col: i + 1, row: 1, w: 1, h: 1 })) }, ...DEFAULT_LAYOUT.views.slice(1)] };
  it('moves the old default Drive view to the new screen, keeps custom ones', () => {
    expect(migrateDriveLayout(legacy).views[0].widgets.map((w) => w.type)).toEqual(['drive']);
    const custom = { views: [{ id: 'drive', label: 'Mine', widgets: [{ type: 'speed', col: 1, row: 1, w: 6, h: 2 }] }] };
    expect(migrateDriveLayout(custom)).toEqual(custom);
    expect(DEFAULT_LAYOUT.views[0].widgets.map((w) => w.type)).toEqual(['drive']);
  });
  it('also moves the first default (before Now playing joined it)', () => {
    const first = { views: [{ id: 'drive', label: 'Drive', widgets: [['speed', 1, 4, 2], ['soc', 5, 3, 2], ['nextCharger', 8, 5, 1], ['trip', 8, 2, 1], ['cabin', 10, 1, 1], ['aux12v', 11, 1, 1], ['tilt', 12, 1, 1]].map(([type, col, w, h], i) => ({ type: type as string, col: col as number, row: i < 3 ? 1 : 2, w: w as number, h: h as number })) }] };
    expect(migrateDriveLayout(first).views[0].widgets.map((w) => w.type)).toEqual(['drive']);
    const s = loadSettings(migrateSettings({ drivers: [{ id: 'jeff', name: 'Jeff', color: '#4fc3d9', layout: first }] }));
    expect(s.drivers[0].layout.views[0].widgets.map((w) => w.type)).toEqual(['drive']);
  });
  it('an old settings file gets truck, drive and per-driver drive defaults', () => {
    const s = loadSettings(migrateSettings({ drivers: [{ id: 'jeff', name: 'Jeff', color: '#4fc3d9', layout: legacy }] }));
    expect(s.truck.colors.lampPlates).toBe('synthwave');
    expect(s.drive.highwayMph).toBe(45);
    expect(s.drivers[0].drive.speedo).toBe('auto');
    expect(s.drivers[0].layout.views[0].widgets[0].type).toBe('drive');
  });
  it('a shorter window (SIM_SPEEDUP) classifies on its own scale', () => {
    const m = new RangeModel({ city: 4, highway: 3.2 }, null, 20_000);
    for (let i = 0; i <= 20; i++) m.addSample(i * 1000, 60);
    expect(m.mode(20_000, 45)).toBe('highway');
  });
});
