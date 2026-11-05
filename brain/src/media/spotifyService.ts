// Spotify for the cockpit: auth sessions, the librespot speaker on the Pi,
// controls, and now playing (reported only while the truck is the device).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { MediaSettingsStore } from './settings.ts';
import { authorizeUrl, codeFromUrl, pkcePair, SpotifyApi, SpotifyError, SpotifyTokens } from './spotify.ts';
import type { SpotifyPlayback } from './types.ts';
import type { NowPlaying } from '../types.ts';
import type { SpotifyStatus } from './types.ts';

const AUTH_TTL_MS = 15 * 60_000;
const POLL_MS = 10_000;

export function findLibrespot(): string | null {
  const env = process.env.LIBRESPOT_BIN;
  for (const p of [env, '/usr/bin/librespot', '/usr/local/bin/librespot', '/opt/raspotify/librespot']) if (p && existsSync(p)) return p;
  return null;
}

export type { SpotifyStatus } from './types.ts';

export class SpotifyService {
  readonly tokens: SpotifyTokens;
  readonly api: SpotifyApi;
  private media: MediaSettingsStore;
  private driver: () => string;
  private online: () => boolean;
  private report: (np: NowPlaying | null) => void;
  private sim: boolean;
  private auths = new Map<string, { verifier: string; redirectUri: string; driver: string; at: number }>();
  private child: ChildProcess | null = null;
  private childState: SpotifyStatus['librespot'] = 'off';
  private childErr: string | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private crashes = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private last: SpotifyPlayback | null = null;
  private lastMsg: string | null = null;
  private stopping = false;

  constructor(o: { media: MediaSettingsStore; driver: () => string; online: () => boolean; report: (np: NowPlaying | null) => void; sim: boolean }) {
    this.media = o.media; this.driver = o.driver; this.online = o.online; this.report = o.report; this.sim = o.sim;
    this.tokens = new SpotifyTokens({
      clientId: () => this.media.get().spotify.clientId,
      load: (d) => this.media.get().spotify.tokens[d] ?? null,
      save: (d, t) => { this.media.mutate((s) => { if (t) s.spotify.tokens[d] = t; else delete s.spotify.tokens[d]; }); },
    });
    this.api = new SpotifyApi(this.tokens);
  }

  start() {
    this.syncLibrespot();
    this.media.onChange((n, p) => {
      if (n.spotify.deviceName !== p.spotify.deviceName || n.spotify.connect !== p.spotify.connect || n.spotify.bitrate !== p.spotify.bitrate) this.syncLibrespot(true);
    });
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop() {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.kill('SIGTERM');
  }

  // ---- librespot (the truck as a Connect speaker) -----------------------------

  private syncLibrespot(restart = false) {
    const s = this.media.get().spotify;
    if (this.sim) { this.childState = 'sim'; return; }
    const bin = findLibrespot();
    if (!bin) { this.childState = 'not-installed'; return; }
    if (!s.connect) { this.child?.kill('SIGTERM'); this.child = null; this.childState = 'off'; return; }
    if (this.child && !restart) return;
    if (this.child) { const old = this.child; this.child = null; old.removeAllListeners('exit'); old.kill('SIGTERM'); }
    const args = ['--name', s.deviceName, '--device-type', 'automobile', '--bitrate', String(s.bitrate), '--disable-audio-cache', '--initial-volume', '80', '--enable-volume-normalisation'];
    if (process.env.LIBRESPOT_BACKEND) args.push('--backend', process.env.LIBRESPOT_BACKEND);
    if (process.env.LIBRESPOT_DEVICE) args.push('--device', process.env.LIBRESPOT_DEVICE);
    this.childState = 'starting'; this.childErr = null;
    const c = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = c;
    let tail = '';
    c.stderr?.on('data', (d: Buffer) => { tail = (tail + d.toString()).slice(-600); if (/Publishing|Zeroconf|Connecting|Authenticated/i.test(tail)) this.childState = 'running'; });
    c.on('spawn', () => { setTimeout(() => { if (this.child === c && this.childState === 'starting') this.childState = 'running'; }, 3000); });
    c.on('error', (e) => { this.childErr = e.message; });
    c.on('exit', (code) => {
      if (this.child !== c) return;
      this.child = null;
      if (this.stopping) return;
      this.childState = 'crashed';
      this.childErr = `librespot exited ${code}: ${tail.trim().split('\n').pop() ?? ''}`.slice(0, 200);
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(5, this.crashes++));
      this.restartTimer = setTimeout(() => this.syncLibrespot(), wait);
    });
  }

  // ---- auth --------------------------------------------------------------------

