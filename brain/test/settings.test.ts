import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_LAYOUT, defaultSettings, loadSettings, maskSettings, mergeDriver, mergeSettings, migrateSettings, newDriver, SettingsError, SettingsStore } from '../src/settings.ts';
import { parseTruckbox, applyTruckbox } from '../src/truckbox.ts';
import type { State } from '../src/types.ts';

describe('settings merge', () => {
  it('merges nested objects and replaces arrays', () => {
    const s = mergeSettings(defaultSettings(), { gas: { haEntities: ['sensor.shell_regular_gas'] }, relays: { relay_2: 'Whip light' } });
    expect(s.gas.haEntities).toEqual(['sensor.shell_regular_gas']);
    expect(s.gas.source).toBe('manual');
    expect(s.relays.relay_2).toBe('Whip light');
    expect(s.relays.relay_1).toBe('Bed lights');
  });

  it('keeps a key when the masked value comes back, deletes on empty', () => {
    const a = mergeSettings(defaultSettings(), { keys: { afdc: 'abcd1234wxyz', placesFeed: 'jeff:hunter22' } });
    const masked = maskSettings(a);
    expect(masked.keys.afdc).toBe('••••wxyz');
    expect(masked.keys.placesFeed).toBe('••••er22');
    expect(mergeSettings(a, masked).keys.afdc).toBe('abcd1234wxyz');
    expect(mergeSettings(a, { keys: { afdc: '' } }).keys.afdc).toBeUndefined();
  });

  it('masks the Home Assistant token the same way and never returns it', () => {
    const a = mergeSettings(defaultSettings(), { homeAssistant: { url: 'http://ha.local:8123/', token: 'eyJhbGciOiJIUzI1NiJ9.secret.TOKN' } });
    expect(a.homeAssistant.url).toBe('http://ha.local:8123');
    const m = maskSettings(a);
    expect(m.homeAssistant.token).toBe('••••TOKN');
    expect(JSON.stringify(m)).not.toContain('secret');
    expect(mergeSettings(a, m).homeAssistant.token).toBe('eyJhbGciOiJIUzI1NiJ9.secret.TOKN');
    expect(mergeSettings(a, { homeAssistant: { bridge: false } }).homeAssistant.token).toBe('eyJhbGciOiJIUzI1NiJ9.secret.TOKN');
    expect(mergeSettings(a, { homeAssistant: { token: '' } }).homeAssistant.token).toBeUndefined();
    expect(() => mergeSettings(a, { homeAssistant: { url: 'ha.local' } })).toThrow(/http/);
  });

  it('rejects bad values with a reason', () => {
    expect(() => mergeSettings(defaultSettings(), { packKwh: -1 })).toThrow(SettingsError);
    expect(() => mergeSettings(defaultSettings(), { homeRate: { tou: [{ name: 'x', days: [1], start: '25:00', end: '01:00', perKwh: 0.1 }] } })).toThrow(/HH:MM/);
    expect(() => mergeSettings(defaultSettings(), { charging: { minKw: 5 } })).toThrow(/per driver/);
    expect(() => mergeSettings(defaultSettings(), { gas: { source: 'pump' } })).toThrow(/gas.source/);
  });

  it('drivers are not written through PUT /api/settings', () => {
    const s = mergeSettings(defaultSettings(), { drivers: [] });
    expect(s.drivers.map((d) => d.id)).toEqual(['jeff', 'sam', 'jordan', 'guest']);
  });
});

