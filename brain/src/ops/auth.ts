// Password for /settings, /truck and the API when reached from another device
// (a phone on the truck's Wi-Fi, Tailscale). The dash itself (the kiosk on the
// Pi, talking to localhost) stays open. scrypt from node:crypto, a session
// cookie, and a rate-limited login.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Db } from '../db.ts';

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, o, (e, k) => (e ? rej(e) : res(k))));

export const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64 };
export const MIN_PASSWORD = 8;

/** "scrypt$N$r$p$salt$hash" (base64). */
export async function hashPassword(pw: string, params = SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((x) => Number.isInteger(x) && x > 0) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], 'base64'), want = Buffer.from(parts[5], 'base64');
  const got = await scrypt(pw.normalize('NFKC'), salt, want.length, { N, r, p, maxmem: 256 * N * r });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function checkNewPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new AuthError(`password must be at least ${MIN_PASSWORD} characters`, 400);
  if (pw.length > 200) throw new AuthError('password is too long', 400);
  return pw;
}

export class AuthError extends Error {
  status: number; retryAfterS: number | null;
  constructor(message: string, status: number, retryAfterS: number | null = null) { super(message); this.status = status; this.retryAfterS = retryAfterS; }
}

/**
 * Failed logins per key (IP) in a sliding window; at `max` the key is locked
 * for `lockMs`. A success clears the key. Pure apart from the clock you pass.
 */
export class RateLimiter {
  private fails = new Map<string, number[]>();
  private locked = new Map<string, number>();
  readonly max: number; readonly windowMs: number; readonly lockMs: number;

  constructor(max = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000) { this.max = max; this.windowMs = windowMs; this.lockMs = lockMs; }

  /** ms until this key may try again, 0 = now. */
  blockedFor(key: string, now = Date.now()): number {
    const until = this.locked.get(key) ?? 0;
    if (until > now) return until - now;
    if (until) this.locked.delete(key);
    return 0;
  }

  fail(key: string, now = Date.now()) {
    const recent = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.fails.set(key, recent);
    if (recent.length >= this.max) { this.locked.set(key, now + this.lockMs); this.fails.delete(key); }
    if (this.fails.size > 10_000) this.fails.clear(); // a flood of keys: forget, the lock list still holds
  }

  ok(key: string) { this.fails.delete(key); this.locked.delete(key); }
}

export const SESSION_COOKIE = 'slate_session';
export const SESSION_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Sessions in SQLite (only a hash of the token), so a brain restart or update doesn't log everyone out. */
export class Sessions {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT)');
  }

  create(ip: string | null, now = Date.now()): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?)').run(sha(token), new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86_400_000).toISOString(), ip);
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
    return token;
  }

  valid(token: string | undefined, now = Date.now()): boolean {
    if (!token || token.length > 100) return false;
    const r = this.db.prepare('SELECT expires_at FROM sessions WHERE hash = ?').get(sha(token)) as { expires_at: string } | undefined;
    return !!r && Date.parse(r.expires_at) > now;
  }

  revoke(token: string | undefined) { if (token) this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(token)); }
  revokeAll() { this.db.prepare('DELETE FROM sessions').run(); }
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed */ }
  }
  return out;
}

/** The dash: a request from the Pi itself. */
export const isLocal = (ip: string | undefined) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Paths that need a login from another device. Pure. */
export function needsAuth(method: string, url: string): 'page' | 'api' | null {
  const p = url.split('?')[0];
  if (p === '/settings' || p.startsWith('/settings/') || p === '/settings.html' || p === '/truck' || p.startsWith('/truck/') || p === '/truck.html') return 'page';
  if (p === '/ws') return 'api';
  if (p.startsWith('/api/')) {
    if (p === '/api/health' || p === '/api/about' || p === '/api/update/version' || p.startsWith('/api/auth/')) return null;
    // The truck photo is shown on the dash and the Truck page; only changing it needs the login.
    if (p === '/api/vehicle/photo' && (method === 'GET' || method === 'HEAD')) return null;
    // Tasker on the dash tablet reads its sleep timing here and has no login; changing it is a Settings save.
    if (p === '/api/tablet/sleep' && (method === 'GET' || method === 'HEAD')) return null;
    return 'api';
  }
  return null;
}

// ---- read-only access keys --------------------------------------------------------
// For a helper outside the truck's network (e.g. Claude checking a deploy) to read
// state without the password: an `Authorization: Bearer ta_ro_…` header. A key
// only ever opens GET requests to KEY_READABLE paths, never settings (they hold
// secrets), backups, logs, cameras or the websocket (it carries commands).
// Only a hash is stored; the key is shown once, at creation.

export const KEY_PREFIX = 'ta_ro_';
export const KEY_READABLE = ['/api/state', '/api/drive', '/api/charges', '/api/trips', '/api/update', '/api/maps', '/api/routing', '/api/sim', '/api/traffic', '/api/weather', '/api/roadtrip', '/api/pickup', '/api/network', '/api/health', '/api/about'];
const KEY_NEVER = ['/api/charges/receipts'];

/** Can an access key read this request? Pure. */
export function keyMayRead(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const p = url.split('?')[0];
  if (KEY_NEVER.some((x) => p === x || p.startsWith(x + '/'))) return false;
  return KEY_READABLE.some((x) => p === x || p.startsWith(x + '/'));
}

/** The token of an `Authorization: Bearer …` header, if it looks like an access key. Pure. */
export function bearerKey(h: unknown): string | null {
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m && m[1].startsWith(KEY_PREFIX) && m[1].length <= 100 ? m[1] : null;
}

export type AccessKey = { id: number; name: string; createdAt: string; lastUsedAt: string | null };

export class AccessKeys {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS access_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT)');
  }

  /** A new key: returned once, stored only as a hash. */
  create(name: string, now = Date.now()): { key: string } & AccessKey {
    const n = name.trim().slice(0, 60) || 'Access key';
    const key = KEY_PREFIX + randomBytes(32).toString('base64url');
    const at = new Date(now).toISOString();
    const r = this.db.prepare('INSERT INTO access_keys (name, hash, created_at) VALUES (?, ?, ?)').run(n, sha(key), at);
    return { key, id: Number(r.lastInsertRowid), name: n, createdAt: at, lastUsedAt: null };
  }

  list(): AccessKey[] {
    return (this.db.prepare('SELECT id, name, created_at, last_used_at FROM access_keys ORDER BY id').all() as { id: number; name: string; created_at: string; last_used_at: string | null }[])
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  }

  revoke(id: number): boolean { return Number(this.db.prepare('DELETE FROM access_keys WHERE id = ?').run(id).changes) > 0; }

  /** Valid key? Marks it used (at most once a minute, to spare the database). */
  valid(key: string | null, now = Date.now()): boolean {
    if (!key) return false;
    const r = this.db.prepare('SELECT id, last_used_at FROM access_keys WHERE hash = ?').get(sha(key)) as { id: number; last_used_at: string | null } | undefined;
    if (!r) return false;
    if (!r.last_used_at || now - Date.parse(r.last_used_at) > 60_000) this.db.prepare('UPDATE access_keys SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), r.id);
    return true;
  }
}
