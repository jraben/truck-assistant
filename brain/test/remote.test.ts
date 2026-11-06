import { describe, expect, it } from 'vitest';
import { AlertEngine, inQuietHours, miles, type AlertInput } from '../src/remote/alerts.ts';
import { PowerManager, VIEWER_TTL_MS } from '../src/remote/power.ts';
import { theftCheck } from '../src/remote/theft.ts';
import { defaultRemote, maskRemote, mergeRemote, RemoteSettingsError, loadRemote } from '../src/remote/store.ts';
import { parseWatch, watchCommand } from '../src/remote/watch.ts';
import { allowed, ipInNets, tokenFrom } from '../src/remote/auth.ts';
import { haNotifyBody, Notifier, ntfyHeaders } from '../src/remote/notify.ts';
import { defaultSettings, mergeSettings } from '../src/settings.ts';

const HOME = { lat: 33.4990, lon: -111.9800 };
/** ~0.0018° of latitude is 200 m. */
const north = (m: number) => ({ lat: HOME.lat + m / 111_320, lon: HOME.lon });

function input(over: Partial<AlertInput> = {}): AlertInput {
  return { now: 0, parked: true, cabinTempF: 75, aux12v: 12.6, tpms: [], truckboxOnline: true, truckboxOfflineSince: null, motion: null, theft: null, position: HOME, soc: null, pluggedIn: null, ...over };
}

