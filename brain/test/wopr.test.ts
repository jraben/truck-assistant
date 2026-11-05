import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractSentences, KEEPALIVE_MARKER, MarkerStripper, notDoneLine, SEARCH_MARKER, speakable, splitActions, stripMarkers } from '../src/wopr/stream.ts';
import { buildMessages, buildPrimer, stripIds, truckBlock, type TruckContext } from '../src/wopr/primer.ts';
import { appointmentLine, drivableLocation, parseGraphTime, pickNextAppointment, wazeSearchUrl } from '../src/wopr/calendar.ts';
import { parseWhere } from '../src/wopr/gate.ts';
import { authHeader } from '../src/wopr/client.ts';
import { WoprService, type BrainView } from '../src/wopr/service.ts';
import { MediaSettingsStore } from '../src/media/settings.ts';
import type { State } from '../src/types.ts';

describe('stream markers (same as WOPR WoprChat.stripMarkers)', () => {
  it('removes both markers and a half-sent one at the end', () => {
    expect(stripMarkers(`${SEARCH_MARKER}Hello${KEEPALIVE_MARKER} there`)).toBe('Hello there');
    expect(stripMarkers('Hi [[WOPR_SEA')).toBe('Hi ');
    expect(stripMarkers('Hi [[W')).toBe('Hi ');
    expect(stripMarkers('a [[link]] b')).toBe('a [[link]] b');
  });
  it('MarkerStripper holds a marker split across chunks and flags searching', () => {
    const s = new MarkerStripper();
    const parts = ['Let me ', 'look. [[WO', 'PR_SEARCH]]', 'Found it', '[[WOPR_KEEP', 'ALIVE]]', '. Done [[', 'x'];
    const out = parts.map((p) => s.push(p)).join('') + s.end();
    expect(out).toBe('Let me look. Found it. Done [[x');
    expect(s.searching).toBe(true);
    const t = new MarkerStripper();
    expect(t.push('end [[WOPR_KEEPAL') + t.end()).toBe('end ');
  });
  it('splitActions takes out action JSON, nested braces included, and drops a half-streamed one', () => {
    const r = splitActions('Added it. {"action":"calendarSync","op":"create","event":{"title":"X"}} See you.');
    expect(r.clean).toBe('Added it.  See you.');
    expect(r.actions).toEqual([{ action: 'calendarSync', op: 'create', event: { title: 'X' } }]);
    expect(splitActions('Sure. {"action":"taskSync","task":{"ti').clean).toBe('Sure.');
    expect(notDoneLine(r.actions)).toMatch(/calendarSync/);
    expect(notDoneLine([])).toBeNull();
  });
  it('extractSentences splits on sentence ends and flushes long runs', () => {
    const a = extractSentences('One. Two! Three', 0);
    expect(a.sentences).toEqual(['One.', 'Two!']);
    const b = extractSentences('One. Two! Three?', a.newIdx);
    expect(b.sentences).toEqual(['Three?']);
    const long = 'word '.repeat(60);
    const c = extractSentences(long, 0);
    expect(c.sentences.length).toBe(1);
    expect(c.newIdx).toBeLessThanOrEqual(201);
  });
  it('speakable strips markdown', () => {
    expect(speakable('**Hi** there, see [the map](https://x.y/z).\n- one\n- two')).toBe('Hi there, see the map. one two');
  });
});

const ctx = (o: Partial<TruckContext> = {}): TruckContext => ({
  now: new Date(2026, 10, 5, 14, 4), driver: 'Jeff', place: null, gps: { lat: 33.4942, lon: -111.9261 }, speedMph: 42, soc: 61.4, socSource: 'estimate', rangeMi: 112,
  next: { id: 'e1', title: 'Pickup Barney', start: new Date(2026, 10, 5, 14, 30).toISOString(), end: new Date(2026, 10, 5, 15, 0).toISOString(), location: 'Scottsdale Airport', wazeUrl: null },
  nowPlaying: { title: 'Weird Science', artist: 'Oingo Boingo', source: 'radio' }, network: "JEFF'S HOTSPOT", woprContext: '', ...o,
});

