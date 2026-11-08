// The HOME screen: the garage door, and pages of Home Assistant tiles (lights,
// switches, locks, scenes, sensors) picked by hand or copied from one of HA's
// own dashboards ("like the garage dashboard"). Control is limited to the
// entities on this screen: /api/ha/act refuses anything else, so the cockpit's
// HA token can't be used to drive the rest of the house from the dash.
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import type { HaClient, HaState } from './client.ts';
import { HaError } from './client.ts';

export type GarageConfig = {
  cover: string | null;          // cover.garage_door
  light: string | null;          // light.garage_opener_light
  obstruction: string | null;    // binary_sensor.garage_door_obstruction
  ask: boolean;                  // offer Open on the way home, Close when leaving it open
  nearM: number;                 // "arriving" = inside this distance of home
};
export type HaPage = { title: string; dashboard: string | null; entities: string[] };
/**
 * cameras: the house cameras shown as live stills on the Home screen (front lawn,
 * garage, doorbell), camera.* entities. Only these can be fetched through the brain.
 * camerasPicked: set once the owner has saved a list, so an empty list stays empty
 * instead of being guessed again.
 */
export type PanelConfig = { garage: GarageConfig; pages: HaPage[]; cameras: string[]; camerasPicked?: boolean };

export type Tile = {
  entity: string; domain: string; name: string; state: string; unit: string | null;
  deviceClass: string | null; actions: string[]; brightness: number | null;
  /** A thermostat's line: "Cooling to 76°". Only climate tiles carry one. */
  detail?: string;
};

const KEY = 'haPanel';
export const DOMAIN_ACTIONS: Record<string, string[]> = {
  cover: ['open', 'close', 'stop'],
  light: ['toggle', 'on', 'off'],
  switch: ['toggle', 'on', 'off'],
  fan: ['toggle', 'on', 'off'],
  input_boolean: ['toggle', 'on', 'off'],
  lock: ['lock', 'unlock'],
  scene: ['run'],
  script: ['run'],
  button: ['press'],
  input_button: ['press'],
  media_player: ['play_pause', 'off'],
};
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

export function defaultPanel(): PanelConfig {
  return { garage: { cover: null, light: null, obstruction: null, ask: true, nearM: 250 }, pages: [], cameras: [] };
}

/** Check a PUT body. Pure. Throws on bad input. */
export function validPanel(b: unknown): PanelConfig {
  const d = defaultPanel();
  if (!b || typeof b !== 'object') throw new HaError('panel must be an object', 400);
  const x = b as Partial<PanelConfig>;
  const ent = (v: unknown, what: string) => { if (v === null || v === undefined || v === '') return null; if (typeof v !== 'string' || !ENTITY_RE.test(v)) throw new HaError(`${what} must be an entity id like cover.garage_door`, 400); return v; };
  const g = (x.garage ?? {}) as Partial<GarageConfig>;
  d.garage = {
    cover: ent(g.cover, 'garage.cover'), light: ent(g.light, 'garage.light'), obstruction: ent(g.obstruction, 'garage.obstruction'),
    ask: g.ask !== false,
    nearM: typeof g.nearM === 'number' && g.nearM >= 50 && g.nearM <= 3000 ? Math.round(g.nearM) : 250,
  };
  if (d.garage.cover && !d.garage.cover.startsWith('cover.')) throw new HaError('garage.cover must be a cover.* entity', 400);
  if (Array.isArray(x.pages)) {
    d.pages = x.pages.slice(0, 8).map((p, i) => {
      if (!p || typeof p !== 'object' || typeof p.title !== 'string' || !p.title.trim()) throw new HaError(`page ${i + 1} needs a title`, 400);
      const list = Array.isArray(p.entities) ? p.entities : [];
      return {
        title: p.title.trim().slice(0, 30),
        dashboard: typeof p.dashboard === 'string' && /^[a-z0-9_-]+$/.test(p.dashboard) ? p.dashboard : null,
        entities: [...new Set(list.map((e, j) => ent(e, `page ${i + 1} entity ${j + 1}`)).filter((e): e is string => !!e))].slice(0, 48),
      };
    });
  }
  if (Array.isArray(x.cameras)) {
    d.cameras = [...new Set(x.cameras.map((e, j) => ent(e, `camera ${j + 1}`)).filter((e): e is string => !!e))].slice(0, 6);
    for (const c of d.cameras) if (!c.startsWith('camera.')) throw new HaError(`${c} isn't a camera (camera.* entities only)`, 400);
    d.camerasPicked = true;
  }
  return d;
}

