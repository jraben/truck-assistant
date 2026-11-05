import { describe, expect, it } from 'vitest';
import { networkMatches, rankChargers, scoreCharger, type Station } from '../src/chargers/score.ts';
import { afdcStation, mergeStations, normalizeConnector, ocmStation } from '../src/chargers/sources.ts';
import { haversineMi } from '../src/geo.ts';
import { defaultSettings } from '../src/settings.ts';

const settings = () => {
  const s = defaultSettings();
  s.charging = { networks: ['Tesla', 'Electrify America'], avoidNetworks: ['Shady Volts'], minKw: 50, connector: 'NACS', maxDetourMi: 10, wantAmenities: ['restroom', 'food'], arriveMinSoc: 15 };
  return s;
};
const st = (o: Partial<Station>): Station => ({
  id: 'x', source: 'afdc', name: 'X', network: null, lat: 33.45, lon: -112.07, maxKw: 150, connectors: ['NACS'], amenities: [], price: null, ...o,
});

describe('scoreCharger', () => {
  it('ranks a preferred, fast, near NACS site with amenities high and explains why', () => {
    const c = scoreCharger(st({ network: 'Tesla', maxKw: 250, amenities: ['restroom', 'food'] }), { distanceMi: 2, soc: 60, settings: settings() });
    expect(c.score).toBeGreaterThan(90);
    expect(c.reasons).toContain('Tesla: preferred network #1');
    expect(c.reasons.some((r) => r.includes('250 kW (truck takes ~120)'))).toBe(true);
    expect(c.reasons).toContain('Has NACS');
    expect(c.reasons).toContain('Has restroom, food');
  });

  it('gives no extra credit past the truck peak', () => {
    const a = scoreCharger(st({ maxKw: 150 }), { distanceMi: 3, soc: 60, settings: settings() });
    const b = scoreCharger(st({ maxKw: 350 }), { distanceMi: 3, soc: 60, settings: settings() });
    expect(a.score).toBe(b.score);
  });

  it('penalises avoided networks, slow chargers and missing connectors', () => {
    const base = scoreCharger(st({}), { distanceMi: 3, soc: 60, settings: settings() }).score;
    expect(scoreCharger(st({ network: 'Shady Volts' }), { distanceMi: 3, soc: 60, settings: settings() }).score).toBeLessThan(base - 30);
    const slow = scoreCharger(st({ maxKw: 7 }), { distanceMi: 3, soc: 60, settings: settings() });
    expect(slow.reasons.some((r) => r.includes('below your 50 kW minimum'))).toBe(true);
    const ccs = scoreCharger(st({ connectors: ['CCS'] }), { distanceMi: 3, soc: 60, settings: settings() });
    expect(ccs.score).toBeLessThan(base);
    expect(ccs.reasons.some((r) => r.startsWith('No NACS plug'))).toBe(true);
  });

  it('treats Level 2 only as below a DC minimum without inventing a kW figure', () => {
    const c = scoreCharger(st({ maxKw: null, level2Only: true }), { distanceMi: 1, soc: 60, settings: settings() });
    expect(c.maxKw).toBeNull();
    expect(c.reasons).toContain('Level 2 only, below your 50 kW minimum');
    expect('level2Only' in c).toBe(false);
  });

  it('flags chargers that cannot be reached with the minimum arrival charge', () => {
    // 52.7 kWh x 3.5 mi/kWh = ~184 mi full. 10% = ~18 mi. 20 mi away at 20% arrives ~9%.
    const c = scoreCharger(st({}), { distanceMi: 20, soc: 20, settings: settings() });
    expect(c.reasons.some((r) => /^Arrive ~\d+%, below your 15%$/.test(r))).toBe(true);
    const ok = scoreCharger(st({}), { distanceMi: 20, soc: 80, settings: settings() });
    expect(ok.score).toBeGreaterThan(c.score + 40);
  });

  it('says so when the charge level is unknown instead of guessing reach', () => {
    const c = scoreCharger(st({}), { distanceMi: 2, soc: null, settings: settings() });
    expect(c.reasons).toContain('Charge level unknown, reach not checked');
  });

  it('penalises distance past maxDetourMi and clamps to 0..100', () => {
    const far = scoreCharger(st({ network: 'Shady Volts', maxKw: 6, connectors: ['J1772'] }), { distanceMi: 40, soc: 5, settings: settings() });
    expect(far.score).toBe(0);
    expect(far.reasons.some((r) => r.includes('past your 10 mi limit'))).toBe(true);
  });

  it('accepts any connector when the preference is any', () => {
    const s = settings(); s.charging.connector = 'any';
    const c = scoreCharger(st({ connectors: ['CCS'] }), { distanceMi: 2, soc: 60, settings: s });
    expect(c.reasons.some((r) => r.includes('NACS'))).toBe(false);
  });
});