describe('truck primer', () => {
  it('has the time, the truck block and WOPR context without action ids', () => {
    const p = buildPrimer(ctx({ woprContext: '[CALENDAR — next 7 days]\n  Thu, Nov 5 · 2:00 PM · Pickup Barney  [id:AAMk=]\n[SHOPPING LIST]\n  Costco: milk [abc123xyz]' }));
    expect(p).toMatch(/^Current time: Thursday, November 5, 2026 at 2:04 PM/);
    expect(p).toMatch(/CANNOT change anything/);
    expect(p).toContain('Driving, about 42 mph');
    expect(p).toContain('Battery: 61% (estimated), range about 112 miles');
    expect(p).toContain('Next stop (calendar): 2:30 PM · Pickup Barney @ Scottsdale Airport');
    expect(p).toContain('Playing (radio): Weird Science by Oingo Boingo');
    expect(p).not.toContain('[id:');
    expect(p).toContain('Costco: milk');
    expect(p).not.toContain('abc123xyz');
  });
  it('says unknown instead of guessing', () => {
    const b = truckBlock(ctx({ gps: null, soc: null, speedMph: null, driver: null, next: null, nowPlaying: null, network: null }));
    expect(b).toContain('Driver: unknown');
    expect(b).toContain('Location: unknown');
    expect(b).toContain('Battery: unknown');
    expect(b).toContain('nothing on the calendar soon');
    expect(truckBlock(ctx({ speedMph: 0, place: 'Costco' }))).toContain('Parked at: Costco');
  });
  it('stripIds', () => expect(stripIds('a [id:1] b')).toBe('a b'));
  it('messages: primer pair, alternating, trimmed history, the question last', () => {
    const h = [{ role: 'assistant' as const, content: 'stray' }, { role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: 'a1' }, { role: 'user' as const, content: 'unanswered' }];
    const m = buildMessages('PRIMER', h, ' q2 ');
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(m[0].content).toBe('PRIMER');
    expect(m[1].content).toBe('Understood.');
    expect(m[2].content).toBe('q1');
    expect(m[4].content).toBe('q2');
    const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` }));
    expect(buildMessages('P', many, 'q').length).toBeLessThanOrEqual(2 + 12 + 1);
  });
});

describe('next appointment', () => {
  const now = Date.parse('2026-11-05T20:00:00Z');
  const ev = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, title: id, start, end, allDay: false, ...extra });
  it('parses Graph timestamps with 7 fractional digits', () => {
    expect(parseGraphTime('2026-11-05T21:00:00.0000000Z')).toBe(Date.parse('2026-11-05T21:00:00Z'));
  });
  it('skips ended, all-day and long-started events; prefers a drivable location on a tie', () => {
    const list = [
      ev('ended', '2026-11-05T18:00:00.0000000Z', '2026-11-05T19:00:00.0000000Z'),
      ev('allday', '2026-11-05', '2026-11-06', { allDay: true }),
      ev('started-long-ago', '2026-11-05T19:00:00Z', '2026-11-05T22:00:00Z'),
      ev('teams', '2026-11-05T21:00:00Z', '2026-11-05T21:30:00Z', { location: 'Microsoft Teams Meeting' }),
      ev('Pickup Barney', '2026-11-05T21:00:00.0000000Z', '2026-11-05T22:00:00.0000000Z', { location: 'Scottsdale Airport' }),
      ev('later', '2026-11-06T15:30:00Z', '2026-11-06T16:00:00Z'),
    ];
    const a = pickNextAppointment(list, now)!;
    expect(a.title).toBe('Pickup Barney');
    expect(a.location).toBe('Scottsdale Airport');
    expect(a.wazeUrl).toBe(wazeSearchUrl('Scottsdale Airport'));
    expect(a.wazeUrl).toBe('https://waze.com/ul?q=Scottsdale%20Airport&navigate=yes');
    expect(appointmentLine({ ...a, start: new Date(2026, 10, 5, 14, 0).toISOString() })).toBe('Next: 2:00 pm · Pickup Barney · Scottsdale Airport');
    expect(pickNextAppointment([ev('just started', '2026-11-05T19:50:00Z', '2026-11-05T20:30:00Z')], now)?.title).toBe('just started');
    expect(pickNextAppointment([], now)).toBeNull();
  });
  it('drivableLocation', () => {
    expect(drivableLocation('https://teams.microsoft.com/l/xyz')).toBeNull();
    expect(drivableLocation('  WestWorld of Scottsdale ')).toBe('WestWorld of Scottsdale');
    expect(drivableLocation(undefined)).toBeNull();
  });
});

describe('gate codes (WOPR /api/where text)', () => {
  it('reads codes', () => {
    const g = parseWhere('Acme Storage — Gate Code 1234#, alarm 9876 · 30m away');
    expect(g).toMatchObject({ kind: 'codes', place: 'Acme Storage', how: '30m away' });
    expect(g.codes).toEqual([{ label: 'Gate Code', value: '1234#' }, { label: 'alarm', value: '9876' }]);
    const c = parseWhere('Smith House — lockbox 4410 · from your calendar — Pickup Barney now');
    expect(c.codes).toEqual([{ label: 'lockbox', value: '4410' }]);
    expect(c.how).toBe('from your calendar — Pickup Barney now');
  });
  it('no codes, unknown spot', () => {
    expect(parseWhere('Costco (27m away) — no codes saved on that record yet.').kind).toBe('no-codes');
    expect(parseWhere("Don't know this spot (nothing saved within 250m, nothing on the calendar). Run this again…").kind).toBe('unknown');
    expect(parseWhere('No location and nothing on the calendar — cannot tell where you are.').kind).toBe('unknown');
  });
});

// ---- the service against a stand-in WOPR (nothing real is called) -----------------

class FakeBrain extends EventEmitter implements BrainView {
  s: State = {
    ts: '', speedMph: 0, soc: 70, socSource: 'manual', rangeMi: 120, gear: null, gps: { lat: 33.5, lon: -111.9, headingDeg: null, fix: true },
    ignition: false, reverse: false, cabinTempF: null, aux12v: null, tilt: null, tpms: null, relays: {}, fiveSwitch: [], trip: null, truckbox: false,
    nowPlaying: null, driver: { id: 'jeff', name: 'Jeff', initials: 'J', color: '#fff' }, driverSuggestion: null, place: null,
    network: { link: 'home', label: 'HOME WI-FI', ssid: 'x', driverId: null, signal: 90, manual: false, saveData: false, bytesThisTrip: 0, bytesThisMonth: {}, backend: 'sim', bluetooth: 'supported', error: null },
  };
  getState() { return this.s; }
}

describe('WoprService against a mock WOPR', () => {
  let server: Server; let url = ''; let tmp = '';
  const seen: { path: string; auth: string | undefined; body: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
        if (req.headers.authorization !== authHeader({ url: null, username: 'jeff', password: 'pw' })) { res.writeHead(401).end(); return; }
        if (req.url === '/api/status') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"version":"2.194.4"}'); return; }
        if (req.url?.startsWith('/api/calendar')) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ connected: true, events: [{ id: '1', title: 'Pickup Barney', start: new Date(Date.now() + 3600_000).toISOString(), end: new Date(Date.now() + 7200_000).toISOString(), allDay: false, location: 'Scottsdale Airport' }] })); return; }
        if (req.url === '/api/mobile/context') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"context":"[OPEN TASKS]\\n  [id:9] Buy filters"}'); return; }
        if (req.url === '/api/where') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Acme Storage — Gate Code 5150 · 12m away'); return; }
        if (req.url === '/api/WOPR') {
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          const parts = ['Sure', '. [[WOPR_SE', 'ARCH]]It is 72', ' degrees. [[WOPR_KEEPALIVE]]{"action":"taskSync","op":"create"}', ' Drive safe.'];
          let i = 0;
          const t = setInterval(() => { if (i < parts.length) res.write(parts[i++]); else { clearInterval(t); res.end(); } }, 5);
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    tmp = mkdtempSync(path.join(tmpdir(), 'slate-wopr-'));
  });
  afterAll(() => { server.close(); rmSync(tmp, { recursive: true, force: true }); });

  const make = (password = 'pw') => {
    const media = new MediaSettingsStore(tmp);
    media.update({ wopr: { url, username: 'jeff', password } });
    const brain = new FakeBrain();
    return { brain, svc: new WoprService(brain, media) };
  };

  it('not configured / offline are reported, not attempted', async () => {
    const media = new MediaSettingsStore(mkdtempSync(path.join(tmpdir(), 'slate-wopr-empty-')));
    const brain = new FakeBrain();
    const svc = new WoprService(brain, media);
    expect(svc.blocked()?.kind).toBe('not-configured');
    const evs = []; for await (const e of svc.chat('hi', [])) evs.push(e);
    expect(evs).toEqual([{ t: 'error', message: expect.stringMatching(/settings page/), kind: 'not-configured' }]);
    const b = make();
    b.brain.s.network = { ...b.brain.s.network, link: 'offline' };
    expect(b.svc.blocked()?.kind).toBe('offline');
  });

  it('test() proves the login; a wrong password says so', async () => {
    expect((await make().svc.test()).ok).toBe(true);
    const bad = await make('nope').svc.test();
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/refused the login/);
  });

  it('a voice turn streams text without markers, with a searching event, primer included', async () => {
    const { svc } = make();
    await svc.refreshNext();
    const evs = []; for await (const e of svc.chat('How hot is it?', [])) evs.push(e);
    const text = evs.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('');
    expect(text).not.toMatch(/\[\[WOPR/);
    expect(splitActions(text).clean).toBe('Sure. It is 72 degrees.  Drive safe.');
    expect(splitActions(text).actions[0]?.action).toBe('taskSync');
    expect(evs.some((e) => e.t === 'searching')).toBe(true);
    expect(evs[evs.length - 1]).toEqual({ t: 'done' });
    const sent = JSON.parse(seen.filter((s) => s.path === '/api/WOPR').pop()!.body);
    expect(sent).toMatchObject({ model: 'claude', voice: true });
    expect(sent.messages[0].content).toMatch(/Slate truck/);
    expect(sent.messages[0].content).toMatch(/Pickup Barney @ Scottsdale Airport/);
    expect(sent.messages[0].content).toMatch(/Buy filters/);
    expect(sent.messages[sent.messages.length - 1]).toEqual({ role: 'user', content: 'How hot is it?' });
  });

  it('next appointment comes from /api/calendar', async () => {
    const n = await make().svc.refreshNext();
    expect(n.next?.title).toBe('Pickup Barney');
    expect(n.next?.wazeUrl).toMatch(/^https:\/\/waze\.com\/ul\?q=Scottsdale/);
  });

  it('arriving at a stop looks up the gate code, keeps it in memory only, and drops it on leaving', async () => {
    const { svc, brain } = make();
    svc.start();
    brain.s.place = { stopId: 7, name: 'Acme Storage', since: new Date().toISOString() };
    brain.emit('change');
    await new Promise((r) => setTimeout(r, 300));
    const g = svc.getGate();
    expect(g?.codes).toEqual([{ label: 'Gate Code', value: '5150' }]);
    expect(g?.stopId).toBe(7);
    const where = seen.filter((s) => s.path === '/api/where').pop()!;
    expect(JSON.parse(where.body)).toEqual({ lat: 33.5, lon: -111.9 });
    // nothing on disk holds the code
    for (const f of readdirSync(tmp)) expect(readFileSync(path.join(tmp, f), 'utf8')).not.toContain('5150');
    brain.s.place = null;
    brain.emit('change');
    expect(svc.getGate()).toBeNull();
    svc.stop();
  });
});
