// HTTPS for the dash tablet: the same app as :8080, on :443 with a real certificate
// for the truck's own name (truck.jeffraben.com), so Chrome treats the cockpit as
// secure without flags: a proper full-screen app, CarPlay over USB, location, mic.
//
// The brain serves it itself (no proxy), so each request keeps the device's real
// address: the "trust this Pi's own screen" login rule (ops/routes.ts trustLocal)
// still only trusts the Pi itself, never every phone on the truck's Wi-Fi.
//
// The certificate is two files in <DATA_DIR>/tls (or HTTPS_CERT / HTTPS_KEY):
// fullchain.pem and privkey.pem. The NAS issues it and pushes it there
// (deploy/nas/push-truck-cert.sh); this checks them every minute, starts HTTPS
// when they first appear and swaps in a renewed one without a restart.
// Docs: deploy/pi/https/README.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

export type TlsPaths = { cert: string; key: string };
export type HttpsStatus = { on: boolean; port: number; names: string[]; validTo: string | null; daysLeft: number | null; error: string | null };

export const tlsPaths = (dataDir: string, env: NodeJS.ProcessEnv = process.env): TlsPaths => ({
  cert: env.HTTPS_CERT ?? path.join(dataDir, 'tls', 'fullchain.pem'),
  key: env.HTTPS_KEY ?? path.join(dataDir, 'tls', 'privkey.pem'),
});

/** The names and expiry of a PEM certificate (the first in the chain). Pure. */
export function certInfo(pem: string, now = Date.now()): { names: string[]; validTo: string; daysLeft: number } {
  const x = new X509Certificate(pem);
  const names = (x.subjectAltName ?? '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4));
  if (!names.length) { const cn = /CN=([^\n,]+)/.exec(x.subject)?.[1]; if (cn) names.push(cn); }
  const to = new Date(x.validTo);
  return { names, validTo: to.toISOString(), daysLeft: Math.floor((to.getTime() - now) / 86_400_000) };
}

export class HttpsServer {
  private server: Server | null = null;
  private stamp = '';
  private timer: NodeJS.Timeout | null = null;
  private st: HttpsStatus;

  private app: FastifyInstance;
  private paths: TlsPaths;
  private port: number;
  private host: string;

  constructor(app: FastifyInstance, paths: TlsPaths, port: number, host: string) {
    this.app = app; this.paths = paths; this.port = port; this.host = host;
    this.st = { on: false, port, names: [], validTo: null, daysLeft: null, error: null };
  }

  status(): HttpsStatus { return { ...this.st }; }

  /** Look now and every minute after. */
  start(everyMs = 60_000) {
    if (this.port <= 0) return;
    this.check();
    this.timer = setInterval(() => this.check(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.server?.close();
    this.server = null;
  }

  /** Start or refresh when the files are there and changed; keep the old certificate if the new pair is bad. */
  check() {
    const { cert, key } = this.paths;
    if (!existsSync(cert) || !existsSync(key)) return;
    let stamp: string;
    try { stamp = `${statSync(cert).mtimeMs}:${statSync(key).mtimeMs}`; } catch { return; }
    if (stamp === this.stamp) { if (this.st.validTo) this.st.daysLeft = Math.floor((Date.parse(this.st.validTo) - Date.now()) / 86_400_000); return; }
    let pair: { cert: Buffer; key: Buffer };
    try {
      pair = { cert: readFileSync(cert), key: readFileSync(key) };
      createSecureContext(pair); // throws when the key doesn't match the certificate
    } catch (e) {
      this.st.error = `certificate not used: ${(e as Error).message}`;
      console.error('[https]', this.st.error);
      return;
    }
    this.stamp = stamp;
    try { Object.assign(this.st, certInfo(pair.cert.toString('utf8')), { error: null }); } catch { /* names are only for show */ }
    if (this.server) {
      this.server.setSecureContext(pair);
      console.log(`[https] certificate renewed: ${this.st.names.join(', ')}, valid to ${this.st.validTo}`);
      return;
    }
    const srv = createServer(pair, (req, res) => (this.app as unknown as { routing: (a: unknown, b: unknown) => void }).routing(req, res));
    // WebSockets (/ws) on :443 go to the same handler as on :8080.
    srv.on('upgrade', (req, socket, head) => this.app.server.emit('upgrade', req, socket, head));
    srv.on('error', (e) => { this.st.on = false; this.st.error = `HTTPS on :${this.port} failed: ${(e as Error).message}`; console.error('[https]', this.st.error); });
    srv.listen(this.port, this.host, () => {
      this.st.on = true;
      console.log(`[https] serving https://${this.st.names[0] ?? 'this-pi'}${this.port === 443 ? '' : `:${this.port}`} (valid to ${this.st.validTo})`);
    });
    this.server = srv;
  }
}
