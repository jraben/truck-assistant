// The truck as built (Settings.truck additions) and its photo (/api/vehicle/photo).
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILD_ACCESSORIES, defaultTruck, parseSlateShareUrl, validateTruck } from '../src/drive/settings.ts';
import { checkPhotoBytes, checkPhotoUrl, fetchPhoto, PHOTO_MAX, PhotoError, sniffImage } from '../src/drive/photo.ts';
import { needsAuth } from '../src/ops/auth.ts';
import { defaultSettings, loadSettings, mergeSettings, migrateSettings } from '../src/settings.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = new TextEncoder().encode('RIFF\x10\x00\x00\x00WEBPVP8 ');
const GIF = new TextEncoder().encode('GIF89a......');

describe('Slate share link', () => {
  it('accepts /share/<code> and the store shortcode link', () => {
    expect(parseSlateShareUrl('https://www.slate.auto/share/ABC123')).toEqual({ url: 'https://www.slate.auto/share/ABC123', code: 'ABC123' });
    expect(parseSlateShareUrl('  https://slate.auto/share/ABC123/ ')?.code).toBe('ABC123');
    expect(parseSlateShareUrl('https://www.slate.auto/store?trim=blank&shortcode=ABC123')?.code).toBe('ABC123');
  });
  it('rejects anything else', () => {
    for (const bad of [
      'http://www.slate.auto/share/ABC123', 'https://www.slate.auto.evil.com/share/ABC123', 'https://evil.com/share/ABC123',
      'https://www.slate.auto/share/', 'https://www.slate.auto/share/U7K/extra', 'https://www.slate.auto/share/<script>',
      'https://www.slate.auto/store?trim=blank', 'https://user:pw@www.slate.auto/share/ABC123', 'https://www.slate.auto:8443/share/ABC123',
      'javascript:alert(1)', 'ABC123', '', 42, null,
    ]) expect(parseSlateShareUrl(bad), String(bad)).toBeNull();
  });
  it('is validated in Settings.truck ("" or null clears it)', () => {
    expect(validateTruck({ slateShareUrl: 'https://www.slate.auto/share/ABC123' }).slateShareUrl).toBe('https://www.slate.auto/share/ABC123');
    expect(validateTruck({ slateShareUrl: '' }).slateShareUrl).toBeNull();
    expect(() => validateTruck({ slateShareUrl: 'https://example.com/share/ABC123' })).toThrow(/Slate build link/);
  });
});