describe('alert engine', () => {
  it('cabin too hot: holds for the debounce, fires once, repeats only after the cooldown', () => {
    const e = new AlertEngine(defaultRemote(false).alerts);   // 95°F, hold 60 s, cooldown 30 min
    expect(e.evaluate(input({ now: 0, cabinTempF: 101 }))).toEqual([]);
    expect(e.evaluate(input({ now: 59_000, cabinTempF: 101 }))).toEqual([]);
    const f = e.evaluate(input({ now: 60_000, cabinTempF: 101 }));
    expect(f.map((x) => x.kind)).toEqual(['cabinHot']);
    expect(f[0].title).toBe('Cabin 101°F');
    expect(f[0].priority).toBe('high');
    expect(e.evaluate(input({ now: 20 * 60_000, cabinTempF: 103 }))).toEqual([]);
    expect(e.evaluate(input({ now: 31 * 60_000, cabinTempF: 103 })).map((x) => x.kind)).toEqual(['cabinHot']);
  });

  it('a dip below the threshold resets the hold (debounce)', () => {
    const e = new AlertEngine(defaultRemote(false).alerts);
    e.evaluate(input({ now: 0, cabinTempF: 99 }));
    e.evaluate(input({ now: 30_000, cabinTempF: 90 }));
    expect(e.evaluate(input({ now: 70_000, cabinTempF: 99 }))).toEqual([]);
    expect(e.evaluate(input({ now: 130_000, cabinTempF: 99 })).length).toBe(1);
  });

  it('a rule turned off never fires; thresholds come from the settings', () => {
    const s = defaultRemote(false).alerts;
    s.rules.cabinHot.enabled = false;
    s.rules.low12v.threshold = 12.2; s.rules.low12v.holdSec = 0;
    const e = new AlertEngine(s);
    const f = e.evaluate(input({ cabinTempF: 130, aux12v: 12.1 }));
    expect(f.map((x) => x.kind)).toEqual(['low12v']);
  });

  it('low 12V only counts while parked (cranking dips are not a flat battery)', () => {
    const s = defaultRemote(false).alerts; s.rules.low12v.holdSec = 0;
    const e = new AlertEngine(s);
    expect(e.evaluate(input({ parked: false, aux12v: 11.2 }))).toEqual([]);
    expect(e.evaluate(input({ now: 1000, parked: true, aux12v: 11.2 })).map((x) => x.kind)).toEqual(['low12v']);
  });

  it('motion while parked fires with its cooldown; not while driving', () => {
    const e = new AlertEngine(defaultRemote(false).alerts);   // cooldown 15 min
    const m = { camera: 'Rear', how: 'Vibration (truck box)' };
    expect(e.evaluate(input({ parked: false, motion: m }))).toEqual([]);
    expect(e.evaluate(input({ now: 1000, motion: m }))[0].message).toContain('saving a clip from Rear');
    expect(e.evaluate(input({ now: 60_000, motion: m }))).toEqual([]);
    expect(e.evaluate(input({ now: 16 * 60_000, motion: m })).length).toBe(1);
  });

  it('tire pressure and truck box offline', () => {
    const s = defaultRemote(false).alerts; s.rules.tirePressure.holdSec = 0;
    const e = new AlertEngine(s);
    const f = e.evaluate(input({ tpms: [{ wheel: 'fl', psi: 36 }, { wheel: 'rr', psi: 24 }] }));
    expect(f[0].kind).toBe('tirePressure');
    expect(f[0].message).toContain('RR 24 psi');
    const off = new AlertEngine(defaultRemote(false).alerts);   // 120 min
    expect(off.evaluate(input({ now: 60 * 60_000, truckboxOnline: false, truckboxOfflineSince: 0 }))).toEqual([]);
    expect(off.evaluate(input({ now: 121 * 60_000, truckboxOnline: false, truckboxOfflineSince: 0 }))[0].kind).toBe('truckboxOffline');
  });

  it('geofence: leaving a zone inside the quiet hours', () => {
    const s = defaultRemote(false).alerts;
    s.rules.geofence.enabled = true;
    s.geofence.zones = [{ name: 'Home', lat: HOME.lat, lon: HOME.lon, radiusM: 150 }];
    const night = new Date(2027, 4, 1, 23, 30).getTime(), day = new Date(2027, 4, 2, 14, 0).getTime();
    const e = new AlertEngine(s);
    e.evaluate(input({ now: night, position: HOME }));
    expect(e.evaluate(input({ now: night + 60_000, position: north(400) })).map((x) => x.kind)).toEqual(['geofence']);
    const d = new AlertEngine(s);
    d.evaluate(input({ now: day, position: HOME }));
    expect(d.evaluate(input({ now: day + 60_000, position: north(400) }))).toEqual([]);
    expect(inQuietHours(new Date(2027, 0, 1, 3, 0).getTime(), '22:00', '06:00')).toBe(true);
    expect(inQuietHours(new Date(2027, 0, 1, 12, 0).getTime(), '22:00', '06:00')).toBe(false);
  });

  it('charging: done at the target, stopped early when the level stalls, unplugged from HA', () => {
    const s = defaultRemote(false).alerts;   // target 80 %, stall 10 min
    const e = new AlertEngine(s);
    e.evaluate(input({ now: 0, soc: 60 }));
    e.evaluate(input({ now: 60_000, soc: 61 }));
    expect(e.evaluate(input({ now: 120_000, soc: 80 })).map((x) => x.kind)).toEqual(['chargeDone']);
    const st = new AlertEngine(s);
    st.evaluate(input({ now: 0, soc: 50 }));
    st.evaluate(input({ now: 60_000, soc: 51 }));
    expect(st.evaluate(input({ now: 5 * 60_000, soc: 51 }))).toEqual([]);
    expect(st.evaluate(input({ now: 11 * 60_000 + 1, soc: 51 })).map((x) => x.kind)).toEqual(['chargeStopped']);
    const u = new AlertEngine(s);
    u.evaluate(input({ pluggedIn: true }));
    expect(u.evaluate(input({ now: 1000, pluggedIn: false, soc: 70 }))[0].message).toBe('The charger was unplugged at 70%.');
  });
});

describe('theft: moved without a driver', () => {
  const base = { park: HOME, ignition: false, radiusM: 200 };
  it('within the radius is fine', () => {
    expect(theftCheck({ ...base, pos: north(150), driversNear: [] }).kind).toBe('ok');
  });
  it('moved with no driver phone nearby is theft', () => {
    const v = theftCheck({ ...base, pos: north(400), driversNear: [] });
    expect(v.kind).toBe('theft');
    expect(v.movedM).toBeGreaterThan(390);
  });
  it('moved with a driver phone at the truck is a drive (re-arm)', () => {
    expect(theftCheck({ ...base, ignition: true, pos: north(400), driversNear: ['Jeff'] })).toMatchObject({ kind: 'drive', drivers: ['Jeff'] });
  });
  it('ignition on with no phone nearby is still theft', () => {
    expect(theftCheck({ ...base, ignition: true, pos: north(400), driversNear: [] })).toMatchObject({ kind: 'theft', why: 'with the ignition on and no driver phone nearby' });
  });
  it('without Home Assistant: alert only with the ignition off', () => {
    expect(theftCheck({ ...base, pos: north(400), driversNear: null }).kind).toBe('theft');
    expect(theftCheck({ ...base, ignition: true, pos: north(400), driversNear: null }).kind).toBe('ok');
  });
  it('not armed, or no position: nothing', () => {
    expect(theftCheck({ ...base, park: null, pos: north(900), driversNear: [] }).kind).toBe('ok');
    expect(theftCheck({ ...base, pos: null, driversNear: [] }).kind).toBe('ok');
  });
});

