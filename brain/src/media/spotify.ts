// Spotify: the truck as a Spotify Connect speaker (librespot on the Pi, see
// librespot.ts) and the Spotify Web API for now playing, controls, playlists
// and "play on the truck". Auth is the PKCE flow (no client secret), started
// from /settings on a phone; tokens are kept per driver in DATA_DIR/media.json.
// Each owner registers their own free app at developer.spotify.com; an app in
// development mode serves at most 5 Spotify accounts, added by hand in its
// dashboard (User Management). Playback control needs Spotify Premium.
import { createHash, randomBytes } from 'node:crypto';
import type { SpotifyToken } from './settings.ts';

export const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative'];
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
/** Refresh this long before the access token runs out. */
export const REFRESH_EARLY_MS = 60_000;

export class SpotifyError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const p = new URLSearchParams({ client_id: o.clientId, response_type: 'code', redirect_uri: o.redirectUri, code_challenge_method: 'S256', code_challenge: o.challenge, state: o.state, scope: SCOPES.join(' ') });
  return `${ACCOUNTS}/authorize?${p}`;
}

/** The ?code=&state= out of a pasted redirect URL (the phone couldn't load http://127.0.0.1/…). */
export function codeFromUrl(u: string): { code: string; state: string } | { error: string } {
  let url: URL;
  try { url = new URL(u.trim()); } catch { return { error: 'That is not the whole address: copy it from the browser bar after Spotify sent you back.' }; }
  const err = url.searchParams.get('error');
  if (err) return { error: err === 'access_denied' ? 'Spotify access was declined.' : `Spotify said: ${err}` };
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return { error: 'No code in that address: it should end in ?code=…&state=…' };
  return { code, state };
}

type Fetch = typeof fetch;
type TokenJson = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

/** Token response -> SpotifyToken. A refresh answer may omit refresh_token: the old one stays good. */
export function tokenFrom(j: TokenJson, prev: SpotifyToken | null, now = Date.now()): SpotifyToken {
  if (!j.access_token) throw new SpotifyError(j.error_description ?? j.error ?? 'Spotify sent no access token', 502);
  return {
    access: j.access_token,
    refresh: j.refresh_token ?? prev?.refresh ?? '',
    expiresAt: now + Math.max(60, Number(j.expires_in) || 3600) * 1000,
    scope: j.scope ?? prev?.scope ?? '',
    user: prev?.user ?? null,
  };
}

/**
 * Keeps one driver's access token fresh. Refreshes REFRESH_EARLY_MS early;
 * concurrent callers share one refresh; "invalid_grant" (revoked, or the app
 * was reset) forgets the tokens so the settings page shows "Connect" again.
 */
export class SpotifyTokens {
  private inflight = new Map<string, Promise<SpotifyToken>>();
  private clientId: () => string | null;
  private load: (driver: string) => SpotifyToken | null;
  private save: (driver: string, t: SpotifyToken | null) => void;
  private fetch: Fetch;
  private clock: () => number;

  constructor(o: { clientId: () => string | null; load: (driver: string) => SpotifyToken | null; save: (driver: string, t: SpotifyToken | null) => void; fetch?: Fetch; now?: () => number }) {
    this.clientId = o.clientId; this.load = o.load; this.save = o.save;
    this.fetch = o.fetch ?? fetch; this.clock = o.now ?? Date.now;
  }

  async exchange(driver: string, code: string, redirectUri: string, verifier: string): Promise<SpotifyToken> {
    const cid = this.clientId();
    if (!cid) throw new SpotifyError('Enter the Spotify Client ID first', 400);
    const t = tokenFrom(await this.post({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cid, code_verifier: verifier }), null, this.clock());
    if (!t.refresh) throw new SpotifyError('Spotify sent no refresh token', 502);
    this.save(driver, t);
    return t;
  }

  /** A good access token for this driver, refreshing it when it is (nearly) out; null = not connected. */
  async access(driver: string, force = false): Promise<string | null> {
    const t = this.load(driver);
    if (!t) return null;
    if (!force && t.expiresAt - this.clock() > REFRESH_EARLY_MS) return t.access;
    let p = this.inflight.get(driver);
    if (!p) {
      p = this.refresh(driver, t).finally(() => this.inflight.delete(driver));
      this.inflight.set(driver, p);
    }
    return (await p).access;
  }

  private async refresh(driver: string, t: SpotifyToken): Promise<SpotifyToken> {
    const cid = this.clientId();
    if (!cid) throw new SpotifyError('The Spotify Client ID was removed: enter it on the settings page', 400);
    let j: TokenJson;
    try { j = await this.post({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: cid }); }
    catch (e) {
      if (e instanceof SpotifyError && e.message === 'invalid_grant') {
        this.save(driver, null);
        throw new SpotifyError('Spotify access was revoked: connect again on the settings page', 401);
      }
      throw e;
    }
    const n = tokenFrom(j, t, this.clock());
    this.save(driver, n);
    return n;
  }

