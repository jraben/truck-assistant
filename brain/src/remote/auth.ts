// Who may use the remote API (/truck, /api/truck, /api/cams, /api/remote, /api/alerts, /go2rtc).
//
// Minimal on purpose, and in one place so a real login (Track D) can replace
// it: the cockpit on the bar itself (loopback, or REMOTE_TRUSTED_NETS) is in;
// anyone else needs the remote token from /settings > Remote, sent as
// `x-slate-token`, `Authorization: Bearer`, `?token=` (links, iframes,
// WebSockets) or the `slate_remote` cookie the Truck page sets.
import { timingSafeEqual } from 'node:crypto';
import { isIPv4 } from 'node:net';

export const COOKIE = 'slate_remote';

function v4(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

/** Is `ip` inside one of `nets` ("127.0.0.0/8", "10.42.0.0/24", "::1", "100.64.0.0/10")? Pure. */
export function ipInNets(ipRaw: string, nets: string[]): boolean {
  const ip = ipRaw.replace(/^::ffff:/i, '');
  for (const net of nets) {
    const [base, bitsS] = net.split('/');
    if (!bitsS) { if (base.toLowerCase() === ip.toLowerCase()) return true; continue; }
    const a = v4(ip), b = v4(base), bits = Number(bitsS);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) continue;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((a & mask) === (b & mask)) return true;
  }
  return false;
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

type ReqLike = { ip: string; headers: Record<string, string | string[] | undefined>; query?: unknown };

export function tokenFrom(req: ReqLike): string | null {
  const h = req.headers;
  const x = h['x-slate-token'];
  if (typeof x === 'string' && x) return x;
  const auth = h.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof q === 'string' && q) return q;
  return cookieValue(typeof h.cookie === 'string' ? h.cookie : undefined, COOKIE);
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** The one check. Pure. */
export function allowed(req: ReqLike, token: string | undefined, trusted: string[]): boolean {
  if (ipInNets(req.ip, trusted)) return true;
  const t = tokenFrom(req);
  return !!(token && t && same(t, token));
}
