// The login gate end to end through Fastify's inject: the dash (localhost) is open,
// another device needs the password once one is set.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'gate-'));
process.env.DATA_DIR = dir;
process.env.MQTT_DISABLED = '1';
process.env.GEOCODE_DISABLED = '1';

describe('login gate', async () => {
  const { openDb } = await import('../src/db.ts');
  const { SettingsStore } = await import('../src/settings.ts');
  const { Brain } = await import('../src/brain.ts');
  const { buildServer } = await import('../src/server.ts');
  const db = openDb(dir);
  const brain = new Brain(db, new SettingsStore(dir));
  const app = await buildServer(brain);
  const phone = '10.42.0.23';

  it('is open until a password is set', async () => {
    expect((await app.inject({ url: '/api/settings', remoteAddress: phone })).statusCode).toBe(200);
  });

  it('after the first password: phone needs a login, the dash does not', async () => {
    const set = await app.inject({ method: 'POST', url: '/api/auth/password', remoteAddress: '127.0.0.1', payload: { next: 'truck-pass-1' } });
    expect(set.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/settings', remoteAddress: phone })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/settings', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/health', remoteAddress: phone })).statusCode).toBe(200);
    const page = await app.inject({ url: '/settings', remoteAddress: phone });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/login?next=%2Fsettings');
  });

  it('changing the password needs the current one, even on the dash', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/password', remoteAddress: '127.0.0.1', payload: { next: 'another-pass' } });
    expect(r.statusCode).toBe(401);
  });

  it('logs in with a session cookie; wrong passwords get rate limited', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: phone, payload: { password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: phone, payload: { password: 'truck-pass-1' } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    expect(cookie).toMatch(/^slate_session=/);
    expect(String(ok.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await app.inject({ url: '/api/settings', remoteAddress: phone, headers: { cookie } })).statusCode).toBe(200);
    const thief = '10.42.0.99';
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: thief, payload: { password: `guess${i}` } })).statusCode;
    expect(last).toBe(429);
    // even the right password waits out the lock
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: thief, payload: { password: 'truck-pass-1' } })).statusCode).toBe(429);
    await app.close();
    db.close();
  });
});
