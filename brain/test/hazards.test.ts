import { describe, expect, it } from 'vitest';
import { firesNearRoute, firmsUrl, forecastUrl, parseAlerts, parseFirms, parseForecast, pointsAhead } from '../src/hazards/route.ts';
import { HazardService } from '../src/hazards/service.ts';
import { withMiles, type Route } from '../src/roadtrip/route.ts';

/** 200 miles due north from Phoenix at 60 mph. */
const route: Route = (() => { const pts = Array.from({ length: 201 }, (_, i) => ({ lat: 33.45 + i / 69, lon: -112.07 })); const r = withMiles(pts); const k = 200 / r.at(-1)!.mi; for (const p of r) p.mi *= k; return { points: r, miles: 200, minutes: 200, source: 'osrm', elevation: false }; })();
const NOW = Date.parse('2027-07-20T20:00:00Z');

describe('points along the route', () => {
  it('spaces points and times when the truck gets there', () => {
    const p = pointsAhead(route, 50, NOW);
    expect(p.map((x) => x.mi)).toEqual([50, 90, 130, 170, 200]);
    expect(p[1].at - NOW).toBe(40 * 60_000);
  });
});

describe('NWS alerts', () => {
  it('keeps driving warnings and drops the rest', () => {
    const h = parseAlerts({ features: [
      { id: 'a', properties: { event: 'Dust Storm Warning', headline: 'Dust storm warning until 5:30 PM', ends: '2027-07-20T00:30:00Z' } },
      { id: 'b', properties: { event: 'Air Quality Alert' } },
      { id: 'c', properties: { event: 'Severe Thunderstorm Watch' } },
    ] }, { mi: 40, lat: 34, lon: -112, at: NOW });
    expect(h.map((x) => [x.title, x.severity])).toEqual([['Dust Storm Warning', 'high'], ['Severe Thunderstorm Watch', 'medium']]);
  });
});

describe('forecast at the hour you are there', () => {
  it('flags storms, gusts and fog for the right hour', () => {
    const pts = [{ mi: 0, lat: 33.4, lon: -112, at: NOW }, { mi: 90, lat: 34.7, lon: -112, at: NOW + 90 * 60_000 }];
    const hours = ['2027-07-20T20:00', '2027-07-20T21:00', '2027-07-20T22:00'];
    const h = parseForecast([
      { hourly: { time: hours, weather_code: [0, 0, 95], precipitation_probability: [0, 10, 80], wind_gusts_10m: [10, 50, 20], visibility: [20000, 20000, 900] } },
      { hourly: { time: hours, weather_code: [0, 95, 0], precipitation_probability: [0, 70, 0], wind_gusts_10m: [10, 62, 10], visibility: [20000, 20000, 20000] } },
    ], pts);
    // Point 1 at 20:00 is clear; point 2 is reached about 21:30, nearest hour 21:00 or 22:00.
    expect(h.every((x) => x.mi === 90)).toBe(true);
    expect(h.map((x) => x.kind).sort()).toEqual(expect.arrayContaining(['storm']));
    expect(decodeURIComponent(forecastUrl(pts))).toMatch(/latitude=33\.400,34\.700/);
  });
});

describe('fires near the route', () => {
  const CSV = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight\n34.10,-112.10,330,0.4,0.4,2027-07-20,0942,N,n,2.0NRT,290,12.5,N\n34.11,-112.11,331,0.4,0.4,2027-07-20,0942,N,n,2.0NRT,290,8.0,N\n34.50,-111.20,320,0.4,0.4,2027-07-20,0942,N,n,2.0NRT,290,3.0,N';
  it('reads the CSV by column name', () => {
    const s = parseFirms(CSV);
    expect(s).toHaveLength(3);
    expect(s[0]).toEqual({ lat: 34.1, lon: -112.1, at: '2027-07-20T09:42:00Z', frp: 12.5 });
    expect(parseFirms('lat,lon\n1,2')).toEqual([]);
  });
  it('groups hotspots into fires near the route, and ignores ones far off it', () => {
    const f = firesNearRoute(parseFirms(CSV), route, 0);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'fire', severity: 'high', detail: '2 satellite hotspots (NASA FIRMS)' });
    expect(f[0].mi).toBeGreaterThan(40);
    expect(firmsUrl('KEY', route, 0)).toMatch(/\/api\/area\/csv\/KEY\/VIIRS_SNPP_NRT\/-112\.27,33\.25,-111\.87,36\.55\/1$/);
  });
});

describe('hazard service', () => {
  it('checks along the active route and puts the worst near one in the banner', async () => {
    const calls: string[] = [];
    const f = (async (u: string | URL) => {
      const url = new URL(String(u)); calls.push(url.hostname);
      if (url.hostname === 'api.weather.gov') return new Response(JSON.stringify({ features: url.searchParams.get('point')?.startsWith('34.0') ? [{ id: 'd', properties: { event: 'Dust Storm Warning' } }] : [] }));
      if (url.hostname === 'api.open-meteo.com') return new Response(JSON.stringify([]));
      return new Response('', { status: 500 });
    }) as typeof fetch;
    const svc = new HazardService({ route: () => ({ route, mi: 0 }), gps: () => null, online: () => true, firmsKey: () => null, userAgent: 'test', fetchFn: f });
    await svc.tick(NOW);
    expect(svc.view()).toMatchObject({ following: 'route', firesOn: false });
    expect(svc.view().hazards.map((h) => h.title)).toEqual(['Dust Storm Warning']);
    expect(svc.brief()).toEqual({ kind: 'warning', text: 'Dust Storm Warning at mile 40' });
    expect(calls).not.toContain('firms.modaps.eosdis.nasa.gov');
  });
});
