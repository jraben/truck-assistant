import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { seedDemo, buildPlan, isEmptyDataDir } from '../src/demo/seed.ts';
import { allowedHost, commandName, demoFetch, BLOCKED_COMMANDS } from '../src/demo/gate.ts';
import { demoBackend, makeDemoServices, ocmAnswer } from '../src/demo/backend.ts';
import { demoArea } from '../src/demo/area.ts';
import { DEMO_HA_URL, DEMO_WOPR_URL } from '../src/demo/world.ts';
import { loadSettings, migrateSettings } from '../src/settings.ts';
import { summarize } from '../src/charges/summary.ts';
import { pickNextAppointment } from '../src/wopr/calendar.ts';
import { tileFor } from '../src/ha/panel.ts';
import { SocModel } from '../src/soc.ts';
import type { ChargeSession } from '../src/types.ts';

/** Words that must never appear in anything a demo truck shows or stores. */
const PERSONAL = /jeff|raben|kjef|sub\/?wave|nomad|192\.168\.|homeassistant\.local|wopr\.jeffraben|rabenit/i;

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'slate-demo-')); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

/** Every row of every table, as text. */
function dumpDb(dir: string): string {
  const db = openDb(dir);
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n');
  } finally { db.close(); }
}

const NOW = new Date(2026, 10, 7, 18, 0); // a Saturday evening

