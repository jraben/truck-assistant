// DEMO=1: the integration gate. A demo brain is recorded and posted in public,
// so nothing in it may reach the owner's real accounts: Home Assistant, WOPR
// (Outlook calendar, mail, USPS), Spotify, Plex, phone push (ntfy), the tablet,
// backups over SSH, GitHub updates, or any LAN device. Rather than trust every
// client to check a flag, the process's outbound doors are wrapped once, at
// start-up, before any module that talks to the network is loaded:
//
//   - fetch: the invented services (src/demo/backend.ts) answer their own
//     hosts; a short list of public, anonymous data hosts (weather, OSM speed
//     limits, radio directories) and loopback pass; everything else fails like
//     an unreachable host.
//   - WebSocket, net/tls connect, http/https request: loopback and the public
//     list only.
//   - child_process: commands that reach other machines or change the host
//     (ssh, rsync, nmcli, systemctl, librespot, ...) never run.
//
// Blocked attempts are counted and logged once per host, never with a body.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';

/** Public data with no account behind it: fine to fetch from a demo truck. */
export const PUBLIC_HOSTS = [
  'api.weather.gov',            // NWS forecast and alerts (the Drive weather strip)
  'api.open-meteo.com',         // weather fallback
  'overpass-api.de', 'maps.mail.ru', // OpenStreetMap speed limits
  'opml.radiotime.com',         // AM/FM station directory
  'www.fueleconomy.gov',        // gas-vehicle picker
  'celestrak.org',              // the ISS orbit (camp mode's sky)
];
/** Suffixes: radio-browser.info runs several mirrors. */
const PUBLIC_SUFFIXES = ['.api.radio-browser.info'];

/** Commands a demo brain never starts: they reach other machines or change the host. */
export const BLOCKED_COMMANDS = new Set(['ssh', 'scp', 'rsync', 'curl', 'wget', 'nmcli', 'systemctl', 'shutdown', 'poweroff', 'reboot', 'librespot', 'bluetoothctl', 'git', 'npm']);

export class DemoBlockedError extends Error {
  code = 'EDEMOBLOCKED';
  constructor(what: string) { super(`blocked in DEMO mode: ${what}`); }
}

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || /^127\./.test(h) || h.endsWith('.localhost');
}

/** May a demo brain connect to this host for real? Pure. */
export function allowedHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  return isLoopback(h) || PUBLIC_HOSTS.includes(h) || PUBLIC_SUFFIXES.some((s) => h.endsWith(s)) || h === 'all.api.radio-browser.info';
}

/** A command's base name, for the blocklist ("/usr/bin/ssh" -> "ssh"). Pure. */
export function commandName(cmd: string): string {
  return path.basename(String(cmd).trim().split(/\s+/)[0] ?? '').replace(/\.exe$/i, '').toLowerCase();
}

export type FakeBackend = (url: URL, init: RequestInit | undefined) => Promise<Response | null>;

type GateStats = { installed: boolean; blocked: Map<string, number> };
export const gateStats: GateStats = { installed: false, blocked: new Map() };

function noteBlocked(what: string) {
  const n = (gateStats.blocked.get(what) ?? 0) + 1;
  gateStats.blocked.set(what, n);
  if (n === 1) console.log(`[demo] blocked ${what}`);
}

function urlOf(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    if (input && typeof input === 'object' && 'url' in input) return new URL(String((input as { url: string }).url));
  } catch { /* not a URL */ }
  return null;
}

/** The fetch a demo brain gets. Exported for tests (no globals touched). */
export function demoFetch(real: typeof fetch, backend: FakeBackend): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = urlOf(input);
    if (!u) throw new TypeError('fetch failed', { cause: new DemoBlockedError('a request with no URL') });
    const fake = await backend(u, init);
    if (fake) return fake;
    if ((u.protocol === 'http:' || u.protocol === 'https:') && allowedHost(u.hostname)) return real(input, init);
    noteBlocked(u.host || u.protocol);
    throw new TypeError('fetch failed', { cause: new DemoBlockedError(u.host) });
  }) as typeof fetch;
}