describe('rankChargers', () => {
  it('sorts best first, nearer wins ties', () => {
    const here = { lat: 33.45, lon: -112.07 };
    const list = rankChargers([
      st({ id: 'far', lat: 33.50, network: 'Tesla' }),
      st({ id: 'near', lat: 33.451, network: 'Tesla' }),
      st({ id: 'avoid', lat: 33.4505, network: 'Shady Volts' }),
    ], here, 70, settings(), haversineMi);
    expect(list.map((c) => c.id)).toEqual(['near', 'far', 'avoid']);
  });
});

describe('sources', () => {
  it('normalises connector names from both feeds', () => {
    expect(normalizeConnector('TESLA')).toBe('NACS');
    expect(normalizeConnector('J3400')).toBe('NACS');
    expect(normalizeConnector('J1772COMBO')).toBe('CCS');
    expect(normalizeConnector('CCS (Type 1)')).toBe('CCS');
    expect(normalizeConnector('Type 1 (J1772)')).toBe('J1772');
    expect(normalizeConnector('Tesla (Model S/X)')).toBe('NACS');
  });

  it('merges one site listed by AFDC and OCM, keeping AFDC id and OCM kW', () => {
    const a = afdcStation({ id: 1, station_name: 'Tempe Marketplace', ev_network: 'Electrify America', latitude: 33.4300, longitude: -111.9000, ev_connector_types: ['J1772COMBO'], ev_dc_fast_num: 4, facility_type: 'SHOPPING_CENTER' })!;
    const o = ocmStation({ ID: 9, AddressInfo: { Title: 'EA Tempe', Latitude: 33.4302, Longitude: -111.9001 }, OperatorInfo: { Title: 'Electrify America' }, Connections: [{ ConnectionType: { Title: 'CCS (Type 1)' }, PowerKW: 350, LevelID: 3 }, { ConnectionType: { Title: 'NACS / Tesla Supercharger' }, PowerKW: 150, LevelID: 3 }], UsageCost: '$0.56/kWh' })!;
    const other = ocmStation({ ID: 10, AddressInfo: { Title: 'Far away', Latitude: 33.5, Longitude: -111.9 }, Connections: [] })!;
    const m = mergeStations([a], [o, other]);
    expect(m).toHaveLength(2);
    expect(m[0].id).toBe('afdc:1');
    expect(m[0].maxKw).toBe(350);
    expect(m[0].connectors.sort()).toEqual(['CCS', 'NACS']);
    expect(m[0].price).toBe('$0.56/kWh');
    expect(m[0].amenities).toContain('restroom');
  });

  it('matches networks loosely but not emptily', () => {
    expect(networkMatches('Tesla Destination', 'Tesla')).toBe(true);
    expect(networkMatches('ELECTRIFY_AMERICA', 'Electrify America')).toBe(true);
    expect(networkMatches(null, 'Tesla')).toBe(false);
    expect(networkMatches('ChargePoint', '')).toBe(false);
  });
});