describe('viewers and auto-sleep', () => {
  const clock = () => { let t = 1_000_000; return { now: () => t, add: (ms: number) => { t += ms; } }; };
  const opts = { sleepAfterMin: 10, maxAwakeMin: 60, busy: null };

  it('a remote wake sleeps after N minutes with no viewer', () => {
    const c = clock(); const p = new PowerManager(c.now);
    p.observe(false, true);
    expect(p.awakeReason).toBe('remote');
    c.add(9 * 60_000);
    expect(p.decide(opts).action).toBe('none');
    c.add(61_000);
    const d = p.decide(opts);
    expect(d.action).toBe('sleep');
    expect(d.why).toBe('No viewer for 10 min');
  });

  it('a viewer keeps it up; the clock restarts when they leave', () => {
    const c = clock(); const p = new PowerManager(c.now);
    p.observe(false, null);
    c.add(8 * 60_000); p.ping('phone');
    c.add(5 * 60_000); p.ping('phone');
    expect(p.decide(opts)).toMatchObject({ action: 'none', viewers: 1 });
    c.add(VIEWER_TTL_MS + 1000);
    expect(p.decide(opts).viewers).toBe(0);
    c.add(10 * 60_000);
    expect(p.decide(opts).action).toBe('sleep');
  });

  it('an open stream counts as a viewer until closed', () => {
    const c = clock(); const p = new PowerManager(c.now);
    p.observe(false, null);
    const close = p.openStream();
    c.add(30 * 60_000);
    expect(p.decide(opts)).toMatchObject({ action: 'none', viewers: 1 });
    close();
    c.add(10 * 60_000 + 1);
    expect(p.decide(opts).action).toBe('sleep');
  });

  it('the hard limit wins over viewers', () => {
    const c = clock(); const p = new PowerManager(c.now);
    p.observe(false, null);
    for (let i = 0; i < 61; i++) { c.add(60_000); p.ping('phone'); }
    expect(p.decide(opts)).toMatchObject({ action: 'sleep', why: 'Awake 60 min (the limit)' });
  });

  it('never while the ignition is on, never while busy, and not before the reason is known', () => {
    const c = clock(); const p = new PowerManager(c.now);
    c.add(3600_000);
    expect(p.decide(opts).action).toBe('none');   // unknown
    p.observe(true, null);
    c.add(3600_000);
    expect(p.decide(opts)).toMatchObject({ action: 'none', awakeReason: 'ignition' });
    p.observe(false, null);   // after a drive the power board handles shutdown
    c.add(3600_000);
    expect(p.decide(opts).awakeReason).toBe('ignition');
    const q = new PowerManager(c.now);
    q.observe(false, null);
    c.add(11 * 60_000);
    expect(q.decide({ ...opts, busy: 'cutting a dashcam clip' })).toMatchObject({ action: 'none', why: 'Staying up: cutting a dashcam clip' });
  });
});