describe('Settings.truck: the build', () => {
  it('fresh installs get the author\'s build', () => {
    const t = defaultTruck();
    expect(t.colors).toMatchObject({ body: '#b5272d', roof: '#e4e5e0', wheelDecal: '#e4e5e0', lampPlates: 'synthwave' });
    expect(t.interior).toEqual({ bolster: 'none', armrest: 'Cardinal' });
    expect(t.accessoryList).toEqual(BUILD_ACCESSORIES);
    expect(t.accessoryList).toHaveLength(23);
    expect(t.accessoryList).toContain('Slate Telematics Module');
    expect(t.accessoryList).toContain('CCS to NACS Adapter');
    expect(t.photo).toBeNull();
    expect(validateTruck(undefined)).toEqual(t);
  });
  it('logo can be none; interior takes Slate colour names only', () => {
    expect(validateTruck({ colors: { logo: 'none' } }).colors.logo).toBe('none');
    expect(() => validateTruck({ colors: { logo: 'nope' } })).toThrow(/#rrggbb or none/);
    expect(validateTruck({ interior: { bolster: 'sterling slate' } }).interior).toEqual({ bolster: 'Sterling Slate', armrest: 'Cardinal' });
    expect(validateTruck({ interior: { bolster: 'none' } }).interior.bolster).toBe('none');
    expect(() => validateTruck({ interior: { armrest: 'Puce' } })).toThrow(/colour names/);
    expect(validateTruck({ accessoryList: [' Tablet Mount ', ''] }).accessoryList).toEqual(['Tablet Mount']);
    expect(() => validateTruck({ accessoryList: 'Tablet Mount' })).toThrow(/list/);
  });
  it('migrates an existing truck without losing its values', () => {
    const old = { colors: { body: '#123456', roof: '#abcdef', logo: '#1c1d1f', wheelDecal: '#e4e5e0', lampPlates: '#ff0000', trim: '#5e6368' }, finish: 'gloss', roofWrap: false, wheels: { inches: 17, style: 'steel' }, accessories: { tonneau: 'none', hitch: false, bedLights: true } };
    const s = loadSettings(migrateSettings({ drivers: [{ id: 'jeff', name: 'Jeff' }], truck: old }));
    expect(s.truck.colors).toEqual(old.colors);
    expect(s.truck.finish).toBe('gloss');
    expect(s.truck.roofWrap).toBe(false);
    expect(s.truck.accessories).toEqual(old.accessories);
    expect(s.truck.interior).toEqual({ bolster: 'none', armrest: 'Cardinal' });
    expect(s.truck.slateShareUrl).toBeNull();
    expect(s.truck.accessoryList).toEqual(BUILD_ACCESSORIES);
    expect(s.truck.photo).toBeNull();
  });
  it('a stored photo record survives a load; a bad one becomes null rather than resetting the file', () => {
    const photo = { file: 'vehicle-photo.jpg', updatedAt: '2026-11-05T12:00:00.000Z', source: 'url' };
    expect(loadSettings(migrateSettings({ drivers: [{ id: 'j', name: 'J' }], truck: { photo } })).truck.photo).toEqual(photo);
    const bad = loadSettings(migrateSettings({ drivers: [{ id: 'j', name: 'J' }], packKwh: 60, truck: { photo: { file: '../../etc/passwd', updatedAt: 'x' } } }));
    expect(bad.truck.photo).toBeNull();
    expect(bad.packKwh).toBe(60);
  });
  it('PUT /api/settings cannot set the photo, and keeps the one there', () => {
    const base = defaultSettings();
    base.truck.photo = { file: 'vehicle-photo.png', updatedAt: '2026-11-05T12:00:00.000Z', source: 'upload' };
    const n = mergeSettings(base, { truck: { photo: { file: 'vehicle-photo.jpg', updatedAt: '2026-11-06T00:00:00.000Z', source: 'url' }, colors: { logo: 'none' }, accessoryList: ['Tablet Mount'] } });
    expect(n.truck.photo).toEqual(base.truck.photo);
    expect(n.truck.colors.logo).toBe('none');
    expect(n.truck.accessoryList).toEqual(['Tablet Mount']);
  });
});

describe('truck photo checks', () => {
  it('knows JPEG, PNG and WebP by their magic bytes, nothing else', () => {
    expect(sniffImage(JPEG)).toBe('jpg');
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(WEBP)).toBe('webp');
    expect(sniffImage(GIF)).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<svg xmlns=...>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
  it('an upload must be an image of at most 6 MB', () => {
    expect(checkPhotoBytes(JPEG)).toBe('jpg');
    expect(() => checkPhotoBytes(GIF)).toThrow(/JPEG, PNG or WebP/);
    expect(() => checkPhotoBytes(new Uint8Array(0))).toThrow(/no image/);
    const big = new Uint8Array(PHOTO_MAX + 1); big.set(JPEG);
    try { checkPhotoBytes(big); expect.unreachable(); } catch (e) { expect((e as PhotoError).status).toBe(413); }
    const max = new Uint8Array(PHOTO_MAX); max.set(PNG);
    expect(checkPhotoBytes(max)).toBe('png');
  });
  it('a URL must be https without a login', () => {
    expect(checkPhotoUrl('https://example.com/a.jpg').hostname).toBe('example.com');
    expect(() => checkPhotoUrl('http://example.com/a.jpg')).toThrow(/https/);
    expect(() => checkPhotoUrl('file:///etc/passwd')).toThrow(/https/);
    expect(() => checkPhotoUrl('https://u:p@example.com/a.jpg')).toThrow(/login/);
    expect(() => checkPhotoUrl('not a url')).toThrow(/valid/);
  });
});

/** A fake fetch: path -> response. */
const fakeFetch = (routes: Record<string, () => Response>) => (async (u: URL | string) => {
  const k = String(u);
  const r = routes[k];
  if (!r) throw new Error(`unexpected fetch ${k}`);
  return r();
}) as typeof fetch;

describe('fetching a photo URL', () => {
  const img = (b: Uint8Array, type = 'image/jpeg', extra: Record<string, string> = {}) => () => new Response(b as Uint8Array<ArrayBuffer>, { headers: { 'content-type': type, ...extra } });
  it('follows https redirects and sniffs the bytes', async () => {
    const f = fakeFetch({ 'https://a.example/x': () => new Response(null, { status: 302, headers: { location: 'https://b.example/y.png' } }), 'https://b.example/y.png': img(PNG, 'image/png') });
    expect((await fetchPhoto('https://a.example/x', f)).ext).toBe('png');
  });
  it('refuses a redirect to http', async () => {
    const f = fakeFetch({ 'https://a.example/x': () => new Response(null, { status: 301, headers: { location: 'http://b.example/y.jpg' } }) });
    await expect(fetchPhoto('https://a.example/x', f)).rejects.toThrow(/non-https/);
  });
  it('refuses a non-image content type, and image bytes that are not an image', async () => {
    await expect(fetchPhoto('https://a.example/x', fakeFetch({ 'https://a.example/x': img(JPEG, 'text/html') }))).rejects.toThrow(/not an image/);
    await expect(fetchPhoto('https://a.example/x', fakeFetch({ 'https://a.example/x': img(GIF, 'image/gif') }))).rejects.toThrow(/JPEG, PNG or WebP/);
  });
  it('refuses more than 6 MB, by header or by counting', async () => {
    await expect(fetchPhoto('https://a.example/x', fakeFetch({ 'https://a.example/x': img(JPEG, 'image/jpeg', { 'content-length': String(PHOTO_MAX + 1) }) }))).rejects.toThrow(/over 6 MB/);
    const big = new Uint8Array(PHOTO_MAX + 10); big.set(JPEG);
    await expect(fetchPhoto('https://a.example/x', fakeFetch({ 'https://a.example/x': img(big) }))).rejects.toThrow(/over 6 MB/);
  });
  it('gives up after the timeout', async () => {
    const slow = ((_u: URL, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    await expect(fetchPhoto('https://a.example/x', slow, 50)).rejects.toThrow(/longer than/);
  });
});

describe('the photo routes and the login gate', async () => {
  it('GET is open; POST and DELETE need the login', () => {
    expect(needsAuth('GET', '/api/vehicle/photo?v=1')).toBeNull();
    expect(needsAuth('HEAD', '/api/vehicle/photo')).toBeNull();
    expect(needsAuth('POST', '/api/vehicle/photo')).toBe('api');
    expect(needsAuth('DELETE', '/api/vehicle/photo')).toBe('api');
  });

  const dir = mkdtempSync(path.join(tmpdir(), 'vphoto-'));
  process.env.DATA_DIR = dir;
  process.env.MQTT_DISABLED = '1';
  process.env.GEOCODE_DISABLED = '1';
  const { openDb } = await import('../src/db.ts');
  const { SettingsStore } = await import('../src/settings.ts');
  const { Brain } = await import('../src/brain.ts');
  const { buildServer } = await import('../src/server.ts');
  const db = openDb(dir);
  const brain = new Brain(db, new SettingsStore(dir));
  const app = await buildServer(brain);
  const phone = '10.42.0.23';

  it('uploads, serves with caching headers, replaces and deletes', async () => {
    expect((await app.inject({ url: '/api/vehicle/photo' })).statusCode).toBe(404);
    const bad = await app.inject({ method: 'POST', url: '/api/vehicle/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(GIF) });
    expect(bad.statusCode).toBe(400);
    const up = await app.inject({ method: 'POST', url: '/api/vehicle/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) });
    expect(up.statusCode).toBe(200);
    const photo = up.json().photo;
    expect(photo).toMatchObject({ file: 'vehicle-photo.jpg', source: 'upload' });
    expect(brain.settings.get().truck.photo).toEqual(photo);
    const got = await app.inject({ url: '/api/vehicle/photo', remoteAddress: phone });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['cache-control']).toBe('no-cache');
    expect(got.rawPayload.equals(Buffer.from(JPEG))).toBe(true);
    expect((await app.inject({ url: '/api/vehicle/photo', headers: { 'if-none-match': String(got.headers.etag) } })).statusCode).toBe(304);
    expect((await app.inject({ url: `/api/vehicle/photo?v=${encodeURIComponent(photo.updatedAt)}` })).headers['cache-control']).toMatch(/max-age/);
    // a PNG replaces it, and the old file goes
    const png = await app.inject({ method: 'POST', url: '/api/vehicle/photo', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(PNG) });
    expect(png.json().photo.file).toBe('vehicle-photo.png');
    expect(existsSync(path.join(dir, 'vehicle-photo.jpg'))).toBe(false);
    // http URLs are refused before any fetch
    expect((await app.inject({ method: 'POST', url: '/api/vehicle/photo', payload: { url: 'http://example.com/a.jpg' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/vehicle/photo' })).json()).toEqual({ photo: null });
    expect(existsSync(path.join(dir, 'vehicle-photo.png'))).toBe(false);
    expect((await app.inject({ url: '/api/vehicle/photo' })).statusCode).toBe(404);
  });

  it('with a password set, a phone needs the login to change it but not to see it', async () => {
    await app.inject({ method: 'POST', url: '/api/vehicle/photo', headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) });
    expect((await app.inject({ method: 'POST', url: '/api/auth/password', remoteAddress: '127.0.0.1', payload: { next: 'truck-pass-1' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/vehicle/photo', remoteAddress: phone })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/vehicle/photo', remoteAddress: phone, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(JPEG) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/vehicle/photo', remoteAddress: phone })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: phone, payload: { password: 'truck-pass-1' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'POST', url: '/api/vehicle/photo', remoteAddress: phone, headers: { cookie, 'content-type': 'image/png' }, payload: Buffer.from(PNG) })).statusCode).toBe(200);
    await app.close();
    db.close();
  });
});