  private async post(form: Record<string, string>): Promise<TokenJson> {
    let r: Response;
    try {
      r = await this.fetch(`${ACCOUNTS}/api/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(10_000) });
    } catch (e) { throw new SpotifyError(`Can't reach Spotify (${(e as Error).message})`, 502); }
    const j = await r.json().catch(() => ({})) as TokenJson;
    if (!r.ok) throw new SpotifyError(j.error === 'invalid_grant' ? 'invalid_grant' : j.error_description ?? j.error ?? `Spotify answered ${r.status}`, r.status === 400 ? 400 : 502);
    return j;
  }
}

export type SpotifyDevice = { id: string; name: string; type: string; active: boolean; volume: number | null };
export type SpotifyPlayback = {
  playing: boolean; title: string | null; artist: string | null; album: string | null; art: string | null;
  durationMs: number | null; positionMs: number | null; device: SpotifyDevice | null; context: string | null;
};
export type SpotifyPlaylist = { id: string; uri: string; name: string; tracks: number | null; image: string | null; owner: string | null };

/** GET /v1/me/player JSON (or null for 204 "nothing") -> SpotifyPlayback. */
export function mapPlayback(j: unknown): SpotifyPlayback | null {
  if (!j || typeof j !== 'object') return null;
  const x = j as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const it = x.item ?? null;
  const imgs = it?.album?.images ?? it?.images ?? it?.show?.images ?? [];
  return {
    playing: x.is_playing === true,
    title: typeof it?.name === 'string' ? it.name : null,
    artist: Array.isArray(it?.artists) ? it.artists.map((a: { name?: string }) => a.name).filter(Boolean).join(', ') || null : (it?.show?.name ?? null),
    album: it?.album?.name ?? null,
    art: Array.isArray(imgs) && imgs.length ? (imgs[imgs.length > 1 ? 1 : 0]?.url ?? null) : null,
    durationMs: typeof it?.duration_ms === 'number' ? it.duration_ms : null,
    positionMs: typeof x.progress_ms === 'number' ? x.progress_ms : null,
    device: x.device ? mapDevice(x.device) : null,
    context: x.context?.uri ?? null,
  };
}

export function mapDevice(d: Record<string, unknown>): SpotifyDevice {
  return { id: String(d.id ?? ''), name: String(d.name ?? ''), type: String(d.type ?? ''), active: d.is_active === true, volume: typeof d.volume_percent === 'number' ? d.volume_percent : null };
}

export function mapPlaylists(j: unknown): SpotifyPlaylist[] {
  const items = (j as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((p): p is Record<string, any> => !!p && typeof p === 'object') // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((p) => ({ id: String(p.id), uri: String(p.uri), name: String(p.name ?? 'Playlist'), tracks: typeof p.tracks?.total === 'number' ? p.tracks.total : null, image: p.images?.[0]?.url ?? null, owner: p.owner?.display_name ?? null }));
}

/** Web API calls for one driver. 401 once = refresh and retry. */
export class SpotifyApi {
  private tokens: SpotifyTokens;
  private fetch: Fetch;
  constructor(tokens: SpotifyTokens, f: Fetch = fetch) { this.tokens = tokens; this.fetch = f; }

  async call<T>(driver: string, method: string, p: string, body?: unknown): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await this.tokens.access(driver, attempt > 0);
      if (!tok) throw new SpotifyError('Spotify is not connected for this driver: connect it on the settings page', 409);
      let r: Response;
      try {
        r = await this.fetch(API + p, { method, headers: { authorization: `Bearer ${tok}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      } catch (e) { throw new SpotifyError(`Can't reach Spotify (${(e as Error).message})`, 502); }
      if (r.status === 401 && attempt === 0) continue;
      if (r.status === 204 || r.status === 202) return null;
      const j = await r.json().catch(() => null) as T & { error?: { message?: string; reason?: string } } | null;
      if (r.ok) return j;
      const why = j?.error?.reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is needed to control playback' : j?.error?.message ?? `Spotify answered ${r.status}`;
      if (r.status === 429) throw new SpotifyError(`Spotify asked us to slow down (retry in ${r.headers.get('retry-after') ?? '?'} s)`, 429);
      throw new SpotifyError(why, r.status === 404 ? 404 : r.status === 403 ? 403 : 502);
    }
    throw new SpotifyError('Spotify kept refusing the token: connect again on the settings page', 401);
  }

  async playback(driver: string) { return mapPlayback(await this.call(driver, 'GET', '/me/player?additional_types=episode')); }
  async devices(driver: string) { return ((await this.call<{ devices?: Record<string, unknown>[] }>(driver, 'GET', '/me/player/devices'))?.devices ?? []).map(mapDevice); }
  async playlists(driver: string) { return mapPlaylists(await this.call(driver, 'GET', '/me/playlists?limit=50')); }
  async me(driver: string) { return (await this.call<{ display_name?: string; id?: string }>(driver, 'GET', '/me')) ?? {}; }
}