describe('remote settings', () => {
  it('desk defaults: four test cameras, front and rear recorded, a token', () => {
    const s = defaultRemote(true);
    expect(s.cams.cameras.map((c) => [c.id, c.source, c.record])).toEqual([['rear', 'test', true], ['front', 'test', true], ['bed', 'test', false], ['surround', 'test', false]]);
    expect(s.remote.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('secrets are masked; a masked value keeps the stored one; "" removes it', () => {
    let s = mergeRemote(defaultRemote(false), { lte: { apn: 'fast.t-mobile.com', password: 'pw-123456' }, alerts: { delivery: { ntfy: { topic: 'slate-x91', token: 'tk_abcdef' } } } });
    const m = maskRemote(s);
    expect(m.lte.password).toBe('••••3456');
    expect(m.alerts.delivery.ntfy.token).toBe('••••cdef');
    expect(m.remote.token).toMatch(/^••••/);
    s = mergeRemote(s, m);   // the page sends the masked values back
    expect(s.lte.password).toBe('pw-123456');
    expect(s.alerts.delivery.ntfy.token).toBe('tk_abcdef');
    s = mergeRemote(s, { lte: { password: '' } });
    expect(s.lte.password).toBeUndefined();
    const tok = s.remote.token;
    expect(mergeRemote(s, { remote: { token: 'new' } }).remote.token).not.toBe(tok);
  });

  it('validates cameras and alert thresholds', () => {
    const base = defaultRemote(false);
    expect(() => mergeRemote(base, { cams: { cameras: [{ id: 'Rear Cam', name: 'x', role: 'rear', source: 'test' }] } })).toThrow(RemoteSettingsError);
    expect(() => mergeRemote(base, { cams: { cameras: [{ id: 'rear', name: 'Rear', role: 'rear', source: 'uvc', device: 'video0' }] } })).toThrow(/\/dev path/);
    expect(() => mergeRemote(base, { alerts: { rules: { cabinHot: { threshold: 300 } } } })).toThrow(/60 to 160/);
    const s = mergeRemote(base, { alerts: { delivery: { ha: { service: 'mobile_app_jeffs_iphone' } } } });
    expect(s.alerts.delivery.ha.service).toBe('notify.mobile_app_jeffs_iphone');
  });

  it('a file with missing pieces loads with defaults filled in', () => {
    const s = loadRemote({ dashcam: { capGb: 128 }, cams: { cameras: [{ id: 'rear', name: 'Rear', role: 'rear', source: 'capture', device: '/dev/v4l/by-id/usb-AHD-video-index0' }] } }, false);
    expect(s.dashcam).toMatchObject({ capGb: 128, segmentSec: 60, preSec: 60, postSec: 30 });
    expect(s.cams.cameras[0]).toMatchObject({ width: 1280, enabled: true, record: false });
    expect(s.alerts.rules.theft.threshold).toBe(200);
  });
});

describe('tier 1 watch topics', () => {
  it('parses a state report', () => {
    const e = parseWatch('state', JSON.stringify({ ts: 1_800_000_000, fix: true, lat: 33.5, lon: -111.9, gps_at: 1_800_000_000, v12: 12.41, cabin_f: 88.5, vib: 2, moved: false, ign: false, pi: false, rssi: -91, batt_mv: 3990, fw: 'watch-0.1.0' }));
    expect(e).toMatchObject({ type: 'state', patch: { fix: true, lat: 33.5, lon: -111.9, aux12v: 12.41, cabinTempF: 88.5, vibration: 2, ignition: false, piAwake: false, rssi: -91, backupMv: 3990, lastSeen: '2027-01-15T08:00:00.000Z' } });
  });
  it('no fix keeps the last position (no lat/lon in the patch)', () => {
    const e = parseWatch('state', '{"ts":1800000000,"fix":false,"lat":0,"lon":0,"v12":12.5}');
    expect(e?.type === 'state' && 'lat' in e.patch).toBe(false);
  });
  it('status, alerts, junk', () => {
    expect(parseWatch('status', 'offline')).toEqual({ type: 'status', online: false });
    expect(parseWatch('alert', '{"kind":"theft","title":"Truck moved","message":"412 m","ts":1800000000}')).toMatchObject({ type: 'alert', kind: 'theft', title: 'Truck moved' });
    expect(parseWatch('alert', '{"kind":"zzz","title":"x"}')).toMatchObject({ kind: 'other' });
    expect(parseWatch('state', 'not json')).toBeNull();
    expect(parseWatch('command', '{}')).toBeNull();
    expect(JSON.parse(watchCommand.relay('relay_2', true))).toEqual({ relay: 'relay_2', on: true });
  });
});

describe('remote auth', () => {
  it('trusted networks', () => {
    expect(ipInNets('127.0.0.1', ['127.0.0.0/8', '::1'])).toBe(true);
    expect(ipInNets('::ffff:127.0.0.1', ['127.0.0.0/8'])).toBe(true);
    expect(ipInNets('::1', ['127.0.0.0/8', '::1'])).toBe(true);
    expect(ipInNets('100.101.7.9', ['127.0.0.0/8', '::1'])).toBe(false);
    expect(ipInNets('10.42.0.23', ['10.42.0.0/24'])).toBe(true);
    expect(ipInNets('10.42.1.23', ['10.42.0.0/24'])).toBe(false);
  });
  it('token from header, bearer, query or cookie', () => {
    const r = (headers: Record<string, string>, query?: Record<string, string>) => ({ ip: '100.64.1.2', headers, query });
    expect(tokenFrom(r({ 'x-slate-token': 'a' }))).toBe('a');
    expect(tokenFrom(r({ authorization: 'Bearer b' }))).toBe('b');
    expect(tokenFrom(r({}, { token: 'c' }))).toBe('c');
    expect(tokenFrom(r({ cookie: 'x=1; slate_remote=d%3D' }))).toBe('d=');
    expect(allowed(r({ 'x-slate-token': 'secret' }), 'secret', ['127.0.0.0/8'])).toBe(true);
    expect(allowed(r({ 'x-slate-token': 'wrong!' }), 'secret', ['127.0.0.0/8'])).toBe(false);
    expect(allowed(r({}), 'secret', ['127.0.0.0/8'])).toBe(false);
    expect(allowed({ ip: '127.0.0.1', headers: {} }, 'secret', ['127.0.0.0/8'])).toBe(true);
  });
});

describe('alert delivery', () => {
  const out = { kind: 'theft', title: 'Truck moved', message: 'It moved 412 m.', priority: 'high' as const, clickUrl: null };
  it('HA notify body and ntfy headers', () => {
    expect(haNotifyBody(out)).toEqual({ title: 'Truck moved', message: 'It moved 412 m.', data: { tag: 'slate-theft', group: 'slate-truck', push: { 'interruption-level': 'time-sensitive' }, priority: 'high', ttl: 0 } });
    expect(ntfyHeaders(out, 'tk')).toMatchObject({ title: 'Truck moved', priority: '4', tags: 'warning,truck', authorization: 'Bearer tk' });
    expect(ntfyHeaders({ ...out, title: 'Cabin 98°F' }).title).toBe(`=?UTF-8?B?${Buffer.from('Cabin 98°F').toString('base64')}?=`);
  });

  it('HA first, ntfy when HA fails, a reason when neither is set', async () => {
    const calls: string[] = [];
    const n = new Notifier(async (url) => { calls.push(url); return { ok: !url.includes('ha.local'), status: url.includes('ha.local') ? 500 : 200 }; });
    const main = mergeSettings(defaultSettings(), { homeAssistant: { url: 'http://ha.local:8123', token: 'abc' } });
    const a = mergeRemote(defaultRemote(false), { alerts: { delivery: { ha: { service: 'notify.mobile_app_jeff' }, ntfy: { topic: 'slate-x91' } } } }).alerts;
    const r = await n.send(out, main, a);
    expect(calls).toEqual(['http://ha.local:8123/api/services/notify/mobile_app_jeff', 'https://ntfy.sh/slate-x91']);
    expect(r).toEqual({ delivered: ['ntfy'], error: 'Home Assistant answered 500' });
    const none = await new Notifier(async () => ({ ok: true, status: 200 })).send(out, defaultSettings(), defaultRemote(false).alerts);
    expect(none.delivered).toEqual([]);
    expect(none.error).toContain('no delivery set up');
  });
});

describe('alert text: miles and place names, not meters and coordinates', () => {
  it('formats distances in miles (feet under a tenth)', () => {
    expect(miles(483)).toBe('0.3 mi');
    expect(miles(40)).toBe('130 ft');
    expect(miles(32_000)).toBe('20 mi');
  });
  it('the theft alert names the place and has no coordinates', () => {
    const e = new AlertEngine(defaultRemote(false).alerts);
    const out = e.evaluate(input({ theft: { movedM: 805, at: { lat: 33.5, lon: -111.9 }, place: 'Fashion Square', why: 'with no driver phone nearby' } }));
    const t = out.find((f) => f.kind === 'theft')!;
    expect(t.message).toContain('0.5 mi');
    expect(t.message).toContain('at Fashion Square');
    expect(t.message).not.toMatch(/-?\d+\.\d{4,}/);
    expect(t.message).not.toMatch(/\d m/);
  });
});
