import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, defaultSettings, maskSettings, mergeSettings, SettingsError } from '../src/settings.ts';
import { parseTruckbox, applyTruckbox } from '../src/truckbox.ts';
import type { State } from '../src/types.ts';

describe('settings merge', () => {
  it('merges nested objects and replaces arrays', () => {
    const s = mergeSettings(defaultSettings(), { charging: { minKw: 100, networks: ['EVgo'] }, relays: { relay_2: 'Whip light' } });
    expect(s.charging.minKw).toBe(100);
    expect(s.charging.networks).toEqual(['EVgo']);
    expect(s.charging.connector).toBe('NACS');
    expect(s.relays.relay_2).toBe('Whip light');
    expect(s.relays.relay_1).toBe('Bed lights');
  });

  it('keeps a key when the masked value comes back, deletes on empty', () => {
    const a = mergeSettings(defaultSettings(), { keys: { afdc: 'abcd1234wxyz' } });
    const masked = maskSettings(a);
    expect(masked.keys.afdc).toBe('••••wxyz');
    expect(mergeSettings(a, masked).keys.afdc).toBe('abcd1234wxyz');
    expect(mergeSettings(a, { keys: { afdc: '' } }).keys.afdc).toBeUndefined();
  });

  it('rejects bad values with a reason', () => {
    expect(() => mergeSettings(defaultSettings(), { packKwh: -1 })).toThrow(SettingsError);
    expect(() => mergeSettings(defaultSettings(), { homeRate: { tou: [{ name: 'x', days: [1], start: '25:00', end: '01:00', perKwh: 0.1 }] } })).toThrow(/HH:MM/);
  });

  it('layout is replaced whole; null resets it', () => {
    const one = { views: [{ id: 'drive', label: 'Drive', widgets: [{ type: 'speed', col: 1, row: 1, w: 12, h: 2 }] }] };
    expect(mergeSettings(defaultSettings(), { layout: one }).layout).toEqual(one);
    expect(mergeSettings(mergeSettings(defaultSettings(), { layout: one }), { layout: null }).layout).toEqual(DEFAULT_LAYOUT);
  });
});

describe('truck box topics', () => {
  const blank = (): State => ({
    ts: '', speedMph: null, soc: null, socSource: null, rangeMi: null, gear: null, gps: null, ignition: null, reverse: null,
    cabinTempF: null, aux12v: null, tilt: null, tpms: null, relays: { relay_1: { name: 'Bed lights', on: null } }, fiveSwitch: [null, null, null, null, null], trip: null, truckbox: false, nowPlaying: null,
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
