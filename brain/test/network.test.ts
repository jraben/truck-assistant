import { describe, expect, it } from 'vitest';
import { candidates, decide, NetManager, NmcliBackend, PREFIX, splitTerse, wantedProfiles, type Runner } from '../src/network.ts';
import { defaultSettings, mergeDriver, mergeSettings, maskSettings } from '../src/settings.ts';
import type { Settings } from '../src/types.ts';

/** Jeff, Sam and Jordan with hotspots; Jeff with a BT tether; home Wi-Fi set. */
function family(): Settings {
  let s = mergeSettings(defaultSettings(), { homeWifi: { ssid: 'Home Wi-Fi', password: 'homepass123' } });
  s = { ...s, drivers: s.drivers.map((d) => d.guest ? d : mergeDriver(d, {
    hotspot: { ssid: `${d.name}'s iPhone`, password: `${d.id}-hotspot-pw` },
    btTetherMac: d.id === 'jeff' ? 'aa-bb-cc-dd-ee-01' : d.id === 'sam' ? 'AA:BB:CC:DD:EE:02' : null,
  })) };
  return s;
}

describe('network priority', () => {
  it('home, then the active driver, then the others, then the active driver over Bluetooth', () => {
    const w = wantedProfiles(family(), 'jeff');
    expect(w.map((x) => [x.id, x.priority, x.label])).toEqual([
      ['home', 100, 'HOME WI-FI'],
      ['hotspot:jeff', 90, "JEFF'S HOTSPOT"],
      ['hotspot:sam', 50, "SAM'S HOTSPOT"],
      ['hotspot:jordan', 50, "JORDAN'S HOTSPOT"],
      ['bt:jeff', 30, 'BT · JEFF'],
    ]);
    expect(w.find((x) => x.id === 'bt:jeff')?.mac).toBe('AA:BB:CC:DD:EE:01');
  });

  it('switching driver re-orders at once', () => {
    const w = wantedProfiles(family(), 'sam');
    expect(w.map((x) => x.id)).toEqual(['home', 'hotspot:sam', 'hotspot:jeff', 'hotspot:jordan', 'bt:sam']);
  });

  it('picks the best network in range; stays put unless a better one has a usable signal', () => {
    const w = wantedProfiles(family(), 'jeff');
    const none = new Map<string, number>();
    // In the truck, away from home: Sam's phone and Jeff's phone both visible.
    let c = candidates(w, [{ ssid: "Sam's iPhone", signal: 80 }, { ssid: "Jeff's iPhone", signal: 60 }], true, null);
    expect(decide(c, null, null, none)).toBe('hotspot:jeff');
    // On Sam's (a passenger) and Jeff's comes back: hop.
    c = candidates(w, [{ ssid: "Sam's iPhone", signal: 80 }, { ssid: "Jeff's iPhone", signal: 60 }], true, 'hotspot:sam');
    expect(decide(c, 'hotspot:sam', null, none)).toBe('hotspot:jeff');
    // ...but not onto a barely-there signal.
    c = candidates(w, [{ ssid: "Sam's iPhone", signal: 80 }, { ssid: "Jeff's iPhone", signal: 10 }], true, 'hotspot:sam');
    expect(decide(c, 'hotspot:sam', null, none)).toBeNull();
    // Pulling into the driveway: home wins.
    c = candidates(w, [{ ssid: 'Home Wi-Fi', signal: 55 }, { ssid: "Jeff's iPhone", signal: 90 }], true, 'hotspot:jeff');
    expect(decide(c, 'hotspot:jeff', null, none)).toBe('home');
    // No Wi-Fi at all: Bluetooth tether.
    c = candidates(w, [], true, null);
    expect(decide(c, null, null, none)).toBe('bt:jeff');
    // ...unless Bluetooth isn't usable: offline, nothing to do.
    c = candidates(w, [], false, null);
    expect(decide(c, null, null, none)).toBeNull();
  });

  it('a manual pick holds while it is in range; a failed network waits before a retry', () => {
    const w = wantedProfiles(family(), 'jeff');
    const seen = [{ ssid: 'Home Wi-Fi', signal: 55 }, { ssid: "Jordan's iPhone", signal: 70 }];
    let c = candidates(w, seen, true, 'home');
    expect(decide(c, 'home', 'hotspot:jordan', new Map())).toBe('hotspot:jordan');
    c = candidates(w, seen, true, 'hotspot:jordan');
    expect(decide(c, 'hotspot:jordan', 'hotspot:jordan', new Map())).toBeNull();
    const now = 1_000_000;
    c = candidates(w, [{ ssid: "Jeff's iPhone", signal: 70 }, { ssid: "Jordan's iPhone", signal: 70 }], true, null);
    expect(decide(c, null, null, new Map([['hotspot:jeff', now + 60_000]]), now)).toBe('hotspot:jordan');
    expect(decide(c, null, null, new Map([['hotspot:jeff', now - 1]]), now)).toBe('hotspot:jeff');
  });

  it('passwords are masked like keys and survive a round trip', () => {
    const s = family();
    const m = maskSettings(s);
    expect(m.homeWifi?.password).toBe('••••s123');
    expect(m.drivers[0].hotspot?.password).toMatch(/^••••/);
    expect(JSON.stringify(m)).not.toContain('jeff-hotspot-pw');
    const back = mergeDriver(s.drivers[0], { hotspot: m.drivers[0].hotspot });
    expect(back.hotspot?.password).toBe('jeff-hotspot-pw');
    // a new SSID with the masked password doesn't carry the old password to another network
    expect(mergeDriver(s.drivers[0], { hotspot: { ssid: 'New phone', password: m.drivers[0].hotspot!.password } }).hotspot).toEqual({ ssid: 'New phone' });
    expect(() => mergeDriver(s.drivers[0], { hotspot: { ssid: 'x', password: 'short' } })).toThrow(/8 to 63/);
  });
});

