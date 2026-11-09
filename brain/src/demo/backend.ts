// DEMO=1: the invented services behind the gate. The brain's own clients
// (HaClient, the WOPR client, SpotifyApi, the charger finder) talk to these
// exactly as they would to the real thing, so every screen runs its real code
// path, with a house, a calendar, a mailbox and a playlist that don't exist.
//
//   http://homeassistant.demo:8123  Home Assistant REST: a small invented house
//   https://wopr.demo               WOPR: calendar, mailbox, gate codes, voice
//   api.spotify.com / accounts...   Spotify Web API: an invented playlist
//   api.openchargemap.io            public chargers near Phoenix and Sedona
//
// Nothing here reaches a network: answers are built in memory.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { metersBetween } from '../geo.ts';
import {
  coverArt, DEMO_CHARGERS, DEMO_DRIVERS, DEMO_HA_HOST, DEMO_HIGHWAYS, DEMO_TRAFFIC_CAMS, DEMO_TRAFFIC_EVENTS, DEMO_PLAYLISTS, DEMO_TRACKS, DEMO_WOPR_HOST, place,
} from './world.ts';

type Json = unknown;
const json = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200, type = 'text/plain; charset=utf-8') => new Response(body, { status, headers: { 'content-type': type } });
const notFound = () => json({ message: 'Not found' }, 404);

