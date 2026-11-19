import { describe, expect, it } from 'vitest';
import { keepScreenAwakeWhileCharging, shouldHold } from '../src/lib/screenAwake.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakes(charging: boolean | null) {
  const log: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const on = (t: string, f: () => void) => { (listeners[t] ??= []).push(f); };
  const fire = (t: string) => (listeners[t] ?? []).forEach((f) => f());
  const battery = charging === null ? null : { charging, addEventListener: on };
  const doc = { visibilityState: 'visible', addEventListener: on } as unknown as Document & { visibilityState: string };
  const nav = {
    wakeLock: { request: async () => { log.push('hold'); return { release: async () => { log.push('release'); } }; } },
    ...(battery ? { getBattery: async () => battery } : {}),
  };
  return { log, battery, doc, nav, fire };
}

describe('screen on only while the truck is on', () => {
  it('holds while charging or with no battery, not on battery', () => {
    expect(shouldHold({ charging: true })).toBe(true);
    expect(shouldHold({ charging: false })).toBe(false);
    expect(shouldHold(null)).toBe(true);
  });

  it('lets go when unplugged, and holds again when plugged back in', async () => {
    const f = fakes(true);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc);
    await tick(); await tick();
    expect(f.log).toEqual(['hold']);
    f.battery!.charging = false; f.fire('chargingchange'); await tick();
    expect(f.log).toEqual(['hold', 'release']);
    f.battery!.charging = true; f.fire('chargingchange'); await tick();
    expect(f.log).toEqual(['hold', 'release', 'hold']);
  });

  it('never holds when it starts on battery', async () => {
    const f = fakes(false);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc);
    await tick(); await tick();
    expect(f.log).toEqual([]);
  });

  it('with no battery to ask about (the Pi screen), holds', async () => {
    const f = fakes(null);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc);
    await tick();
    expect(f.log).toEqual(['hold']);
  });
});