/** House cameras by name, in the order the dash shows them: front lawn / yard, garage, doorbell / front door. Pure. */
export function guessCameras(states: HaState[]): string[] {
  const cams = states.filter((s) => s.entity_id.startsWith('camera.'));
  const label = (s: HaState) => `${s.entity_id} ${String((s.attributes as Record<string, unknown>)?.friendly_name ?? '')}`.toLowerCase();
  const out: string[] = [];
  for (const re of [/lawn|front.?yard|driveway/, /garage/, /door.?bell|ring|front.?door|porch/]) {
    const hit = cams.find((s) => re.test(label(s)) && !out.includes(s.entity_id));
    if (hit) out.push(hit.entity_id);
  }
  return out;
}

/** A tile for one state. Pure. */
export function tileFor(s: HaState): Tile {
  const domain = s.entity_id.split('.')[0];
  const a = (s.attributes ?? {}) as Record<string, unknown>;
  return {
    entity: s.entity_id, domain,
    name: String(a.friendly_name ?? s.entity_id),
    state: s.state,
    unit: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : null,
    deviceClass: typeof a.device_class === 'string' ? a.device_class : null,
    actions: DOMAIN_ACTIONS[domain] ?? [],
    brightness: typeof a.brightness === 'number' ? Math.round((a.brightness / 255) * 100) : null,
    ...(domain === 'climate' ? { detail: climateLine(s.state, a) } : {}),
  };
}

/** "Cooling to 76°", "Heat to 68°", "Off". Pure. */
export function climateLine(state: string, a: Record<string, unknown>): string {
  const action = typeof a.hvac_action === 'string' && a.hvac_action !== 'idle' && a.hvac_action !== 'off' ? a.hvac_action : null;
  const word = (action ?? state).replace(/_/g, ' ');
  const cap = word.charAt(0).toUpperCase() + word.slice(1);
  const t = typeof a.temperature === 'number' ? a.temperature : null;
  return state === 'off' || t === null ? cap : `${cap} to ${Math.round(t)}°`;
}

/** The HA service for a tile action. Pure. null = not allowed for that domain. */
export function serviceFor(entity: string, action: string): { domain: string; service: string } | null {
  const domain = entity.split('.')[0];
  if (!(DOMAIN_ACTIONS[domain] ?? []).includes(action)) return null;
  const svc: Record<string, string> = {
    open: 'open_cover', close: 'close_cover', stop: 'stop_cover', toggle: 'toggle', on: 'turn_on', off: 'turn_off',
    lock: 'lock', unlock: 'unlock', run: 'turn_on', press: 'press', play_pause: 'media_play_pause',
  };
  return { domain, service: svc[action] };
}

/** Every entity id a Lovelace dashboard config mentions, in order. Pure. */
export function lovelaceEntities(cfg: unknown): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { if (typeof v === 'string' && ENTITY_RE.test(v) && !out.includes(v)) out.push(v); };
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === 'entity' || k === 'entity_id' || k === 'camera_image') { if (Array.isArray(v)) v.forEach(add); else add(v); }
      else if (k === 'entities' && Array.isArray(v)) v.forEach((e) => (typeof e === 'string' ? add(e) : walk(e)));
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(cfg);
  return out;
}

/** Garage entities in a states list, when none is set yet. Pure. */
export function guessGarage(states: HaState[]): Pick<GarageConfig, 'cover' | 'light' | 'obstruction'> {
  const by = (f: (s: HaState) => boolean) => states.find(f)?.entity_id ?? null;
  const dc = (s: HaState) => (s.attributes as Record<string, unknown> | undefined)?.device_class;
  return {
    cover: by((s) => s.entity_id.startsWith('cover.') && dc(s) === 'garage') ?? by((s) => s.entity_id.startsWith('cover.') && /garage/.test(s.entity_id)),
    light: by((s) => s.entity_id.startsWith('light.') && /garage.*opener|opener.*light/.test(s.entity_id)),
    obstruction: by((s) => s.entity_id.startsWith('binary_sensor.') && /garage.*obstruct/.test(s.entity_id)),
  };
}

export class HaPanel {
  private db: Db;
  private ha: HaClient;
  constructor(db: Db, ha: HaClient) { this.db = db; this.ha = ha; }

