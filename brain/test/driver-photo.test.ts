// Each driver's photo (/api/drivers/:id/photo): stored per driver, shown in
// place of the initials, kept behind the login from other devices, and gone
// with the driver.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { driverPhotoOf, driverPhotoUrl } from '../src/drive/driverPhoto.ts';
import { needsAuth } from '../src/ops/auth.ts';
import { mergeDriver, newDriver } from '../src/settings.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF = new TextEncoder().encode('GIF89a......');

describe('driver photo record', () => {
  it('names only that driver’s own file; anything else is no photo', () => {
    const at = '2026-11-09T10:00:00.000Z';
    expect(driverPhotoOf({ file: 'sam.jpg', updatedAt: at }, 'sam')).toEqual({ file: 'sam.jpg', updatedAt: at });
    expect(driverPhotoOf({ file: 'jeff.jpg', updatedAt: at }, 'sam')).toBeNull();
    expect(driverPhotoOf({ file: '../settings.json', updatedAt: at }, 'sam')).toBeNull();
    expect(driverPhotoOf({ file: 'sam.gif', updatedAt: at }, 'sam')).toBeNull();
    expect(driverPhotoOf({ file: 'sam.jpg', updatedAt: 'soon' }, 'sam')).toBeNull();
    expect(driverPhotoUrl({ id: 'sam', photo: { file: 'sam.jpg', updatedAt: at } })).toBe(`/api/drivers/sam/photo?v=${encodeURIComponent(at)}`);
    expect(driverPhotoUrl({ id: 'sam', photo: null })).toBeNull();
  });

  it('cannot be set through PUT /api/drivers/:id', () => {
    const d = newDriver('sam', 'Sam');
    expect(mergeDriver(d, { photo: { file: 'sam.jpg', updatedAt: '2026-11-09T10:00:00.000Z' } }).photo).toBeNull();
  });

  it('is shown on the Pi but needs the login from a phone, unlike the truck photo', () => {
    expect(needsAuth('GET', '/api/drivers/sam/photo')).toBe('api');
    expect(needsAuth('GET', '/api/vehicle/photo')).toBeNull();
  });
});

describe('/api/drivers/:id/photo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dphoto-'));
  process.env.DATA_DIR = dir;
  process.env.MQTT_DISABLED = '1';
  process.env.GEOCODE_DISABLED = '1';
  const { openDb } = await import('../src/db.ts');
  const { SettingsStore } = await import('../src/settings.ts');
  const { Brain } = await import('../src/brain.ts');
  const { buildServer } = await import('../src/server.ts');
  const brain = new Brain(openDb(dir), new SettingsStore(dir));
  const app = await buildServer(brain);
  const file = (f: string) => path.join(dir, 'driver-photos', f);

  it('uploads, shows in the live state, replaces, deletes', async () => {
    expect((await app.inject({ url: '/api/drivers/sam/photo' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/drivers/nobody/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/drivers/sam/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(GIF) })).statusCode).toBe(400);
    const up = await app.inject({ method: 'POST', url: '/api/drivers/sam/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) });
    expect(up.statusCode).toBe(200);
    const photo = up.json().photo;
    expect(photo.file).toBe('sam.jpg');
    expect(existsSync(file('sam.jpg'))).toBe(true);
    const got = await app.inject({ url: '/api/drivers/sam/photo' });
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.rawPayload.equals(Buffer.from(JPEG))).toBe(true);
    expect((await app.inject({ url: `/api/drivers/sam/photo?v=${encodeURIComponent(photo.updatedAt)}` })).headers['cache-control']).toBe('private, max-age=86400');

    brain.setDriver('sam');
    expect(brain.getState().driver?.photo).toBe(`/api/drivers/sam/photo?v=${encodeURIComponent(photo.updatedAt)}`);

    const png = await app.inject({ method: 'POST', url: '/api/drivers/sam/photo', headers: { 'content-type': 'image/png' }, payload: Buffer.from(PNG) });
    expect(png.json().photo.file).toBe('sam.png');
    expect(existsSync(file('sam.jpg'))).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: '/api/drivers/sam/photo' })).json()).toEqual({ photo: null });
    expect(existsSync(file('sam.png'))).toBe(false);
    expect(brain.getState().driver?.photo).toBeNull();
  });

  it('goes with the driver', async () => {
    await app.inject({ method: 'POST', url: '/api/drivers/jordan/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) });
    expect(existsSync(file('jordan.jpg'))).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: '/api/drivers/jordan' })).statusCode).toBe(204);
    expect(existsSync(file('jordan.jpg'))).toBe(false);
  });

  it('with a password set, a phone needs the login to see or change it', async () => {
    await app.inject({ method: 'POST', url: '/api/drivers/sam/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) });
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', remoteAddress: '127.0.0.1', payload: { next: 'truck-pass-1' } })).statusCode).toBe(200);
    const phone = '10.42.0.23';
    expect((await app.inject({ url: '/api/drivers/sam/photo', remoteAddress: phone })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/drivers/sam/photo', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
  });
});
