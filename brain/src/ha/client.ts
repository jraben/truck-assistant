// Home Assistant REST, from the brain. URL + long-lived token come from
// Settings.homeAssistant (the settings page); the token is never logged.
import type { Settings } from '../types.ts';

export const NOT_CONFIGURED = 'Connect Home Assistant on the settings page (URL and a long-lived access token).';

export class HaError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) { super(message); this.status = status; }
}

export type HaState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  last_reported?: string;
};

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class HaClient {
  private getSettings: () => Settings;
  private fetchFn: FetchLike;
  lastError: string | null = null;
  lastOkAt = 0;

  constructor(getSettings: () => Settings, fetchFn: FetchLike = fetch as unknown as FetchLike) {
    this.getSettings = getSettings;
    this.fetchFn = fetchFn;
  }

  configured(): boolean {
    const ha = this.getSettings().homeAssistant;
    return !!(ha.url && ha.token);
  }

  /** "not configured" | "connected" | "error: …", for /api/health. */
  status(): string {
    if (!this.configured()) return 'not configured';
    if (this.lastError) return `error: ${this.lastError}`;
    return this.lastOkAt ? 'connected' : 'not checked yet';
  }

  async get<T>(path: string, timeoutMs = 15_000): Promise<T> {
    const ha = this.getSettings().homeAssistant;
    if (!ha.url || !ha.token) throw new HaError(NOT_CONFIGURED);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.fetchFn(ha.url + path, { headers: { authorization: `Bearer ${ha.token}`, accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 401 || res.status === 403) throw new HaError('Home Assistant refused the token (check it on the settings page)', res.status);
      if (res.status === 404) {
        // HA answered: it's up, that entity just doesn't exist. Not a connection fault.
        this.lastOkAt = Date.now(); this.lastError = null;
        throw new HaError(`Home Assistant has no ${decodeURIComponent(path.replace(/^\/api\/states\//, ''))}`, 404);
      }
      if (!res.ok) throw new HaError(`Home Assistant answered ${res.status}`, res.status);
      const body = (await res.json()) as T;
      this.lastOkAt = Date.now(); this.lastError = null;
      return body;
    } catch (e) {
      const msg = e instanceof HaError ? e.message
        : (e as Error).name === 'AbortError' ? 'Home Assistant did not answer in time'
        : `Home Assistant not reachable (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message})`;
      this.lastError = msg;
      throw e instanceof HaError ? e : new HaError(msg);
    } finally { clearTimeout(timer); }
  }

  state(entity: string) { return this.get<HaState>(`/api/states/${encodeURIComponent(entity)}`); }
  states() { return this.get<HaState[]>('/api/states', 30_000); }

  /** Full-attribute history of one entity, [start, end). */
  async history(entity: string, start: Date, end: Date): Promise<HaState[]> {
    const q = `filter_entity_id=${encodeURIComponent(entity)}&end_time=${encodeURIComponent(end.toISOString())}&significant_changes_only=0`;
    const body = await this.get<unknown>(`/api/history/period/${encodeURIComponent(start.toISOString())}?${q}`, 60_000);
    return historyStates(body, entity);
  }

  /** A camera's current still (HA's camera_proxy), as bytes. The token stays here; the tablet only ever sees the picture. */
  async image(entity: string): Promise<{ type: string; body: Uint8Array }> {
    const ha = this.getSettings().homeAssistant;
    if (!ha.url || !ha.token) throw new HaError(NOT_CONFIGURED);
    let res: Response;
    try {
      res = await fetch(`${ha.url}/api/camera_proxy/${encodeURIComponent(entity)}`, { headers: { authorization: `Bearer ${ha.token}` }, signal: AbortSignal.timeout(10_000) });
    } catch (e) { throw new HaError(`Home Assistant not reachable (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message})`); }
    if (res.status === 401 || res.status === 403) throw new HaError('Home Assistant refused the token', res.status);
    if (res.status === 404) throw new HaError(`Home Assistant has no ${entity}`, 404);
    if (!res.ok) throw new HaError(`${entity} gave no picture (Home Assistant answered ${res.status})`, 502);
    this.lastOkAt = Date.now(); this.lastError = null;
    return { type: res.headers.get('content-type') ?? 'image/jpeg', body: new Uint8Array(await res.arrayBuffer()) };
  }

  /**
   * POST /api/conversation/process: one turn with HA's Assist (whichever
   * conversation agent HA has: its built-in one, or an OpenAI/Gemini/Claude
   * agent set up in HA). Returns what it said and the conversation id to keep
   * the thread going.
   */
  async converse(text: string, opts: { agentId?: string | null; conversationId?: string | null; language?: string } = {}): Promise<{ speech: string; conversationId: string | null }> {
    const ha = this.getSettings().homeAssistant;
    if (!ha.url || !ha.token) throw new HaError(NOT_CONFIGURED);
    let res: Response;
    try {
      res = await fetch(`${ha.url}/api/conversation/process`, {
        method: 'POST', headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text, language: opts.language ?? 'en', ...(opts.agentId ? { agent_id: opts.agentId } : {}), ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) { throw new HaError(`Home Assistant not reachable (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message})`); }
    if (res.status === 401 || res.status === 403) throw new HaError('Home Assistant refused the token (check it on the settings page)', res.status);
    if (!res.ok) throw new HaError(`Home Assistant Assist answered ${res.status}`, 502);
    const j = await res.json() as { conversation_id?: string; response?: { speech?: { plain?: { speech?: string } } } };
    this.lastOkAt = Date.now(); this.lastError = null;
    return { speech: String(j.response?.speech?.plain?.speech ?? '').trim(), conversationId: j.conversation_id ?? null };
  }

  /** POST /api/services/<domain>/<service>. For the Home screen; HaPanel decides what may be called. */
  async call(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const ha = this.getSettings().homeAssistant;
    if (!ha.url || !ha.token) throw new HaError(NOT_CONFIGURED);
    let res: Response;
    try {
      res = await fetch(`${ha.url}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
        method: 'POST', headers: { authorization: `Bearer ${ha.token}`, 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000),
      });
    } catch (e) { throw new HaError(`Home Assistant not reachable (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message})`); }
    if (res.status === 401 || res.status === 403) throw new HaError('Home Assistant refused the token (its user may not be allowed to control this)', res.status);
    if (!res.ok) throw new HaError(`Home Assistant answered ${res.status} to ${domain}.${service}`, res.status === 400 ? 400 : 502);
    this.lastOkAt = Date.now(); this.lastError = null;
  }

  /** One request over HA's WebSocket API (things REST doesn't have, like a dashboard's config). */
  ws<T = unknown>(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const ha = this.getSettings().homeAssistant;
    if (!ha.url || !ha.token) return Promise.reject(new HaError(NOT_CONFIGURED));
    const url = ha.url.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket';
    return new Promise<T>((resolve, reject) => {
      const sock = new WebSocket(url);
      const done = (f: () => void) => { clearTimeout(timer); try { sock.close(); } catch { /* closed */ } f(); };
      const timer = setTimeout(() => done(() => reject(new HaError('Home Assistant did not answer in time'))), timeoutMs);
      sock.onerror = () => done(() => reject(new HaError('Home Assistant WebSocket not reachable')));
      sock.onmessage = (ev) => {
        let m: { type?: string; id?: number; success?: boolean; result?: unknown; error?: { message?: string } };
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: ha.token }));
        else if (m.type === 'auth_invalid') done(() => reject(new HaError('Home Assistant refused the token', 401)));
        else if (m.type === 'auth_ok') sock.send(JSON.stringify({ id: 1, ...msg }));
        else if (m.type === 'result' && m.id === 1) done(() => (m.success ? resolve(m.result as T) : reject(new HaError(m.error?.message ?? 'Home Assistant refused the request', 404))));
      };
    });
  }
}

/** HA's history answer is a list with one list of states per entity. */
export function historyStates(body: unknown, entity: string): HaState[] {
  if (!Array.isArray(body)) return [];
  for (const list of body) {
    if (!Array.isArray(list) || !list.length) continue;
    // minimal_response lists carry entity_id only on the first state; we ask for full ones.
    const id = (list[0] as HaState)?.entity_id;
    if (id === undefined || id === entity) return list as HaState[];
  }
  return [];
}

export type TrackerPoint = { t: number; lat: number; lon: number; speedMph: number | null; accuracyM: number | null };

export const MAX_ACCURACY_M = 100;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * Tracker states -> positions. Drops states with no coordinates or gps_accuracy
 * worse than MAX_ACCURACY_M. Time is last_updated (a position change is an
 * attribute change, which moves last_updated but not last_changed).
 */
export function trackerPoints(states: HaState[]): { points: TrackerPoint[]; dropped: number } {
  const points: TrackerPoint[] = [];
  let dropped = 0;
  for (const s of states) {
    const a = s.attributes ?? {};
    const lat = num(a.latitude), lon = num(a.longitude), acc = num(a.gps_accuracy);
    const t = Date.parse(s.last_updated ?? s.last_changed ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t) || (lat === 0 && lon === 0)) { dropped++; continue; }
    if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) { dropped++; continue; }
    const sp = num(a.speed); // companion apps report m/s; iOS sends -1 when it doesn't know
    points.push({ t, lat, lon, speedMph: Number.isFinite(sp) && sp >= 0 ? sp * 2.2369363 : null, accuracyM: Number.isFinite(acc) ? acc : null });
  }
  points.sort((x, y) => x.t - y.t);
  return { points, dropped };
}

export type Zone = { name: string; lat: number; lon: number; radiusM: number };

/** zone.* states -> named circles. Passive zones still name a place. */
export function zonesFrom(states: HaState[]): Zone[] {
  return states.filter((s) => s.entity_id.startsWith('zone.')).flatMap((s) => {
    const lat = num(s.attributes.latitude), lon = num(s.attributes.longitude), r = num(s.attributes.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const name = typeof s.attributes.friendly_name === 'string' && s.attributes.friendly_name.trim() ? s.attributes.friendly_name.trim() : s.entity_id.slice(5).replace(/_/g, ' ');
    return [{ name, lat, lon, radiusM: Number.isFinite(r) && r > 0 ? r : 100 }];
  });
}

/** Where a person/device_tracker last was, and when HA last heard. */
export function presenceOf(s: HaState): { lat: number; lon: number; at: number } | null {
  const lat = num(s.attributes?.latitude), lon = num(s.attributes?.longitude);
  const at = Date.parse(s.last_updated ?? s.last_changed ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(at)) return null;
  return { lat, lon, at };
}
