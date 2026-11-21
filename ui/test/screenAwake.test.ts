import { afterEach, describe, expect, it, vi } from 'vitest';
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
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 0);
    await tick(); await tick(); await tick();
    expect(f.log).toEqual(['hold']);
    f.battery!.charging = false; f.fire('chargingchange'); await tick();
    expect(f.log).toEqual(['hold', 'release']);
    f.battery!.charging = true; f.fire('chargingchange'); await tick(); await tick();
    expect(f.log).toEqual(['hold', 'release', 'hold']);
  });

  it('never holds when it starts on battery', async () => {
    const f = fakes(false);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 0);
    await tick(); await tick(); await tick();
    expect(f.log).toEqual([]);
  });

  it('with no battery to ask about (the Pi screen), holds', async () => {
    const f = fakes(null);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 0);
    await tick(); await tick();
    expect(f.log).toEqual(['hold']);
  });
});

describe("waits out Tasker's re-launch before holding (a lock held through it gets stuck on)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it('holds only after the settle time once plugged in', async () => {
    vi.useFakeTimers();
    const f = fakes(false);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 5000);
    await vi.advanceTimersByTimeAsync(0);
    f.battery!.charging = true; f.fire('chargingchange');
    await vi.advanceTimersByTimeAsync(4900);
    expect(f.log).toEqual([]); // Tasker's re-launch lands ~0.1 s in, with nothing held
    await vi.advanceTimersByTimeAsync(200);
    expect(f.log).toEqual(['hold']);
  });

  it('the screen coming on restarts the wait', async () => {
    vi.useFakeTimers();
    const f = fakes(true);
    f.doc.visibilityState = 'hidden';
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 5000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    f.doc.visibilityState = 'visible'; f.fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(f.log).toEqual(['hold']);
  });

  it('unplugged during the wait: never holds', async () => {
    vi.useFakeTimers();
    const f = fakes(false);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 5000);
    await vi.advanceTimersByTimeAsync(0);
    f.battery!.charging = true; f.fire('chargingchange');
    await vi.advanceTimersByTimeAsync(2000);
    f.battery!.charging = false; f.fire('chargingchange');
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.log).toEqual([]);
  });

  it('lets go at once when unplugged', async () => {
    vi.useFakeTimers();
    const f = fakes(true);
    keepScreenAwakeWhileCharging(f.nav as never, f.doc, 5000);
    await vi.advanceTimersByTimeAsync(5100);
    expect(f.log).toEqual(['hold']);
    f.battery!.charging = false; f.fire('chargingchange');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.log).toEqual(['hold', 'release']);
  });
});
