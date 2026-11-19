// Turn signals from the truck box: the side camera shows while one is on (docs/contract.md).
import { describe, expect, it } from 'vitest';
import { applyTruckbox, parseTruckbox, signalSide } from '../src/truckbox.ts';
import { mergeControl } from '../src/sim.ts';
import { defaultRemote, mergeRemote } from '../src/remote/store.ts';
import type { State } from '../src/types.ts';

describe('turn signals', () => {
  it('come from binary_sensor/turn_left and turn_right', () => {
    expect(parseTruckbox('binary_sensor/turn_left/state', 'ON')).toEqual({ turn: { side: 'left', on: true } });
    expect(parseTruckbox('binary_sensor/turn_right/state', 'OFF')).toEqual({ turn: { side: 'right', on: false } });
    expect(parseTruckbox('binary_sensor/turn_middle/state', 'ON')).toBeNull();
  });
  it('one side, hazards (both: no camera), or none', () => {
    expect(signalSide({ left: true, right: false })).toBe('left');
    expect(signalSide({ left: null, right: true })).toBe('right');
    expect(signalSide({ left: true, right: true })).toBe('hazard');
    expect(signalSide({ left: false, right: false })).toBeNull();
    expect(signalSide(null)).toBeNull();
  });
  it('are kept in State, and unknown again when the truck box goes offline', () => {
    const s = { turnSignals: { left: null, right: null }, relays: {}, fiveSwitch: [] } as unknown as State;
    const tilt = { pitch: null, roll: null };
    applyTruckbox(s, parseTruckbox('binary_sensor/turn_left/state', 'ON')!, tilt);
    expect(s.turnSignals).toEqual({ left: true, right: null });
    applyTruckbox(s, parseTruckbox('status', 'offline')!, tilt);
    expect(s.turnSignals).toEqual({ left: null, right: null });
  });
  it('the test panel has the stalk', () => {
    const c = mergeControl({ mode: 'auto', gear: 'park', ignition: false, targetMph: 35, loop: true, cabinF: null, auxV: null, lowTire: null, switches: [false, false, false, false, false], signal: null }, { signal: 'left' });
    expect(c.signal).toBe('left');
    expect(() => mergeControl(c, { signal: 'up' as never })).toThrow(/signal/);
  });
});

describe('side and trail camera settings', () => {
  it('default on, 10 mph; side roles are allowed; the trail speed is bounded', () => {
    const d = defaultRemote(false);
    expect([d.cams.autoSide, d.cams.trailMph]).toEqual([true, 10]);
    const s = mergeRemote(d, { cams: { trailMph: 15, cameras: [...d.cams.cameras, { ...d.cams.cameras[0], id: 'left', name: 'Left', role: 'left', device: '/dev/video4' }] } });
    expect(s.cams.trailMph).toBe(15);
    expect(s.cams.cameras.at(-1)!.role).toBe('left');
    expect(() => mergeRemote(d, { cams: { trailMph: 60 } })).toThrow(/trailMph/);
  });
});
