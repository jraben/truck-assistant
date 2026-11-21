// Who sent a request, looking through the reverse proxy in front of the brain.
//
// On the NAS the cockpit is reached at https://ta.jeffraben.com: nginx on the host
// takes the request and hands it to the container, so the brain sees every one
// come from Docker's gateway (172.17.0.1). It then took that for the dash tablet's
// address and sent Tasker's calls there ("Play on the tablet" failed), and the
// "only the tablet reports now-playing" check let anyone through the proxy in.
//
// Only requests from a listed proxy (TRUSTED_PROXIES) have their forwarded
// address read, and only for the tablet's own features (its address, its song
// reports, its GPS). Logins and access checks keep the socket address, so a
// forged header can't make anyone "local".

import { ipInNets } from './remote/auth.ts';

type ReqLike = { ip: string; headers: Record<string, string | string[] | undefined> };

/** The proxies whose X-Forwarded-For / X-Real-IP are believed: "172.17.0.1", "10.0.0.0/8", ... */
export const trustedProxies = (env: string | undefined = process.env.TRUSTED_PROXIES): string[] =>
  (env ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(',') : v ?? '');

/**
 * The client's address: the socket's, unless that is a trusted proxy; then the
 * nearest address in X-Forwarded-For that isn't one (the proxy appends the real
 * client last, so anything the client put further left is ignored), else X-Real-IP. Pure.
 */
export function clientIp(req: ReqLike, proxies: string[] = trustedProxies()): string {
  const sock = (req.ip ?? '').replace(/^::ffff:/i, '');
  if (!proxies.length || !ipInNets(sock, proxies)) return sock;
  const chain = first(req.headers['x-forwarded-for']).split(',').map((s) => s.trim().replace(/^::ffff:/i, '')).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) if (!ipInNets(chain[i], proxies)) return chain[i];
  const real = first(req.headers['x-real-ip']).trim().replace(/^::ffff:/i, '');
  return real || sock;
}