describe('demo seeder', () => {
  it('seeds an empty DATA_DIR with weeks of believable driving and charging', () => {
    const dir = tmp();
    const sum = seedDemo(dir, NOW)!;
    expect(sum).not.toBeNull();
    expect(sum.trips).toBeGreaterThan(50);
    expect(sum.miles).toBeGreaterThan(500);
    expect(sum.soc).toBeGreaterThan(30);
    expect(sum.soc).toBeLessThan(90);
    const db = openDb(dir);
    try {
      const trips = db.prepare('SELECT * FROM trips ORDER BY started_at').all() as { started_at: string; ended_at: string; miles: number; kwh_est: number; simulated: number; start_stop_id: number; end_stop_id: number }[];
      for (const t of trips) {
        const h = new Date(t.started_at).getHours();
        expect(h).toBeGreaterThanOrEqual(7);     // daytime and evening driving only
        expect(h).toBeLessThanOrEqual(21);
        const eff = t.miles / t.kwh_est;
        expect(eff).toBeGreaterThan(2.5);        // a pickup's mi/kWh
        expect(eff).toBeLessThan(4.6);
        expect(t.simulated).toBe(0);
        expect(Date.parse(t.ended_at)).toBeLessThan(NOW.getTime());
        expect(t.start_stop_id).toBeTruthy();
        expect(t.end_stop_id).toBeTruthy();
      }
      expect(trips.some((t) => t.miles > 100)).toBe(true);   // the weekend away
      const firstDay = new Date(trips[0].started_at);
      expect((NOW.getTime() - firstDay.getTime()) / 86400_000).toBeGreaterThan(20);
      // Stops are named after places, never addresses.
      const names = (db.prepare('SELECT DISTINCT name FROM stops').all() as { name: string | null }[]).map((r) => r.name);
      expect(names).not.toContain(null);
      for (const n of names) expect(n).not.toMatch(/\d{2,} [A-Z]|\bSt\b|\bAve\b|\bRd\b/);
      // The truck is at home now, with one open stop.
      const open = db.prepare('SELECT name FROM stops WHERE departed_at IS NULL').all() as { name: string }[];
      expect(open).toEqual([{ name: 'Home' }]);
    } finally { db.close(); }
  });

  it('charges at home overnight off-peak, at a Supercharger, Electrify America and a free charger, and the totals add up', () => {
    const dir = tmp();
    seedDemo(dir, NOW);
    const db = openDb(dir);
    let sessions: ChargeSession[];
    try {
      sessions = (db.prepare('SELECT * FROM charge_sessions').all() as Record<string, unknown>[]).map((r) => ({
        id: r.id, startedAt: r.started_at, endedAt: r.ended_at, place: r.place, network: r.network, stationName: r.station_name, lat: r.lat, lon: r.lon,
        kwh: r.kwh, cost: r.cost, costSource: r.cost_source, startSoc: r.start_soc, endSoc: r.end_soc, maxKw: r.max_kw, note: r.note, source: r.source, driverId: r.driver_id, simulated: false,
      }) as ChargeSession);
    } finally { db.close(); }
    const home = sessions.filter((s) => s.place === 'home');
    expect(home.length).toBeGreaterThan(5);
    for (const s of home) {
      const h = new Date(s.startedAt).getHours();
      expect(h === 21 || h === 22).toBe(true);            // after the 4-7 pm on-peak window
      expect(s.cost! / s.kwh!).toBeCloseTo(0.1067, 3);       // the off-peak rate
    }
    expect(sessions.some((s) => s.network === 'Tesla' && s.cost! > 5)).toBe(true);
    expect(sessions.some((s) => s.network === 'Electrify America' && s.cost! > 3)).toBe(true);
    expect(sessions.some((s) => s.costSource === 'free' && s.cost === 0)).toBe(true);
    for (const s of sessions) {
      expect(s.endSoc!).toBeGreaterThan(s.startSoc!);
      expect(s.kwh!).toBeGreaterThan(((s.endSoc! - s.startSoc!) / 100) * 52.7 * 0.95);   // energy matches the % gained
    }
    const db2 = openDb(dir);
    const trips = (db2.prepare('SELECT started_at AS startedAt, miles, city_miles AS cityMiles, highway_miles AS highwayMiles FROM trips').all() as { startedAt: string; miles: number; cityMiles: number; highwayMiles: number }[]);
    db2.close();
    const st = loadSettings(migrateSettings(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))));
    const rows = summarize(sessions, trips, 'month', { vehicle: st.compareVehicle, priceFor: () => st.gas.manualPrice });
    const total = rows.reduce((a, r) => a + r.cost, 0);
    expect(total).toBeCloseTo(sessions.reduce((a, s) => a + (s.cost ?? 0), 0), 1);
    for (const r of rows) expect(r.gasEquivalent!).toBeGreaterThan(r.cost);   // saved money against the gas pickup
  });

  it('is idempotent: a DATA_DIR with anything in it is never touched', () => {
    const dir = tmp();
    expect(seedDemo(dir, NOW)).not.toBeNull();
    const before = Object.fromEntries(readdirSync(dir).map((f) => [f, statSync(path.join(dir, f)).mtimeMs]));
    const dbBefore = dumpDb(dir);
    expect(seedDemo(dir, NOW)).toBeNull();
    expect(dumpDb(dir)).toBe(dbBefore);
    for (const f of ['settings.json', 'media.json', 'ops.json']) expect(statSync(path.join(dir, f)).mtimeMs).toBe(before[f]);

    const other = tmp();
    writeFileSync(path.join(other, 'settings.json'), '{"truckId":"real"}');
    expect(isEmptyDataDir(other)).toBe(false);
    expect(seedDemo(other, NOW)).toBeNull();
    expect(readdirSync(other)).toEqual(['settings.json']);
    expect(readFileSync(path.join(other, 'settings.json'), 'utf8')).toBe('{"truckId":"real"}');
  });

  it('writes nothing personal: generic drivers, invented services, no owner names or LAN addresses', () => {
    const dir = tmp();
    seedDemo(dir, NOW);
    // (radio.kjefUrl is the setting's name, not a value: it holds an invented stream here)
    for (const f of ['settings.json', 'media.json', 'ops.json']) expect(readFileSync(path.join(dir, f), 'utf8').replace(/"kjefUrl"/g, '')).not.toMatch(PERSONAL);
    expect(dumpDb(dir)).not.toMatch(PERSONAL);
    const st = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    expect(st.drivers.map((d: { name: string }) => d.name)).toEqual(['Alex', 'Sam', 'Guest']);
    expect(st.drivers.every((d: { tracker: unknown }) => d.tracker === null)).toBe(true);
    expect(st.homeAssistant.url).toBe(DEMO_HA_URL);
    const media = JSON.parse(readFileSync(path.join(dir, 'media.json'), 'utf8'));
    expect(media.wopr.url).toBe(DEMO_WOPR_URL);
    expect(media.plex.url).toBeNull();
    const ops = JSON.parse(readFileSync(path.join(dir, 'ops.json'), 'utf8'));
    expect(ops.setup.done).toBe(true);            // no first-run wizard
    expect(ops.backup.target.kind).toBe('none');
  });

  it('plans a weekend away and weekday commutes', () => {
    let n = 1;
    const plan = buildPlan(NOW, () => ((n = (n * 16807) % 2147483647) / 2147483647));
    const drives = plan.filter((p) => p.kind === 'drive') as { to: string; driver: string }[];
    expect(drives.some((d) => d.to === 'supercharger')).toBe(true);
    expect(drives.filter((d) => d.to === 'office').length).toBeGreaterThan(8);
    expect(new Set(drives.map((d) => d.driver))).toEqual(new Set(['alex', 'sam']));
  });
});