  config(): PanelConfig { return kvGet<PanelConfig>(this.db, KEY) ?? defaultPanel(); }
  save(b: unknown): PanelConfig { const c = validPanel(b); kvSet(this.db, KEY, c); return c; }

  /** Entities the dash may control: the garage ones and every page tile. */
  allowed(): Set<string> {
    const c = this.config();
    return new Set([c.garage.cover, c.garage.light, ...c.pages.flatMap((p) => p.entities)].filter((x): x is string => !!x));
  }

  /** The screen: garage state, home position (HA's zone.home), and each page's tiles. */
  async view() {
    const c = this.config();
    const states = await this.ha.states();
    const byId = new Map(states.map((s) => [s.entity_id, s]));
    if (!c.garage.cover) {   // first look: find the garage door, and keep it
      const g = guessGarage(states);
      if (g.cover) { c.garage = { ...c.garage, ...g }; kvSet(this.db, KEY, c); }
    }
    c.cameras ??= [];
    if (!c.camerasPicked && !c.cameras.length) {   // likewise the lawn, garage and doorbell cameras
      const g = guessCameras(states);
      if (g.length) { c.cameras = g; kvSet(this.db, KEY, c); }
    }
    const home = byId.get('zone.home')?.attributes as { latitude?: number; longitude?: number; radius?: number } | undefined;
    const t = (id: string | null) => (id && byId.get(id) ? tileFor(byId.get(id)!) : null);
    return {
      config: c,
      home: home?.latitude !== undefined && home.longitude !== undefined ? { lat: home.latitude, lon: home.longitude, radiusM: home.radius ?? 100 } : null,
      garage: { door: t(c.garage.cover), light: t(c.garage.light), obstruction: t(c.garage.obstruction) },
      cameras: c.cameras.map((e) => { const s = byId.get(e); return { entity: e, name: s ? String((s.attributes as Record<string, unknown>)?.friendly_name ?? e) : e, state: s?.state ?? 'missing' }; }),
      pages: c.pages.map((p) => ({ title: p.title, dashboard: p.dashboard, tiles: p.entities.map((e) => t(e) ?? { entity: e, domain: e.split('.')[0], name: e, state: 'missing', unit: null, deviceClass: null, actions: [], brightness: null }) })),
    };
  }

  /** Just the garage, for the arrival prompt's quick poll. */
  async garage() {
    const c = this.config().garage;
    if (!c.cover) return null;
    const [door, obstruction] = await Promise.all([this.ha.state(c.cover).then(tileFor), c.obstruction ? this.ha.state(c.obstruction).then(tileFor).catch(() => null) : Promise.resolve(null)]);
    return { door, obstruction, ask: c.ask, nearM: c.nearM };
  }

  async act(entity: string, action: string) {
    if (!this.allowed().has(entity)) throw new HaError(`${entity} isn't on the Home screen: add it in Settings first`, 403);
    const s = serviceFor(entity, action);
    if (!s) throw new HaError(`${action} isn't something a ${entity.split('.')[0]} does`, 400);
    await this.ha.call(s.domain, s.service, { entity_id: entity });
    return { ok: true };
  }

  /** One still from a Home-screen camera. Anything not on the list is refused, so the dash can't browse every camera HA has. */
  async cameraImage(entity: string): Promise<{ type: string; body: Uint8Array }> {
    if (!(this.config().cameras ?? []).includes(entity)) throw new HaError(`${entity} isn't on the Home screen: add it in Settings first`, 403);
    return this.ha.image(entity);
  }

  /** Entity picker for Settings. */
  async search(q: string) {
    const states = await this.ha.states();
    const n = q.toLowerCase();
    return states.filter((s) => (DOMAIN_ACTIONS[s.entity_id.split('.')[0]] || s.entity_id.startsWith('sensor.') || s.entity_id.startsWith('binary_sensor.') || s.entity_id.startsWith('camera.'))
      && (s.entity_id.includes(n) || String((s.attributes as Record<string, unknown>)?.friendly_name ?? '').toLowerCase().includes(n))).slice(0, 40).map(tileFor);
  }

  /** The entities on one of HA's own dashboards (its url_path, e.g. "room-garage"). */
  async fromDashboard(urlPath: string): Promise<string[]> {
    if (!/^[a-z0-9_-]+$/.test(urlPath)) throw new HaError('dashboard is its url_path, e.g. room-garage', 400);
    return lovelaceEntities(await this.ha.ws({ type: 'lovelace/config', url_path: urlPath }));
  }
}