/** Host out of the many shapes net.connect / http.request take. */
function hostFromArgs(args: unknown[]): string | null {
  const a = args[0];
  if (typeof a === 'string') {
    if (/^[a-z]+:\/\//i.test(a)) { try { return new URL(a).hostname; } catch { return null; } }
    return null; // a unix socket path (net.connect(path)) is local
  }
  if (a instanceof URL) return a.hostname;
  if (typeof a === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (a && typeof a === 'object') {
    const o = a as { host?: string; hostname?: string; path?: string; socketPath?: string; port?: unknown };
    if (o.socketPath || (o.path && o.port === undefined && !o.host && !o.hostname)) return 'localhost';
    return o.hostname ?? o.host ?? 'localhost';
  }
  return null;
}

/** A process that never ran: emits the error the caller already handles for a missing binary. */
function deadChild(cmd: string, viaCallback: boolean): childProcess.ChildProcess {
  const c = new EventEmitter() as childProcess.ChildProcess;
  Object.assign(c, { pid: undefined, stdin: null, stdout: null, stderr: null, killed: false, exitCode: null, kill: () => false });
  const err = Object.assign(new DemoBlockedError(cmd), { code: 'ENOENT' });
  // Like execFile, a callback gets the error and the child stays quiet; like spawn, a bare child emits it.
  process.nextTick(() => { if (!viaCallback) c.emit('error', err); c.emit('close', -2, null); });
  return c;
}

/**
 * Wrap the process's outbound doors. Idempotent. `backend` answers the
 * invented services' hosts before anything is checked against the list.
 */
export function installDemoGate(backend: FakeBackend) {
  if (gateStats.installed) return;
  gateStats.installed = true;

  globalThis.fetch = demoFetch(globalThis.fetch.bind(globalThis), backend);

  const RealWs = globalThis.WebSocket;
  if (RealWs) {
    globalThis.WebSocket = new Proxy(RealWs, {
      construct(target, args: [string | URL, (string | string[])?]) {
        const u = urlOf(args[0]);
        if (!u || !allowedHost(u.hostname)) { noteBlocked(`WebSocket ${u?.host ?? '?'}`); throw new DemoBlockedError(`WebSocket to ${u?.host ?? '?'}`); }
        return new target(...args);
      },
    });
  }

  const guardConnect = <F extends (...a: never[]) => unknown>(real: F, label: string): F => (function (this: unknown, ...args: unknown[]) {
    const host = hostFromArgs(args);
    if (host !== null && !allowedHost(host)) {
      noteBlocked(`${label} ${host}`);
      const s = new net.Socket();
      process.nextTick(() => s.destroy(new DemoBlockedError(`${label} to ${host}`)));
      return s;
    }
    return (real as unknown as (...a: unknown[]) => unknown).apply(this, args);
  }) as unknown as F;
  net.connect = guardConnect(net.connect, 'net');
  net.createConnection = guardConnect(net.createConnection, 'net');
  tls.connect = guardConnect(tls.connect, 'tls');

  const guardRequest = <F extends (...a: never[]) => unknown>(real: F, label: string): F => (function (this: unknown, ...args: unknown[]) {
    const host = hostFromArgs(args);
    if (host !== null && !allowedHost(host)) { noteBlocked(`${label} ${host}`); throw new DemoBlockedError(`${label} to ${host}`); }
    return (real as unknown as (...a: unknown[]) => unknown).apply(this, args);
  }) as unknown as F;
  http.request = guardRequest(http.request, 'http');
  http.get = guardRequest(http.get, 'http');
  https.request = guardRequest(https.request, 'https');
  https.get = guardRequest(https.get, 'https');

  const cp = childProcess as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const fn of ['spawn', 'execFile', 'exec', 'fork'] as const) {
    const real = cp[fn];
    cp[fn] = function (this: unknown, ...args: unknown[]) {
      const cmd = commandName(String(args[0] ?? ''));
      if (!BLOCKED_COMMANDS.has(cmd)) return real.apply(this, args);
      noteBlocked(`command ${cmd}`);
      const cb = args.find((a) => typeof a === 'function') as ((e: Error, out: string, err: string) => void) | undefined;
      const child = deadChild(cmd, !!cb);
      if (cb) process.nextTick(() => cb(Object.assign(new DemoBlockedError(cmd), { code: 'ENOENT' }), '', ''));
      return child;
    };
  }
  for (const fn of ['spawnSync', 'execFileSync', 'execSync'] as const) {
    const real = cp[fn];
    cp[fn] = function (this: unknown, ...args: unknown[]) {
      const cmd = commandName(String(args[0] ?? ''));
      if (BLOCKED_COMMANDS.has(cmd)) { noteBlocked(`command ${cmd}`); throw Object.assign(new DemoBlockedError(cmd), { code: 'ENOENT' }); }
      return real.apply(this, args);
    };
  }
  // ESM named imports of built-ins (import { spawn } from 'node:child_process') follow the patches.
  syncBuiltinESMExports();
  console.log('[demo] integration gate on: only invented services, loopback and public data hosts');
}