describe('demo integration gate', () => {
  const fakeReal = () => {
    const calls: string[] = [];
    const real = (async (input: RequestInfo | URL) => { calls.push(String(input instanceof Request ? input.url : input)); return new Response('{"real":true}'); }) as typeof fetch;
    return { calls, real };
  };

  it('answers the invented services itself and never lets them through', async () => {
    const { calls, real } = fakeReal();
    const f = demoFetch(real, demoBackend(makeDemoServices(() => NOW.getTime())));
    const states = await (await f(`${DEMO_HA_URL}/api/states`)).json() as { entity_id: string }[];
    expect(states.map((s) => s.entity_id)).toContain('cover.garage_door');
    const cal = await (await f(`${DEMO_WOPR_URL}/api/calendar?timeMin=2026-11-07T00:00:00Z&timeMax=2026-11-09T00:00:00Z`)).json() as { events: { title: string }[] };
    expect(cal.events.length).toBeGreaterThan(0);
    const sp = await (await f('https://api.spotify.com/v1/me/player')).json() as { item: { name: string } };
    expect(sp.item.name).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('blocks every real integration, LAN device and push service', async () => {
    const { calls, real } = fakeReal();
    const f = demoFetch(real, async () => null);
    for (const u of [
      'http://homeassistant.local:8123/api/states', 'http://192.168.1.10:8123/api/', 'https://wopr.example.com/api/calendar',
      'https://api.spotify.com/v1/me/player', 'https://accounts.spotify.com/api/token', 'http://192.168.1.30:32400/library/sections',
      'https://ntfy.sh/truck', 'https://api.github.com/repos/x/y/releases', 'https://radio.jeffraben.com/stream.mp3',
      'https://graph.microsoft.com/v1.0/me/events', 'https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json', 'http://192.168.4.50:1817/run',
    ]) {
      await expect(f(u), u).rejects.toThrow(/fetch failed/);
    }
    expect(calls).toEqual([]);
  });

  it('lets loopback and public, account-free data through', async () => {
    const { calls, real } = fakeReal();
    const f = demoFetch(real, async () => null);
    await f('http://127.0.0.1:1984/api/frame.jpeg');
    await f('https://api.weather.gov/points/33.5,-112');
    await f('https://de1.api.radio-browser.info/json/stations');
    expect(calls).toHaveLength(3);
    expect(allowedHost('localhost')).toBe(true);
    expect(allowedHost('[::1]')).toBe(true);
    expect(allowedHost('evil.api.weather.gov.example.com')).toBe(false);
    expect(allowedHost('192.168.1.20')).toBe(false);
  });

  it('names the commands it refuses', () => {
    expect(commandName('/usr/bin/ssh -o BatchMode=yes')).toBe('ssh');
    expect(commandName('C:\\Windows\\System32\\curl.exe')).toBe('curl');
    for (const c of ['ssh', 'rsync', 'nmcli', 'systemctl', 'librespot']) expect(BLOCKED_COMMANDS.has(c)).toBe(true);
    for (const c of ['ffmpeg', 'go2rtc']) expect(BLOCKED_COMMANDS.has(c)).toBe(false);   // the camera pipeline runs as normal
  });

  it('once installed, closes the whole process: fetch, WebSocket, raw sockets and commands', () => {
    // In a child process: the gate patches process-wide built-ins.
    const dir = tmp();
    const gate = new URL('../src/demo/gate.ts', import.meta.url).href;
    const script = path.join(dir, 'probe.mts');
    writeFileSync(script, `
      import { installDemoGate } from ${JSON.stringify(gate)};
      import net from 'node:net';
      import { execFile } from 'node:child_process';
      installDemoGate(async () => null);
      const out = {};
      try { await fetch('https://wopr.example.com/api/calendar'); out.fetch = 'open'; } catch (e) { out.fetch = String(e.cause?.message ?? e); }
      try { new WebSocket('ws://homeassistant.local:8123/api/websocket'); out.ws = 'open'; } catch (e) { out.ws = String(e.message); }
      out.net = await new Promise((res) => { const s = net.connect(1883, '192.168.1.20'); s.on('error', (e) => res(e.message)); s.on('connect', () => res('open')); });
      out.ssh = await new Promise((res) => execFile('ssh', ['nas', 'ls'], (e) => res(e ? e.message : 'ran')));
      console.log(JSON.stringify(out));
    `);
    const raw = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], { encoding: 'utf8', timeout: 15_000 });
    const out = JSON.parse(raw.trim().split('\n').pop()!);
    expect(out.fetch).toMatch(/blocked in DEMO/);
    expect(out.ws).toMatch(/blocked in DEMO/);
    expect(out.net).toMatch(/blocked in DEMO/);
    expect(out.ssh).toMatch(/blocked in DEMO/);
  });
});

