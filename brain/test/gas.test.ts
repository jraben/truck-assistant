import { describe, expect, it } from 'vitest';
import { fuelOf, pickPrices, priceForDay, priceOf, readGas, stationOf } from '../src/gas/gas.ts';
import { fuelGrade, menuItems, vehicleFrom } from '../src/gas/vehicles.ts';
import { summarize, tripGallons } from '../src/charges/summary.ts';
import { customVehicle } from '../src/settings.ts';
import type { CompareVehicle } from '../src/types.ts';
import type { HaState } from '../src/ha/client.ts';

const gb = (entity: string, state: string, attrs: Record<string, unknown> = {}): HaState => ({
  entity_id: entity, state, last_updated: '2026-11-05T15:00:00+00:00',
  attributes: { unit_of_measurement: 'USD/gal', attribution: 'Member credit via GasBuddy', friendly_name: 'Shell Baseline Regular Gas', last_updated: '2026-11-05T13:10:00+00:00', ...attrs },
});

describe('GasBuddy sensors', () => {
  it('reads price, grade, station and when GasBuddy saw it', () => {
    expect(readGas(gb('sensor.shell_baseline_regular_gas', '3.29'))).toEqual({
      entityId: 'sensor.shell_baseline_regular_gas', price: 3.29, fuel: 'regular', cashOrDeal: false,
      station: 'Shell Baseline', updatedAt: '2026-11-05T13:10:00.000Z',
    });
    expect(fuelOf('sensor.qt_premium_gas', 'QT Premium Gas')).toBe('premium');
    expect(fuelOf('sensor.qt_midgrade_gas_cash', 'QT MidGrade Gas (Cash)')).toBe('midgrade');
    expect(fuelOf('sensor.qt_diesel', 'QT Diesel')).toBe('diesel');
    expect(fuelOf('sensor.qt_e85', 'QT E85')).toBeNull();
    expect(readGas(gb('sensor.qt_e85', '2.10', { friendly_name: 'QT E85' }))).toBeNull();
  });
  it('tolerates other units and junk states', () => {
    expect(priceOf(gb('sensor.x_regular_gas', '145.9', { unit_of_measurement: '¢/L' }))).toBeCloseTo(5.523, 2);
    expect(priceOf(gb('sensor.x_regular_gas', 'unavailable'))).toBeNull();
    expect(priceOf(gb('sensor.x_regular_gas', '0'))).toBeNull();
    expect(stationOf(gb('sensor.x', '3', { station_name: 'Circle K #12' }))).toBe('Circle K #12');
  });
  it('picks the cheapest card price per grade, or the average', () => {
    const r = [
      readGas(gb('sensor.a_regular_gas', '3.39', { friendly_name: 'A Regular Gas' }))!,
      readGas(gb('sensor.b_regular_gas', '3.19', { friendly_name: 'B Regular Gas' }))!,
      readGas(gb('sensor.b_regular_gas_cash', '2.99', { friendly_name: 'B Regular Gas (Cash)' }))!,
      readGas(gb('sensor.b_premium_gas', '4.09', { friendly_name: 'B Premium Gas' }))!,
    ];
    const c = pickPrices(r, 'cheapest');
    expect(c.get('regular')).toMatchObject({ price: 3.19, station: 'B' }); // cash price skipped while a card price exists
    expect(c.get('premium')?.price).toBe(4.09);
    expect(pickPrices(r, 'average').get('regular')?.price).toBe(3.29);
  });
});

describe('per-day gas price', () => {
  const rows = [
    { day: '2026-11-01', fuel: 'regular', price: 3.10 },
    { day: '2026-11-04', fuel: 'regular', price: 3.40 },
    { day: '2026-11-02', fuel: 'premium', price: 4.20 },
  ];
  it('uses the day, then the nearest known day of that grade, then manual', () => {
    expect(priceForDay('2026-11-04', 'regular', rows, 3.5)).toBe(3.40);
    expect(priceForDay('2026-11-02', 'regular', rows, 3.5)).toBe(3.10);   // 1 day from the 1st, 2 from the 4th
    expect(priceForDay('2026-10-01', 'regular', rows, 3.5)).toBe(3.10);
    expect(priceForDay('2026-12-25', 'regular', rows, 3.5)).toBe(3.40);
    expect(priceForDay('2026-11-03', 'premium', rows, 3.5)).toBe(4.20);
    expect(priceForDay('2026-11-03', 'diesel', rows, 3.5)).toBe(3.5);     // no diesel sensor: manual
  });
  it('a tie goes to the earlier day', () => {
    const tie = [{ day: '2026-11-01', fuel: 'regular', price: 3 }, { day: '2026-11-03', fuel: 'regular', price: 4 }];
    expect(priceForDay('2026-11-02', 'regular', tie, 9)).toBe(3);
  });
});