  /** Start PKCE for a driver; the page opens the returned URL (on the phone). */
  beginAuth(driver: string, redirectUri: string): { url: string } {
    const cid = this.media.get().spotify.clientId;
    if (!cid) throw new SpotifyError('Enter your Spotify app\'s Client ID and save first', 400);
    if (!/^https:\/\/|^http:\/\/127\.0\.0\.1(:\d+)?\//.test(redirectUri)) throw new SpotifyError('Spotify only accepts https:// redirect addresses, or http://127.0.0.1', 400);
    for (const [k, v] of this.auths) if (Date.now() - v.at > AUTH_TTL_MS) this.auths.delete(k);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(12).toString('hex');
    this.auths.set(state, { verifier, redirectUri, driver, at: Date.now() });
    return { url: authorizeUrl({ clientId: cid, redirectUri, state, challenge }) };
  }

  /** The redirect came back (directly, or pasted from the phone's address bar). */
  async finishAuth(input: { code: string; state: string } | { url: string }): Promise<{ driver: string; user: string | null }> {
    const parsed = 'url' in input ? codeFromUrl(input.url) : input;
    if ('error' in parsed) throw new SpotifyError(parsed.error, 400);
    const a = this.auths.get(parsed.state);
    if (!a || Date.now() - a.at > AUTH_TTL_MS) throw new SpotifyError('That sign-in has expired or came from another start: press Connect again', 400);
    this.auths.delete(parsed.state);
    await this.tokens.exchange(a.driver, parsed.code, a.redirectUri, a.verifier);
    let user: string | null = null;
    try { const me = await this.api.me(a.driver); user = me.display_name ?? me.id ?? null; } catch { /* name is a nicety */ }
    this.media.mutate((s) => { const t = s.spotify.tokens[a.driver]; if (t) t.user = user; });
    return { driver: a.driver, user };
  }

  disconnect(driver: string) { this.media.mutate((s) => { delete s.spotify.tokens[driver]; }); if (driver === this.driver()) { this.last = null; this.report(null); } }

  // ---- playback ------------------------------------------------------------------

  private onTruck(p: SpotifyPlayback | null) { return !!p?.device && p.device.name === this.media.get().spotify.deviceName; }

  async poll(): Promise<SpotifyPlayback | null> {
    const d = this.driver();
    if (!this.media.get().spotify.tokens[d] || !this.online()) { if (this.last) { this.last = null; this.report(null); } return null; }
    try {
      const p = await this.api.playback(d);
      this.last = p; this.lastMsg = null;
      this.report(p && p.playing && this.onTruck(p) && (p.title || p.artist) ? { title: p.title, artist: p.artist, album: p.album, source: 'spotify' } : null);
      return p;
    } catch (e) { this.lastMsg = (e as Error).message; return this.last; }
  }

  status(): SpotifyStatus {
    const s = this.media.get().spotify;
    const t = s.tokens[this.driver()];
    return {
      clientId: !!s.clientId, deviceName: s.deviceName, librespot: this.childState, librespotError: this.childErr,
      connected: !!t, user: t?.user ?? null, playback: this.last, onTruck: this.onTruck(this.last), message: this.lastMsg,
    };
  }

  /** The truck's Connect device id, or a clear reason it isn't visible. */
  private async truckDevice(d: string): Promise<string> {
    const name = this.media.get().spotify.deviceName;
    const devs = await this.api.devices(d);
    const dev = devs.find((x) => x.name === name);
    if (!dev) throw new SpotifyError(this.childState === 'running' ? `"${name}" isn't in this account's devices yet: on the phone, open Spotify, tap the devices icon and pick "${name}" once` : `"${name}" isn't online: librespot is ${this.childState} on the Pi`, 404);
    return dev.id;
  }

  async command(cmd: string, body: Record<string, unknown> = {}): Promise<SpotifyPlayback | null> {
    const d = this.driver();
    switch (cmd) {
      case 'play': await this.api.call(d, 'PUT', '/me/player/play'); break;
      case 'pause': await this.api.call(d, 'PUT', '/me/player/pause'); break;
      case 'next': await this.api.call(d, 'POST', '/me/player/next'); break;
      case 'previous': await this.api.call(d, 'POST', '/me/player/previous'); break;
      case 'transfer': await this.api.call(d, 'PUT', '/me/player', { device_ids: [await this.truckDevice(d)], play: true }); break;
      case 'playlist': {
        const uri = typeof body.uri === 'string' && /^spotify:(playlist|album|artist|show):[A-Za-z0-9]+$/.test(body.uri) ? body.uri : null;
        if (!uri) throw new SpotifyError('uri must be a spotify:playlist:… id', 400);
        await this.api.call(d, 'PUT', `/me/player/play?device_id=${encodeURIComponent(await this.truckDevice(d))}`, { context_uri: uri });
        break;
      }
      default: throw new SpotifyError(`unknown command ${cmd}`, 400);
    }
    await new Promise((r) => setTimeout(r, 400)); // Spotify takes a moment to reflect a command
    return this.poll();
  }
}