/** A fake nmcli: records each argument list and answers from a little model of NetworkManager. */
function fakeNmcli(opts: { visible: [string, number][]; bt?: boolean; failUp?: string[] }) {
  const calls: string[][] = [];
  const profiles = new Map<string, string[]>([['slate-ap', ['wifi']], ['Wired connection 1', ['ethernet']]]);
  let active: string | null = null;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  const run: Runner = async (args) => {
    calls.push(args);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const a = args.join(' ');
    if (a === '-t -f NAME,TYPE connection show') return ok([...profiles].map(([n, t]) => `${esc(n)}:${t[0] === 'wifi' ? '802-11-wireless' : t[0]}`).join('\n'));
    if (args[0] === 'connection' && args[1] === 'delete') { profiles.delete(args[2]); return ok(); }
    if (args[0] === 'connection' && args[1] === 'add') { profiles.set(args[args.indexOf('con-name') + 1], [args[3]]); return ok(); }
    if (a.startsWith('-t -f IN-USE,SSID,SIGNAL device wifi list')) return ok(opts.visible.map(([s, sig]) => `${active && profiles.has(active) && s === ssidOf(active) ? '*' : ' '}:${esc(s)}:${sig}`).join('\n'));
    if (a === '-t -f NAME,TYPE,DEVICE connection show --active') return ok([`slate-ap:802-11-wireless:wlan0`, ...(active ? [`${esc(active)}:${active.includes('-bt-') ? 'bluetooth' : '802-11-wireless'}:wlan1`] : [])].join('\n'));
    if (a === '-t -f DEVICE,TYPE,STATE device') return ok(['wlan0:wifi:connected', 'wlan1:wifi:disconnected', ...(opts.bt ? ['B8\\:27\\:EB\\:00\\:00\\:01:bt:disconnected'] : [])].join('\n'));
    if (args.includes('up')) {
      const name = args[args.length - 1];
      if (opts.failUp?.includes(name)) return { code: 4, stdout: '', stderr: 'Error: Connection activation failed: Secrets were required, but not provided.' };
      active = name; return ok();
    }
    return { code: 2, stdout: '', stderr: `unexpected: ${a}` };
  };
  const added = new Map<string, string[]>();
  const ssidOf = (name: string) => { const c = calls.find((x) => x[1] === 'add' && x[x.indexOf('con-name') + 1] === name); return c ? c[c.indexOf('ssid') + 1] : null; };
  return { run, calls, profiles, added, get active() { return active; } };
}