async function bodyJson(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  const b = init?.body;
  if (typeof b !== 'string') return {};
  try { const v = JSON.parse(b); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

// ---- the house (Home Assistant) ---------------------------------------------------

/**
 * A demo house camera's still: DEMO_FOOTAGE/home-<name>.jpg, or, when there is a
 * folder DEMO_FOOTAGE/home-<name>/ of numbered frames, one frame a second so the
 * still moves like a live snapshot. Stock pictures live in that folder, never in
 * the repo; with none, the camera answers 404 and the tile says so.
 */
function demoCameraStill(entity: string, now: number): Response {
  const dir = process.env.DEMO_FOOTAGE;
  const name = entity.replace(/^camera\./, '');
  if (!dir || !/^[a-z0-9_]+$/.test(name)) return notFound();
  const folder = path.join(dir, `home-${name}`);
  let file = path.join(dir, `home-${name}.jpg`);
  if (existsSync(folder)) {
    const frames = readdirSync(folder).filter((f) => f.endsWith('.jpg')).sort();
    if (frames.length) file = path.join(folder, frames[Math.floor(now / 1000) % frames.length]);
  }
  if (!existsSync(file)) return notFound();
  return new Response(new Uint8Array(readFileSync(file)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

type Ent = { state: string; attributes: Record<string, unknown>; changed: number };

export class DemoHouse {
  private ents = new Map<string, Ent>();
  private clock: () => number;
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
    const t = clock() - 47 * 60_000;
    const home = place('home');
    const add = (id: string, state: string, attributes: Record<string, unknown>) => this.ents.set(id, { state, attributes, changed: t });
    add('zone.home', 'zoning', { friendly_name: 'Home', latitude: home.lat, longitude: home.lon, radius: 120, passive: false });
    add('cover.garage_door', 'closed', { friendly_name: 'Garage door', device_class: 'garage' });
    add('light.garage_opener_light', 'off', { friendly_name: 'Garage light' });
    add('binary_sensor.garage_door_obstruction', 'off', { friendly_name: 'Garage door obstruction', device_class: 'problem' });
    add('lock.front_door', 'locked', { friendly_name: 'Front door' });
    add('climate.thermostat', 'cool', { friendly_name: 'Thermostat', hvac_action: 'cooling', temperature: 76, current_temperature: 77, hvac_modes: ['off', 'cool', 'heat', 'auto'] });
    add('light.porch', 'on', { friendly_name: 'Porch light', brightness: 191 });
    add('camera.backyard', 'recording', { friendly_name: 'Backyard camera' });
    add('camera.front_lawn', 'streaming', { friendly_name: 'Front lawn' });
    add('camera.garage', 'streaming', { friendly_name: 'Garage' });
    add('camera.doorbell', 'idle', { friendly_name: 'Doorbell' });
    add('light.patio', 'off', { friendly_name: 'Patio lights' });
    add('sensor.living_room_temperature', '75', { friendly_name: 'Living room', unit_of_measurement: '°F', device_class: 'temperature' });
    add('sensor.pool_temperature', '71', { friendly_name: 'Pool', unit_of_measurement: '°F', device_class: 'temperature' });
    add('switch.sprinklers', 'off', { friendly_name: 'Sprinklers' });
    add('lock.side_gate', 'locked', { friendly_name: 'Side gate' });
  }

  /** The porch light follows the evening, like an automation would. */
  private live(id: string, e: Ent): Ent {
    if (id === 'light.porch') {
      const h = new Date(this.clock()).getHours();
      const want = h >= 18 || h < 6 ? 'on' : 'off';
      if (e.state !== want && this.clock() - e.changed > 10 * 60_000) { e.state = want; e.changed = this.clock(); }
    }
    return e;
  }

  state(id: string) {
    const e = this.ents.get(id);
    if (!e) return null;
    const x = this.live(id, e);
    const iso = new Date(x.changed).toISOString();
    return { entity_id: id, state: x.state, attributes: { ...x.attributes }, last_changed: iso, last_updated: iso };
  }

  states() { return [...this.ents.keys()].map((id) => this.state(id)!); }

  /** A service call. Covers take a few seconds to travel, like the real door. */
  call(domain: string, service: string, entity: string): boolean {
    const e = this.ents.get(entity);
    if (!e || entity.split('.')[0] !== domain) return false;
    const set = (s: string) => { e.state = s; e.changed = this.clock(); };
    const on = service === 'turn_on' || (service === 'toggle' && e.state !== 'on');
    if (domain === 'cover') {
      if (service === 'open_cover' || service === 'close_cover') {
        const opening = service === 'open_cover';
        set(opening ? 'opening' : 'closing');
        setTimeout(() => { if (e.state === (opening ? 'opening' : 'closing')) set(opening ? 'open' : 'closed'); }, 9000).unref?.();
      } else if (service === 'stop_cover') set('open');
      return true;
    }
    if (domain === 'lock') { set(service === 'unlock' ? 'unlocked' : 'locked'); return true; }
    if (['light', 'switch', 'fan', 'input_boolean'].includes(domain)) { set(on ? 'on' : 'off'); return true; }
    return true;
  }

  async handle(u: URL, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const p = decodeURIComponent(u.pathname);
    if (p === '/api/' || p === '/api') return json({ message: 'API running.' });
    if (p === '/api/states') return json(this.states());
    if (p.startsWith('/api/states/')) { const s = this.state(p.slice('/api/states/'.length)); return s ? json(s) : notFound(); }
    if (p.startsWith('/api/history/')) return json([]);
    if (p.startsWith('/api/camera_proxy/')) return demoCameraStill(p.slice('/api/camera_proxy/'.length), this.clock());
    const svc = /^\/api\/services\/([a-z_]+)\/([a-z_]+)$/.exec(p);
    if (svc && method === 'POST') {
      const b = await bodyJson(init);
      const id = typeof b.entity_id === 'string' ? b.entity_id : '';
      if (svc[1] === 'notify') return json([]);          // reminders "sent": nowhere
      return this.call(svc[1], svc[2], id) ? json([]) : json({ message: `Entity ${id} not found` }, 400);
    }
    return notFound();
  }
}

// ---- WOPR: calendar, mailbox, gate codes, voice ----------------------------------

/** Today's (or tomorrow's) time, local. */
function at(now: number, dayOffset: number, h: number, m: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0);
  return d;
}

export class DemoWopr {
  private clock: () => number;
  private collectedOn: string | null = null;
  constructor(clock: () => number = Date.now) { this.clock = clock; }

  /** A tire rotation at 3:30 pm (today if it's still ahead, else tomorrow), then the next day's plans. */
  events() {
    const now = this.clock();
    const ev = (id: string, title: string, s: Date, mins: number, location?: string) => ({ id, title, start: s.toISOString(), end: new Date(s.getTime() + mins * 60_000).toISOString(), allDay: false, ...(location ? { location } : {}) });
    const tireDay = at(now, 0, 15, 30).getTime() - now > 20 * 60_000 ? 0 : 1;
    // The tire rotation is always the next thing; the rest of the week comes after it.
    const out = [
      ev('demo-tire', 'Tire rotation', at(now, tireDay, 15, 30), 45, 'Discount Tire'),
      ev('demo-standup', 'Team stand-up', at(now, tireDay + 1, 9, 0), 15, 'Microsoft Teams Meeting'),
      ev('demo-lunch', 'Lunch with Sam', at(now, tireDay + 1, 12, 15), 60, 'Papago Park'),
      ev('demo-gym', 'Gym', at(now, tireDay + 1, 18, 0), 60, 'Gym'),
      { id: 'demo-allday', title: 'Recycling pickup', start: at(now, tireDay + 1, 0, 0).toISOString(), end: at(now, tireDay + 2, 0, 0).toISOString(), allDay: true },
    ];
    return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }

  usps() {
    const now = new Date(this.clock());
    const day = now.toDateString();
    const delivered = now.getHours() >= 11;
    return { delivered, expected: true, collected: this.collectedOn === day, mailCount: 2, packageCount: 0 };
  }

  /** Plain text, WOPR's /api/where format. The office has a gate. */
  where(lat: number, lon: number): string {
    const office = place('office');
    const m = metersBetween({ lat, lon }, office);
    if (m <= 250) return `Office — Gate code 2580#, Garage keypad 7741 · ${Math.round(m)}m away`;
    const home = place('home');
    if (metersBetween({ lat, lon }, home) <= 250) return 'Home — no codes saved on that record yet.';
    return "Don't know this spot (no saved place within 250 m).";
  }

  /** A short spoken answer, from the truck facts the cockpit sent in its primer. */
  answer(messages: unknown): string {
    const list = Array.isArray(messages) ? messages as { role?: string; content?: unknown }[] : [];
    const all = list.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const q = (list.at(-1)?.content as string | undefined ?? '').toLowerCase();
    const range = /range[^\d]{0,20}(\d{2,3})\s*mi/i.exec(all)?.[1];
    const soc = /(\d{1,3}(?:\.\d)?)\s*%/.exec(all)?.[1];
    if (/range|charge|battery|make it/.test(q)) return `You're at ${soc ? `${Math.round(Number(soc))} percent` : 'a good charge'}${range ? `, about ${range} miles of range` : ''}. Plenty for today; the truck will top up tonight on the off-peak rate.`;
    if (/next|appointment|calendar|schedule/.test(q)) return 'Next up is your tire rotation at Discount Tire at 3:30. Leave about fifteen minutes before.';
    if (/mail|letter|package/.test(q)) return 'Two letters came today, no packages.';
    if (/garage|door/.test(q)) return 'The garage door is closed and the front door is locked.';
    return "Sure. Everything looks good: the truck's charged, the house is locked up, and your next stop is the tire rotation at 3:30.";
  }

  async handle(u: URL, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const p = u.pathname;
    if (p === '/api/status') return json({ ok: true, app: 'WOPR', version: '2.204.0' });
    if (p === '/api/calendar') {
      const from = Date.parse(u.searchParams.get('timeMin') ?? '') || 0, to = Date.parse(u.searchParams.get('timeMax') ?? '') || Infinity;
      return json({ connected: true, events: this.events().filter((e) => Date.parse(e.end) >= from && Date.parse(e.start) <= to) });
    }
    if (p === '/api/usps') {
      if (method === 'POST') this.collectedOn = new Date(this.clock()).toDateString();
      return json(this.usps());
    }
    if (p === '/api/where' && method === 'POST') {
      const b = await bodyJson(init);
      return text(this.where(Number(b.lat), Number(b.lon)));
    }
    if (p === '/api/mobile/context') return json({ context: '' });
    if (p === '/api/mail/search') return json({ messages: [] });
    if (p === '/api/WOPR' && method === 'POST') {
      const b = await bodyJson(init);
      const words = this.answer(b.messages).split(/(?<= )/);
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          const w = words.shift();
          if (w === undefined) { ctl.close(); return; }
          await new Promise((r) => setTimeout(r, 35));
          ctl.enqueue(enc.encode(w));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (p === '/api/stt' && method === 'POST') return json({ text: 'How much range do I have?' });
    if (p === '/api/tts' && method === 'POST') return new Response(new Uint8Array(silentWav(0.4)), { status: 200, headers: { 'content-type': 'audio/wav' } });
    return notFound();
  }
}

/** A short silent mono WAV (the demo has no voice of its own). Pure. */
export function silentWav(seconds: number, rate = 16_000): Buffer {
  const n = Math.round(seconds * rate), data = n * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

// ---- Spotify: an invented playlist on the truck --------------------------------------

export class DemoSpotify {
  private clock: () => number;
  private i = 0;
  private startedAt: number;   // when the current track's position was 0 (while playing)
  private pausedAt: number | null = null;
  constructor(clock: () => number = Date.now) {
    this.clock = clock;
    this.startedAt = clock() - 83_000; // a minute and a half into the first song
  }

  /** Advance past finished songs. */
  private tick() {
    if (this.pausedAt !== null) return;
    let pos = this.clock() - this.startedAt;
    while (pos >= DEMO_TRACKS[this.i].ms) { pos -= DEMO_TRACKS[this.i].ms; this.startedAt += DEMO_TRACKS[this.i].ms; this.i = (this.i + 1) % DEMO_TRACKS.length; }
  }

  private device = (active = true) => ({ id: 'demo-truck-device', name: 'Slate Truck', type: 'Automobile', is_active: active, volume_percent: 64 });

  player() {
    this.tick();
    const t = DEMO_TRACKS[this.i];
    const pos = (this.pausedAt ?? this.clock()) - this.startedAt;
    const art = coverArt(t.hue);
    return {
      is_playing: this.pausedAt === null, progress_ms: Math.max(0, Math.min(t.ms, pos)),
      device: this.device(), context: { uri: `spotify:playlist:${DEMO_PLAYLISTS[0].id}` },
      item: { name: t.title, duration_ms: t.ms, artists: [{ name: t.artist }], album: { name: t.album, images: [{ url: art }, { url: art }] } },
    };
  }

  command(method: string, p: string) {
    this.tick();
    if (p.startsWith('/me/player/pause')) { if (this.pausedAt === null) this.pausedAt = this.clock(); return; }
    if (p.startsWith('/me/player/play') || (p === '/me/player' && method === 'PUT')) {
      if (this.pausedAt !== null) { this.startedAt += this.clock() - this.pausedAt; this.pausedAt = null; }
      return;
    }
    const step = p.startsWith('/me/player/next') ? 1 : p.startsWith('/me/player/previous') ? -1 : 0;
    if (step) {
      this.i = (this.i + step + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      this.startedAt = this.clock(); if (this.pausedAt !== null) this.pausedAt = this.clock();
    }
  }

  async handle(u: URL, init: RequestInit | undefined): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.hostname === 'accounts.spotify.com') return json({ access_token: 'demo-access', token_type: 'Bearer', expires_in: 3600, refresh_token: 'demo-refresh', scope: 'user-read-playback-state' });
    const p = u.pathname.replace(/^\/v1/, '');
    if (p === '/me') return json({ id: 'alex', display_name: DEMO_DRIVERS[0].name });
    if (p === '/me/player' && method === 'GET') return json(this.player());
    if (p === '/me/player/devices') return json({ devices: [this.device(), { id: 'demo-phone', name: DEMO_DRIVERS[0].hotspot, type: 'Smartphone', is_active: false, volume_percent: 80 }] });
    if (p === '/me/playlists') {
      return json({ items: DEMO_PLAYLISTS.map((pl, k) => ({ id: pl.id, uri: `spotify:playlist:${pl.id}`, name: pl.name, items: { total: pl.tracks }, images: [{ url: coverArt((k * 70 + 15) % 360) }], owner: { display_name: DEMO_DRIVERS[0].name } })) });
    }
    if (p.startsWith('/me/player')) { this.command(method, p); return new Response(null, { status: 204 }); }
    return json({ error: { status: 404, message: 'Not found' } }, 404);
  }
}

// ---- Open Charge Map: public chargers -------------------------------------------------

export function ocmAnswer(u: URL): Response {
  const lat = Number(u.searchParams.get('latitude')), lon = Number(u.searchParams.get('longitude'));
  const miles = Number(u.searchParams.get('distance')) || 25;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json([]);
  const conn = (c: string, kw: number, level: number) => ({ ConnectionType: { Title: c === 'NACS' ? 'NACS / SAE J3400' : c === 'CCS' ? 'CCS (Type 1)' : 'Type 1 (J1772)' }, PowerKW: kw, LevelID: level });
  return json(DEMO_CHARGERS.filter((c) => metersBetween({ lat, lon }, c) <= miles * 1609.34).map((c) => ({
    ID: c.id,
    AddressInfo: { Title: c.name, Latitude: c.lat, Longitude: c.lon },
    OperatorInfo: { Title: c.network },
    UsageCost: c.price,
    Connections: c.connectors.map((k) => conn(k, c.kw, c.level)),
  })));
}

// ---- AZ511: cameras and incidents --------------------------------------------------------

export function az511Answer(u: URL): Response {
  if (u.pathname === '/api/v2/get/cameras') {
    return json(DEMO_TRAFFIC_CAMS.map((c, i) => ({
      Id: c.id, Source: 'ADOT', SourceId: String(c.id), Roadway: c.roadway, Direction: c.direction, Latitude: c.lat, Longitude: c.lon, Location: c.location, SortOrder: i,
      Views: [{ Id: c.id, Url: `/api/traffic/demo-cam/${c.id}.svg`, Status: 'Enabled', Description: c.location }],
    })));
  }
  if (u.pathname === '/api/v2/get/event') {
    const now = Math.floor(Date.now() / 1000);
    return json(DEMO_TRAFFIC_EVENTS.map((e) => ({ ...e, Organization: 'ADOT', Reported: now - 1500, LastUpdated: now - 300, StartDate: now - 1500, PlannedEndDate: now + 3600 })));
  }
  return notFound();
}

// ---- OSRM: road routes for the trip planner ---------------------------------------------

/** A route along the demo highway that ends nearest the destination (else a straight line), ~62 mph. */
export function osrmAnswer(u: URL): Response {
  const m = u.pathname.match(/\/route\/v1\/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/);
  if (!m) return json({ code: 'InvalidUrl' }, 400);
  const from = { lat: Number(m[2]), lon: Number(m[1]) }, to = { lat: Number(m[4]), lon: Number(m[3]) };
  const near = (p: { lat: number; lon: number }, q: [number, number]) => metersBetween(p, { lat: q[0], lon: q[1] }) < 50_000;
  const hw = DEMO_HIGHWAYS.find((h) => near(to, h.via[h.via.length - 1]) && (!h.from || near(from, h.from)))
    ?? DEMO_HIGHWAYS.find((h) => !h.from && near(to, h.via[h.via.length - 1]));
  const knots = [from, ...(hw ? hw.via.map(([lat, lon]) => ({ lat, lon })) : []), to];
  const coords: [number, number][] = [];
  let meters = 0;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    const d = metersBetween(a, b);
    meters += d * 1.08;   // roads wander a little
    const n = Math.max(1, Math.ceil(d / 1600));
    for (let k = 0; k < n; k++) coords.push([a.lon + (b.lon - a.lon) * (k / n), a.lat + (b.lat - a.lat) * (k / n)]);
  }
  coords.push([to.lon, to.lat]);
  return json({ code: 'Ok', routes: [{ distance: meters, duration: meters / 27.7, geometry: { type: 'LineString', coordinates: coords } }] });
}

// ---- the dispatcher the gate calls --------------------------------------------------

export type DemoServices = { house: DemoHouse; wopr: DemoWopr; spotify: DemoSpotify };

export function makeDemoServices(clock: () => number = Date.now): DemoServices {
  return { house: new DemoHouse(clock), wopr: new DemoWopr(clock), spotify: new DemoSpotify(clock) };
}

/** Answer a request for one of the invented services, or null (not ours: the gate decides). */
export function demoBackend(svc: DemoServices) {
  return async (u: URL, init: RequestInit | undefined): Promise<Response | null> => {
    const h = u.hostname.toLowerCase();
    if (h === DEMO_HA_HOST) return svc.house.handle(u, init);
    if (h === DEMO_WOPR_HOST) return svc.wopr.handle(u, init);
    if (h === 'api.spotify.com' || h === 'accounts.spotify.com') return svc.spotify.handle(u, init);
    if (h === 'api.openchargemap.io') return ocmAnswer(u);
    if (h === 'router.project-osrm.org') return osrmAnswer(u);
    if (h === 'az511.com' || h === 'www.az511.com') return az511Answer(u);
    return null;
  };
}