describe('driver profiles', () => {
  it('seeds Jeff, Sam, Jordan and a Guest with their trackers', () => {
    const d = defaultSettings().drivers;
    expect(d.map((x) => [x.id, x.tracker, x.guest])).toEqual([
      ['jeff', 'person.jeff', false], ['sam', 'person.sam', false], ['jordan', 'person.jordan', false], ['guest', null, true],
    ]);
  });

  it('merges a driver: charging nested, layout whole, id and guest fixed', () => {
    const one = { views: [{ id: 'drive', label: 'Drive', widgets: [{ type: 'speed', col: 1, row: 1, w: 12, h: 2 }] }] };
    const d = mergeDriver(newDriver('jeff', 'Jeff'), { charging: { minKw: 100, networks: ['EVgo'] }, layout: one, id: 'hacker', guest: true });
    expect(d.id).toBe('jeff');
    expect(d.guest).toBe(false);
    expect(d.charging.minKw).toBe(100);
    expect(d.charging.networks).toEqual(['EVgo']);
    expect(d.charging.connector).toBe('NACS');
    expect(d.layout).toEqual(one);
    expect(mergeDriver(d, { layout: null }).layout).toEqual(DEFAULT_LAYOUT);
    expect(() => mergeDriver(d, { tracker: 'phone of jeff' })).toThrow(/tracker/);
    expect(() => mergeDriver(d, { color: 'blue' })).toThrow(/color/);
  });

  it('the store adds, edits and deletes drivers; the Guest stays', () => {
    const store = new SettingsStore(mkdtempSync(path.join(tmpdir(), 'slate-set-')));
    const d = store.addDriver({ name: 'Uncle Bob', tracker: 'device_tracker.bobs_phone' });
    expect(d).toMatchObject({ id: 'uncle-bob', initials: 'UB', tracker: 'device_tracker.bobs_phone' });
    expect(store.get().drivers.at(-1)!.id).toBe('guest');
    expect(store.updateDriver('uncle-bob', { name: 'Bob' })!.name).toBe('Bob');
    expect(() => store.deleteDriver('guest')).toThrow(/Guest/);
    expect(store.deleteDriver('uncle-bob')).toBe(true);
  });
});

/** settings.json exactly as the brain wrote it before driver profiles. */
const OLD_FILE = {
  truckId: 'slate',
  packKwh: 65,
  efficiencyMiPerKwh: 3.2,
  relays: { relay_1: 'Bed lights', relay_2: 'Whip', relay_3: 'Rock lights', relay_4: 'Air compressor', relay_5: 'Bed fridge', relay_6: 'Inverter' },
  charging: { networks: ['Tesla'], avoidNetworks: ['Shady Volts'], minKw: 120, connector: 'CCS', maxDetourMi: 6, wantAmenities: ['restroom', 'shade'], arriveMinSoc: 20 },
  keys: { afdc: 'AFDCKEY123456' },
  homeAssistant: { bridge: false, homeChargerEnergyEntity: 'sensor.emporia_session_energy' },
  homeRate: { flatPerKwh: 0.13, tou: [{ name: 'on-peak', days: [1, 2, 3, 4, 5], start: '16:00', end: '19:00', perKwh: 0.31 }], fixedPerSession: 0 },
  homeLocation: { lat: 33.4990, lon: -111.9800 },
  compareMpg: 19,
  gasPrice: 3.89,
  theme: {
    active: 'my-red', auto: { enabled: false, day: 'day', night: 'my-red' },
    custom: [{ id: 'my-red', name: 'My Red', colors: { bg: '#110b0b', panel: '#1b1212', panel2: '#251818', line: '#3d2828', fg: '#f5ecec', dim: '#ab9393', accent: '#d42a2d', accentInk: '#ffffff', ok: '#5fd08a', warn: '#f2b33d', bad: '#ff9f43' }, fonts: { display: 'Orbitron', body: 'Inter', mono: 'JetBrains Mono' }, radius: 0.5, glow: 0.2 }],
  },
  layout: { views: [{ id: 'drive', label: 'Drive', widgets: [{ type: 'speed', col: 1, row: 1, w: 6, h: 2 }, { type: 'soc', col: 7, row: 1, w: 6, h: 2 }] }] },
};