describe('invented services', () => {
  it('a house with the garage shut, the door locked and the thermostat cooling to 76', async () => {
    const svc = makeDemoServices(() => NOW.getTime());
    const tiles = svc.house.states().map(tileFor);
    const t = (id: string) => tiles.find((x) => x.entity === id)!;
    expect(t('cover.garage_door').state).toBe('closed');
    expect(t('lock.front_door').state).toBe('locked');
    expect(t('climate.thermostat').detail).toBe('Cooling to 76°');
    expect(t('light.porch').state).toBe('on');           // 6 pm: the porch light is on
    expect(t('camera.backyard').state).toBe('recording');
    expect(svc.house.call('lock', 'unlock', 'lock.front_door')).toBe(true);
    expect(svc.house.state('lock.front_door')!.state).toBe('unlocked');
  });

  it('the next appointment is the tire rotation at 3:30 pm, and two letters came', () => {
    const svc = makeDemoServices(() => NOW.getTime());
    const next = pickNextAppointment(svc.wopr.events(), NOW.getTime())!;
    expect(next.title).toBe('Tire rotation');
    expect(next.location).toBe('Discount Tire');
    expect(new Date(next.start).getHours()).toBe(15);
    expect(new Date(next.start).getMinutes()).toBe(30);
    expect(svc.wopr.usps().mailCount).toBe(2);
  });

  it('plays invented music with a moving position', () => {
    let t = NOW.getTime();
    const svc = makeDemoServices(() => t);
    const a = svc.spotify.player();
    t += 10_000;
    const b = svc.spotify.player();
    expect(b.progress_ms - a.progress_ms).toBe(10_000);
    expect(a.is_playing).toBe(true);
    expect(a.device.name).toBe('Slate Truck');
    svc.spotify.command('POST', '/me/player/next');
    expect(svc.spotify.player().item.name).not.toBe(a.item.name);
    expect(JSON.stringify(a)).not.toMatch(PERSONAL);
  });

  it('lists public chargers near the truck', async () => {
    const r = await ocmAnswer(new URL('https://api.openchargemap.io/v3/poi?latitude=33.5&longitude=-111.98&distance=25')).json() as { AddressInfo: { Title: string } }[];
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r.map((x) => x.AddressInfo.Title).join(' ')).toMatch(/Supercharger/);
  });
});

describe('location chip', () => {
  it('names a neighbourhood when stopped and a freeway with direction at speed, never an address', () => {
    expect(demoArea({ lat: 33.4990, lon: -111.9800 }, 0, 180)).toBe('Arcadia, Phoenix');
    expect(demoArea({ lat: 33.4255, lon: -111.96 }, 62, 270)).toBe('Loop 202 W near Downtown Tempe');
    expect(demoArea({ lat: 33.4482, lon: -112.05 }, 58, 270)).toMatch(/^I-10 W near /);
    expect(demoArea({ lat: 33.4255, lon: -111.96 }, 20, 270)).toBe('Downtown Tempe');
    expect(demoArea(null, null, null)).toBeNull();
    for (let lat = 33.42; lat < 33.52; lat += 0.01) for (let lon = -112.08; lon < -111.92; lon += 0.01) {
      expect(demoArea({ lat, lon }, 30, 90)).not.toMatch(/\d{3,}|\bSt\b|\bAve\b|\bRd\b/);
    }
  });
});

describe('charge level on a demo truck', () => {
  it("reads like the truck's own (CAN) and still follows the miles driven", () => {
    const m = new SocModel();
    m.setCan(70);
    m.addMiles(10, 3.5, 52.7);
    expect(m.value).toBe(70);                       // a real CAN reading is never overridden
    m.addMiles(10, 3.5, 52.7, new Date(), { canFollows: true });
    expect(m.value).toBeLessThan(70);
    expect(m.source).toBe('can');
  });
});