describe('nmcli backend (fake runner)', () => {
  it('splits terse output with escaped colons', () => {
    expect(splitTerse('*:Bob\\:s phone:77')).toEqual(['*', 'Bob:s phone', '77']);
    expect(splitTerse('a\\\\b:c')).toEqual(['a\\b', 'c']);
  });

  it('creates slate-net-* profiles only, as argument lists, joins the best one and counts the driver', async () => {
    const nm = fakeNmcli({ visible: [["Jeff's iPhone", 71], ['Neighbor', 90]], bt: true });
    let s = family();
    let driver = 'jeff';
    const be = new NmcliBackend(nm.run, 'wlan1');
    const mgr = new NetManager(be, () => s, () => driver, null, () => {}, () => {});
    await mgr.tick();
    for (const c of nm.calls) for (const arg of c) expect(typeof arg).toBe('string'); // never a shell line
    const adds = nm.calls.filter((c) => c[1] === 'add');
    expect(adds.map((c) => c[c.indexOf('con-name') + 1])).toEqual([`${PREFIX}home`, `${PREFIX}hotspot-jeff`, `${PREFIX}hotspot-sam`, `${PREFIX}hotspot-jordan`, `${PREFIX}bt-jeff`]);
    const jeff = adds[1];
    expect(jeff).toEqual(expect.arrayContaining(['type', 'wifi', 'ifname', 'wlan1', 'ssid', "Jeff's iPhone", 'wifi-sec.psk', 'jeff-hotspot-pw', 'connection.autoconnect-priority', '90']));
    expect(adds[4]).toEqual(expect.arrayContaining(['type', 'bluetooth', 'bt-type', 'panu', 'bluetooth.bdaddr', 'AA:BB:CC:DD:EE:01']));
    expect(nm.profiles.has('slate-ap')).toBe(true); // the access point is never touched
    expect(nm.calls.some((c) => c.includes('slate-ap') && c[0] === 'connection')).toBe(false);
    expect(nm.active).toBe(`${PREFIX}hotspot-jeff`);
    expect(mgr.status).toMatchObject({ link: 'hotspot', label: "JEFF'S HOTSPOT", driverId: 'jeff', ssid: "Jeff's iPhone", backend: 'nmcli', bluetooth: 'supported' });

    // Switch driver: priorities re-written, Sam's profile up top.
    nm.calls.length = 0;
    driver = 'sam';
    await mgr.tick();
    const readd = nm.calls.filter((c) => c[1] === 'add').map((c) => [c[c.indexOf('con-name') + 1], c[c.indexOf('connection.autoconnect-priority') + 1]]);
    expect(readd).toEqual(expect.arrayContaining([[`${PREFIX}hotspot-sam`, '90'], [`${PREFIX}hotspot-jeff`, '50'], [`${PREFIX}bt-sam`, '30']]));
    expect(nm.profiles.has(`${PREFIX}bt-jeff`)).toBe(false);
    // Sam's phone isn't in range; Jeff's (now a passenger's) still carries us.
    expect(mgr.status.label).toBe("JEFF'S HOTSPOT");

    // Settings drop the home network: its profile goes.
    s = { ...s, homeWifi: null };
    await mgr.tick();
    expect(nm.profiles.has(`${PREFIX}home`)).toBe(false);
  });

  it('a failed join is reported and the next network is tried after it', async () => {
    const nm = fakeNmcli({ visible: [["Jeff's iPhone", 71], ["Jordan's iPhone", 60]], bt: false, failUp: [`${PREFIX}hotspot-jeff`] });
    const mgr = new NetManager(new NmcliBackend(nm.run, 'wlan1'), () => family(), () => 'jeff', null, () => {}, () => {});
    await mgr.tick();
    expect(mgr.status.link).toBe('offline');
    expect(mgr.status.error).toMatch(/JEFF'S HOTSPOT.*Secrets/);
    expect(mgr.status.bluetooth).toMatch(/no Bluetooth adapter/);
    await mgr.tick();
    expect(mgr.status.label).toBe("JORDAN'S HOTSPOT");
  });
});
