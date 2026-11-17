// The dash tablet's music apps (Pandora, YouTube Music, Amazon Music, Spotify):
// the cockpit's buttons go to Tasker; Tasker reports what's playing (tablet.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.ts';
import { needsAuth } from '../src/ops/auth.ts';
import { parseTabletMedia, Tablet, TABLET_MEDIA_STALE_MS, tabletNowPlaying } from '../src/tablet.ts';

const NOW = new Date('2026-11-17T18:00:00Z');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-T738U) Chrome/130';
const tablet = () => { const t = new Tablet(openDb(mkdtempSync(path.join(tmpdir(), 'tmedia-')), { sim: true })); t.hello('10.42.0.20', ANDROID); return t; };

afterEach(() => vi.unstubAllGlobals());

describe("Tasker's now-playing report", () => {
  it('takes title, artist, album, app, package and playing', () => {
    expect(parseTabletMedia({ title: 'Ventura Highway', artist: 'America', album: 'Homecoming', pkg: 'com.pandora.android', playing: 'true' }, NOW))
      .toEqual({ title: 'Ventura Highway', artist: 'America', album: 'Homecoming', app: 'Pandora', pkg: 'com.pandora.android', playing: true, at: NOW.toISOString() });
  });
  it('splits one "Artist - Title" line, and reads Tasker\'s unset variables as nothing', () => {
    const m = parseTabletMedia({ track: 'America - Sister Golden Hair', album: '%mt_album', app: 'YouTube Music', playing: '%mt_playing' }, NOW)!;
    expect([m.artist, m.title, m.album, m.app, m.playing]).toEqual(['America', 'Sister Golden Hair', null, 'YouTube Music', true]);
  });
  it('is nothing with no song, and paused is not on the dash', () => {
    expect(parseTabletMedia({ title: '%mt_title', playing: 'false' }, NOW)).toBeNull();
    expect(parseTabletMedia('junk', NOW)).toBeNull();
    const paused = parseTabletMedia({ title: 'Horse with No Name', playing: 'paused' }, NOW);
    expect(paused?.playing).toBe(false);
    expect(tabletNowPlaying(paused)).toBeNull();
    expect(tabletNowPlaying(parseTabletMedia({ title: 'Horse with No Name' }, NOW))).toEqual({ title: 'Horse with No Name', artist: null, album: null, source: 'tablet' });
  });
  it('is taken only from the tablet itself, with no login', () => {
    const t = tablet();
    expect(t.report('10.42.0.99', { title: 'x' }).ok).toBe(false);
    expect(t.report('::ffff:10.42.0.20', { title: 'Tin Man' }, NOW)).toMatchObject({ ok: true, media: { title: 'Tin Man' } });
    expect(new Tablet(openDb(mkdtempSync(path.join(tmpdir(), 'tmedia-')), { sim: true })).report('10.42.0.20', { title: 'x' }).ok).toBe(false);
    expect(needsAuth('POST', '/api/tablet/nowplaying')).toBeNull();
    expect(needsAuth('GET', '/api/tablet/media')).toBe('api');
    expect(needsAuth('POST', '/api/tablet/media')).toBe('api');
  });
  it('a bare playing/paused keeps the last song (its card and Play button stay)', () => {
    const t = tablet();
    t.report('10.42.0.20', { title: 'Tin Man', pkg: 'com.pandora.android' }, NOW);
    expect(t.report('10.42.0.20', { playing: 'false' }, NOW)).toMatchObject({ ok: true, media: { title: 'Tin Man', playing: false } });
    expect(t.report('10.42.0.20', { playing: 'true' }, NOW)).toMatchObject({ ok: true, media: { title: 'Tin Man', playing: true } });
    expect(t.report('10.42.0.20', {}, NOW)).toMatchObject({ ok: true, media: null });
  });
  it('goes stale when Tasker stops sending', () => {
    const t = tablet();
    t.report('10.42.0.20', { title: 'Tin Man' }, NOW);
    expect(t.nowPlaying(NOW.getTime() + 60_000)?.title).toBe('Tin Man');
    expect(t.nowPlaying(NOW.getTime() + TABLET_MEDIA_STALE_MS + 1)).toBeNull();
  });
});

describe('media buttons', () => {
  it("send play/pause, next and previous to Tasker's Media Control on the tablet", async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => { calls.push(u); return new Response('ok'); });
    const t = tablet();
    expect(await t.mediaCmd('toggle')).toEqual({ ok: true });
    expect(await t.mediaCmd('next')).toEqual({ ok: true });
    expect(calls).toEqual(['http://10.42.0.20:1821/slate/media?cmd=toggle', 'http://10.42.0.20:1821/slate/media?cmd=next']);
    expect((await t.mediaCmd('rm -rf')).ok).toBe(false);
    expect(calls.length).toBe(2);
  });
  it('say so when Tasker does not answer', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('connect ECONNREFUSED'); });
    const r = await tablet().mediaCmd('prev');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/didn't answer/);
  });
});