describe('gas comparison', () => {
  const tacoma: CompareVehicle = { id: 40732, label: '2019 Toyota Tacoma 4WD', mpgCity: 18, mpgHighway: 22, mpgCombined: 20, fuel: 'regular' };
  const noon = (d: number) => new Date(2026, 10, d, 12).toISOString();

  it('city miles at city mpg, highway at highway mpg, the rest (or no split) at combined', () => {
    expect(tripGallons({ startedAt: noon(1), miles: 40 }, tacoma)).toBeCloseTo(2, 6);
    expect(tripGallons({ startedAt: noon(1), miles: 40, cityMiles: 18, highwayMiles: 22 }, tacoma)).toBeCloseTo(2, 6); // 1 + 1
    expect(tripGallons({ startedAt: noon(1), miles: 40, cityMiles: 18, highwayMiles: null }, tacoma)).toBeCloseTo(1 + 22 / 20, 6);
    expect(tripGallons({ startedAt: noon(1), miles: 40, cityMiles: 36, highwayMiles: 44 }, tacoma)).toBeCloseTo(2, 6); // split overshoots: scaled to 40
  });

  it("prices each trip at its own day's price and names the vehicle", () => {
    const price: Record<string, number> = { '2026-11-01': 3.00, '2026-11-02': 4.00 };
    const trips = [
      { startedAt: noon(1), miles: 36, cityMiles: 36, highwayMiles: 0 },   // 2 gal x $3 = 6
      { startedAt: noon(2), miles: 44, cityMiles: 0, highwayMiles: 44 },   // 2 gal x $4 = 8
      { startedAt: noon(2), miles: 20 },                                    // 1 gal x $4 = 4
    ];
    const [nov] = summarize([], trips, 'month', { vehicle: tacoma, priceFor: (d) => price[d] ?? 3.5 });
    expect(nov).toMatchObject({ period: '2026-11', miles: 100, gasEquivalent: 18, gasVehicle: '2019 Toyota Tacoma 4WD' });
  });

  it('a migrated compareMpg is a "Custom" vehicle at one mpg', () => {
    const [r] = summarize([], [{ startedAt: noon(3), miles: 44, cityMiles: 10, highwayMiles: 34 }], 'month', { vehicle: customVehicle(22), priceFor: () => 3.5 });
    expect(r.gasEquivalent).toBe(7);
    expect(r.gasVehicle).toBe('Custom');
  });
});

describe('fueleconomy.gov shapes', () => {
  it('handles a list, a single object and null', () => {
    expect(menuItems({ menuItem: [{ text: '2019', value: '2019' }, { text: '2018', value: '2018' }] })).toHaveLength(2);
    expect(menuItems({ menuItem: { text: 'Auto (AM7), 8 cyl, 3.9 L, Turbo', value: '40072' } })).toEqual([{ text: 'Auto (AM7), 8 cyl, 3.9 L, Turbo', value: '40072' }]);
    expect(menuItems(null)).toEqual([]);
  });
  it('reads a vehicle record (numbers come as strings)', () => {
    const v = vehicleFrom({ id: '40732', year: '2019', make: 'Toyota', model: 'Tacoma 4WD', city08: '18', highway08: '22', comb08: '20', fuelType: 'Regular', fuelType1: 'Regular Gasoline' });
    expect(v).toEqual({ id: 40732, label: '2019 Toyota Tacoma 4WD', mpgCity: 18, mpgHighway: 22, mpgCombined: 20, fuel: 'regular' });
    expect(fuelGrade('Premium Gasoline')).toBe('premium');
    expect(fuelGrade('Diesel')).toBe('diesel');
    expect(() => vehicleFrom({ id: '1', city08: '0', highway08: '0', comb08: '0', fuelType1: 'Electricity' })).toThrow(/mpg/);
  });
});