describe('migration from flat settings', () => {
  it('moves theme, layout and charging into Jeff, gasPrice and compareMpg into the new shapes, and keeps everything else', () => {
    const s = loadSettings(migrateSettings(structuredClone(OLD_FILE)));
    const jeff = s.drivers.find((d) => d.id === 'jeff')!;
    expect(jeff.theme).toEqual(OLD_FILE.theme);
    expect(jeff.layout).toEqual(OLD_FILE.layout);
    expect(jeff.charging).toEqual(OLD_FILE.charging);
    expect(jeff.tracker).toBe('person.jeff');
    expect(s.gas).toEqual({ source: 'manual', manualPrice: 3.89, haEntities: [], pick: 'cheapest' });
    expect(s.compareVehicle).toEqual({ id: null, label: 'Custom', mpgCity: 19, mpgHighway: 19, mpgCombined: 19, fuel: 'regular' });
    // truck-level fields untouched
    expect(s.packKwh).toBe(65);
    expect(s.efficiencyMiPerKwh).toBe(3.2);
    expect(s.relays.relay_2).toBe('Whip');
    expect(s.keys.afdc).toBe('AFDCKEY123456');
    expect(s.homeAssistant).toEqual({ bridge: false, homeChargerEnergyEntity: 'sensor.emporia_session_energy', url: null });
    expect(s.homeRate).toEqual(OLD_FILE.homeRate);
    expect(s.homeLocation).toEqual(OLD_FILE.homeLocation);
    // the rest of the family gets defaults
    expect(s.drivers.map((d) => d.id)).toEqual(['jeff', 'sam', 'jordan', 'guest']);
    expect(s.drivers[1].charging.minKw).toBe(50);
    expect(s.drivers[1].layout).toEqual(DEFAULT_LAYOUT);
    expect(Object.keys(s)).not.toContain('theme');
    expect(Object.keys(s)).not.toContain('gasPrice');
    expect(Object.keys(s)).not.toContain('compareMpg');
  });

  it('old string themes still migrate', () => {
    const s = loadSettings(migrateSettings({ ...OLD_FILE, theme: 'day' }));
    expect(s.drivers[0].theme.active).toBe('day');
  });

  it('does not reseed when drivers exist, but always restores a Guest', () => {
    const only = { ...defaultSettings(), drivers: [newDriver('mom', 'Mom')] };
    const s = loadSettings(migrateSettings(JSON.parse(JSON.stringify(only))));
    expect(s.drivers.map((d) => d.id)).toEqual(['mom', 'guest']);
  });

  it('the store migrates the file on disk once and keeps a backup', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slate-mig-'));
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(OLD_FILE));
    const store = new SettingsStore(dir);
    expect(store.get().drivers[0].charging.minKw).toBe(120);
    const onDisk = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(onDisk.drivers[0].theme.active).toBe('my-red');
    expect(onDisk.gasPrice).toBeUndefined();
    expect(existsSync(path.join(dir, 'settings.json.pre-drivers.bak'))).toBe(true);
    // a second load reads the new file as is
    expect(new SettingsStore(dir).get()).toEqual(store.get());
  });
});

describe('truck box topics', () => {
  const blank = (): State => ({
    ts: '', speedMph: null, soc: null, socSource: null, rangeMi: null, gear: null, gps: null, ignition: null, reverse: null,
    cabinTempF: null, aux12v: null, tilt: null, tpms: null, relays: { relay_1: { name: 'Bed lights', on: null } }, fiveSwitch: [null, null, null, null, null], trip: null, truckbox: false, nowPlaying: null,
    driver: null, driverSuggestion: null, place: null, network: null as unknown as State['network'],
  });
  it('parses ESPHome topics and derives gear R from reverse', () => {
    const s = blank(); const tilt = { pitch: null, roll: null };
    for (const [t, p] of [['status', 'online'], ['switch/relay_1/state', 'ON'], ['binary_sensor/reverse/state', 'ON'], ['sensor/pitch/state', '2.5'], ['sensor/roll/state', '-1'], ['sensor/tpms_rr_psi/state', '33.1'], ['binary_sensor/five_switch_3/state', 'ON']] as const) {
      applyTruckbox(s, parseTruckbox(t, p)!, tilt);
    }
    expect(s.truckbox).toBe(true);
    expect(s.relays.relay_1.on).toBe(true);
    expect(s.gear).toBe('R');
    expect(s.tilt).toEqual({ pitch: 2.5, roll: -1 });
    expect(s.tpms?.rr.psi).toBe(33.1);
    expect(s.fiveSwitch[2]).toBe(true);
    applyTruckbox(s, parseTruckbox('binary_sensor/reverse/state', 'OFF')!, tilt);
    expect(s.gear).toBeNull(); // not "D": that needs CAN
    applyTruckbox(s, parseTruckbox('status', 'offline')!, tilt);
    expect(s.relays.relay_1.on).toBeNull();
    expect(s.tilt).toBeNull();
  });
  it('NaN from ESPHome is null', () => {
    expect(parseTruckbox('sensor/cabin_temp/state', 'nan')).toEqual({ cabinTempF: null });
  });
});
