// The cockpit over HTTPS for the dash tablet (src/https.ts): same app, real client
// addresses, WebSockets, a renewed certificate swapped in without a restart.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certInfo, HttpsServer, tlsPaths } from '../src/https.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'tls-'));
const mk = (name: string, days = 90) => {
  const d = path.join(dir, name); mkdirSync(d);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', String(days),
    '-subj', `/CN=${name}`, '-addext', `subjectAltName=DNS:${name}`, '-keyout', path.join(d, 'privkey.pem'), '-out', path.join(d, 'fullchain.pem')], { stdio: 'ignore' });
  return { cert: readFileSync(path.join(d, 'fullchain.pem')), key: readFileSync(path.join(d, 'privkey.pem')) };
};
const PORT = 18000 + Math.floor(Math.random() * 1000);
const tls = path.join(dir, 'data', 'tls');
const paths = tlsPaths(path.join(dir, 'data'), {});
const app = Fastify();
let https: HttpsServer;

const get = (p: string) => new Promise<{ body: string; names: string }>((resolve, reject) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: p, rejectUnauthorized: false, agent: false }, (res) => {
    const names = String((res.socket as import('node:tls').TLSSocket).getPeerCertificate().subjectaltname);
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ body: b, names }));
  });
  r.on('error', reject); r.end();
});

beforeAll(async () => {
  await app.register(fastifyWebsocket);
  app.get('/api/ip', async (req) => ({ ip: req.ip }));
  app.get('/ws', { websocket: true }, (socket) => { socket.on('message', (m: Buffer) => socket.send(`echo ${m}`)); });
  await app.listen({ port: 0, host: '127.0.0.1' });
  https = new HttpsServer(app, paths, PORT, '127.0.0.1');
});
afterAll(async () => { https.stop(); await app.close(); });

describe('https for the dash tablet', () => {
  it('stays off until the certificate is there', () => {
    https.check();
    expect(https.status()).toMatchObject({ on: false, names: [] });
  });

  it('serves the same app with the real client address, and WebSockets', async () => {
    mkdirSync(tls, { recursive: true });
    const a = mk('truck.example.test');
    writeFileSync(paths.cert, a.cert); writeFileSync(paths.key, a.key);
    https.check();
    await new Promise((r) => setTimeout(r, 200));
    expect(https.status()).toMatchObject({ on: true, names: ['truck.example.test'], error: null });
    const r = await get('/api/ip');
    expect(JSON.parse(r.body).ip).toBe('127.0.0.1');
    expect(r.names).toBe('DNS:truck.example.test');
    const ws = new WebSocket(`wss://127.0.0.1:${PORT}/ws`, { rejectUnauthorized: false });
    const reply = await new Promise<string>((resolve, reject) => { ws.on('open', () => ws.send('hi')); ws.on('message', (m) => resolve(String(m))); ws.on('error', reject); });
    ws.close();
    expect(reply).toBe('echo hi');
  });

  it('swaps in a renewed certificate without a restart, and refuses a mismatched pair', async () => {
    const b = mk('truck2.example.test');
    writeFileSync(paths.cert, b.cert); writeFileSync(paths.key, b.key);
    const t = new Date(Date.now() + 5000); utimesSync(paths.cert, t, t); utimesSync(paths.key, t, t);
    https.check();
    expect((await get('/api/ip')).names).toBe('DNS:truck2.example.test');
    const c = mk('truck3.example.test');
    writeFileSync(paths.cert, c.cert); // key still truck2's: a bad pair
    const t2 = new Date(Date.now() + 10_000); utimesSync(paths.cert, t2, t2);
    https.check();
    expect(https.status().error).toMatch(/not used/);
    expect((await get('/api/ip')).names).toBe('DNS:truck2.example.test');
  });

  it('reads the names and days left', () => {
    const d = mk('days.example.test', 30);
    const i = certInfo(d.cert.toString());
    expect(i.names).toEqual(['days.example.test']);
    expect(i.daysLeft).toBeGreaterThanOrEqual(29);
  });
});
