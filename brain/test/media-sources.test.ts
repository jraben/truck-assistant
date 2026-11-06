import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IcyParser, parseStreamTitle, splitStreamTitle } from '../src/media/icy.ts';
import { kjefPreset, mapStation, mapStations, mbPerHour } from '../src/media/radio.ts';
import { codeFromUrl, mapPlayback, pkcePair, REFRESH_EARLY_MS, SpotifyApi, SpotifyError, SpotifyTokens, tokenFrom } from '../src/media/spotify.ts';
import { parseRtlPower, pickSeek, rtlFmArgs, strongChannels } from '../src/media/fm.ts';
import { parseRange, safeJoin, trackInfo } from '../src/media/local.ts';
import { mapPlexItem, mapPlexList } from '../src/media/plex.ts';
import { KJEF_PUBLIC, maskMedia, mergeMedia, defaultMediaSettings, MediaSettingsError, MediaSettingsStore, type SpotifyToken } from '../src/media/settings.ts';
import { NowPlayingHub, parseMediaMessage } from '../src/media.ts';
import { createHash } from 'node:crypto';

describe('Radio Browser mapping', () => {
  const raw = {
    changeuuid: 'x', stationuuid: '9617a958-0601-11e8-ae97-52543be04c81', name: '  KJZZ  91.5 ', url: 'http://kjzz.streamguys1.com/pls', url_resolved: 'https://kjzz.streamguys1.com/live',
    homepage: 'https://kjzz.org/', favicon: 'https://kjzz.org/icon.png', tags: 'npr,news,public radio', countrycode: 'US', state: 'Arizona', codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1,
  };
  it('maps a station, preferring url_resolved', () => {
    expect(mapStation(raw)).toEqual({ id: raw.stationuuid, name: 'KJZZ 91.5', url: 'https://kjzz.streamguys1.com/live', homepage: 'https://kjzz.org/', favicon: 'https://kjzz.org/icon.png', tags: ['npr', 'news', 'public radio'], country: 'US', codec: 'MP3', bitrate: 128, hls: false });
  });
  it('drops broken, urlless and duplicate stations; hls flagged; 0 bitrate is unknown', () => {
    const list = mapStations([raw, raw, { ...raw, stationuuid: 'b', lastcheckok: 0 }, { ...raw, stationuuid: 'c', url: 'ftp://x', url_resolved: '' }, { ...raw, stationuuid: 'd', hls: 1, bitrate: 0, favicon: '' }, null, 'x']);
    expect(list.map((s) => s.id)).toEqual([raw.stationuuid, 'd']);
    expect(list[1]).toMatchObject({ hls: true, bitrate: null, favicon: null });
    expect(mapStations({})).toEqual([]);
  });
  it('KJEF preset and data estimate', () => {
    expect(kjefPreset(KJEF_PUBLIC)).toMatchObject({ id: 'preset:kjef', url: 'https://radio.jeffraben.com/stream.mp3' });
    expect(mbPerHour(128)).toBe(58);
    expect(mbPerHour(null)).toBe(58);
  });
});

describe('ICY metadata', () => {
  const meta = (s: string) => { const b = Buffer.alloc(Math.ceil(s.length / 16) * 16); b.write(s, 'latin1'); return Buffer.concat([Buffer.from([b.length / 16]), b]); };
  it('takes metadata out of the stream at every metaint, across chunk boundaries', () => {
    const titles: string[] = [];
    const p = new IcyParser(8, (t) => titles.push(t));
    const audio1 = Buffer.from('AAAAAAAA'), audio2 = Buffer.from('BBBBBBBB'), audio3 = Buffer.from('CCCC');
    const stream = Buffer.concat([audio1, meta("StreamTitle='Oingo Boingo - Weird Science';"), audio2, Buffer.from([0]), audio3]);
    let out = Buffer.alloc(0);
    for (let i = 0; i < stream.length; i += 5) out = Buffer.concat([out, p.push(stream.subarray(i, i + 5))]);
    expect(out.toString()).toBe('AAAAAAAABBBBBBBBCCCC');
    expect(titles).toEqual(['Oingo Boingo - Weird Science']);
  });
  it('no metaint passes everything through', () => {
    expect(new IcyParser(0, () => {}).push(Buffer.from('abc')).toString()).toBe('abc');
  });
  it('titles', () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='Café - Song';StreamUrl='';\0\0", 'latin1'))).toBe('Café - Song');
    expect(parseStreamTitle(Buffer.from('nothing'))).toBeNull();
    expect(splitStreamTitle('Oingo Boingo - Weird Science')).toEqual({ artist: 'Oingo Boingo', title: 'Weird Science' });
    expect(splitStreamTitle('KJEF ident')).toEqual({ artist: null, title: 'KJEF ident' });
  });
});

describe('Spotify tokens', () => {
  const tok = (o: Partial<SpotifyToken> = {}): SpotifyToken => ({ access: 'A1', refresh: 'R1', expiresAt: 1_000_000, scope: 's', user: 'Jeff', ...o });
  const fakeFetch = (answers: { status: number; body: unknown }[], calls: URLSearchParams[]) => (async (_u: unknown, init?: RequestInit) => {
    calls.push(new URLSearchParams(String(init?.body ?? '')));
    const a = answers.shift() ?? { status: 500, body: {} };
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  it('uses a fresh token without asking Spotify', async () => {
    const calls: URLSearchParams[] = [];
    const t = new SpotifyTokens({ clientId: () => 'cid', load: () => tok(), save: () => {}, fetch: fakeFetch([], calls), now: () => 1_000_000 - REFRESH_EARLY_MS - 1 });
    expect(await t.access('jeff')).toBe('A1');
    expect(calls).toHaveLength(0);
  });

  it('refreshes near expiry once for concurrent callers, keeping the refresh token when none comes back', async () => {
    const calls: URLSearchParams[] = [];
    let stored: SpotifyToken | null = tok();
    const t = new SpotifyTokens({ clientId: () => 'cid', load: () => stored, save: (_d, n) => { stored = n; }, fetch: fakeFetch([{ status: 200, body: { access_token: 'A2', expires_in: 3600, scope: 's2' } }], calls), now: () => 1_000_000 - 1000 });
    const [a, b] = await Promise.all([t.access('jeff'), t.access('jeff')]);
    expect([a, b]).toEqual(['A2', 'A2']);
    expect(calls).toHaveLength(1);
    expect(calls[0].get('grant_type')).toBe('refresh_token');
    expect(calls[0].get('refresh_token')).toBe('R1');
    expect(calls[0].get('client_id')).toBe('cid');
    expect(stored).toMatchObject({ access: 'A2', refresh: 'R1', expiresAt: 1_000_000 - 1000 + 3600_000, scope: 's2', user: 'Jeff' });
  });

  it('takes a rotated refresh token', () => {
    expect(tokenFrom({ access_token: 'x', refresh_token: 'R9', expires_in: 10 }, tok(), 0)).toMatchObject({ refresh: 'R9', expiresAt: 60_000 });
    expect(() => tokenFrom({ error: 'invalid_client' }, null)).toThrow(/invalid_client/);
  });

  it('invalid_grant forgets the tokens', async () => {
    let stored: SpotifyToken | null = tok();
    const t = new SpotifyTokens({ clientId: () => 'cid', load: () => stored, save: (_d, n) => { stored = n; }, fetch: fakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token revoked' } }], []), now: () => 2_000_000 });
    await expect(t.access('jeff')).rejects.toThrow(/revoked: connect again/);
    expect(stored).toBeNull();
  });

  it('API call retries once with a refreshed token on 401', async () => {
    let stored: SpotifyToken | null = tok({ expiresAt: 9e15 });
    const tf = fakeFetch([{ status: 200, body: { access_token: 'A3', expires_in: 3600 } }], []);
    const tokens = new SpotifyTokens({ clientId: () => 'cid', load: () => stored, save: (_d, n) => { stored = n; }, fetch: tf, now: () => 0 });
    const auths: string[] = [];
    const api = new SpotifyApi(tokens, (async (_u: unknown, init?: RequestInit) => {
      auths.push(String((init?.headers as Record<string, string>).authorization));
      return auths.length === 1 ? new Response('{}', { status: 401 }) : new Response(JSON.stringify({ is_playing: true, item: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Al', images: [{ url: 'big' }, { url: 'mid' }] }, duration_ms: 1000 }, device: { id: 'd', name: 'Slate Truck', type: 'Automobile', is_active: true, volume_percent: 70 } }), { status: 200 });
    }) as typeof fetch);
    const p = await api.playback('jeff');
    expect(auths).toEqual(['Bearer A1', 'Bearer A3']);
    expect(p).toMatchObject({ playing: true, title: 'Song', artist: 'A, B', album: 'Al', art: 'mid', device: { name: 'Slate Truck', active: true, volume: 70 } });
  });

  it('PKCE pair and pasted redirect URLs', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(codeFromUrl('http://127.0.0.1:8080/api/spotify/callback?code=AQB&state=s1')).toEqual({ code: 'AQB', state: 's1' });
    expect(codeFromUrl('http://127.0.0.1:8080/api/spotify/callback?error=access_denied&state=s1')).toEqual({ error: 'Spotify access was declined.' });
    expect('error' in codeFromUrl('not a url')).toBe(true);
    expect(mapPlayback(null)).toBeNull();
    expect(new SpotifyError('x', 409).status).toBe(409);
  });
});

describe('AM/FM', () => {
  it('rtl_fm arguments for FM and AM', () => {
    expect(rtlFmArgs(91.5, { ppm: 0, gain: null })).toEqual(['-f', '91.5M', '-M', 'wbfm', '-s', '200000', '-r', '48000', '-E', 'deemp', '-']);
    expect(rtlFmArgs(0.62, { ppm: 3, gain: 40 })).toEqual(['-f', '620k', '-M', 'am', '-s', '12k', '-r', '48000', '-p', '3', '-g', '40', '-']);
  });
  it('rtl_power sweep -> strong channels -> seek with wrap', () => {
    const csv = [
      '2026-11-05, 14:00:00, 87800000, 97800000, 100000, 10, ' + Array.from({ length: 100 }, (_, i) => (i === 37 ? '-5' : i === 72 ? '-8' : '-30')).join(', '),
      '2026-11-05, 14:00:00, 97800000, 108000000, 100000, 10, ' + Array.from({ length: 102 }, (_, i) => (i === 41 ? '-6' : '-31')).join(', '),
    ].join('\n');
    const bins = parseRtlPower(csv);
    expect(bins.length).toBe(202);
    const ch = strongChannels(bins);
    expect(ch).toEqual([91.5, 95.1, 101.9]);
    expect(pickSeek(ch, 91.5, 1)).toBe(95.1);
    expect(pickSeek(ch, 101.9, 1)).toBe(91.5);
    expect(pickSeek(ch, 91.5, -1)).toBe(101.9);
    expect(pickSeek([], 91.5, 1)).toBeNull();
  });
});

describe('local files', () => {
  it('titles from the path', () => {
    expect(trackInfo('Oingo Boingo/Dead Man\'s Party/03 - Weird Science.mp3')).toEqual({ title: 'Weird Science', artist: 'Oingo Boingo', album: "Dead Man's Party" });
    expect(trackInfo('The Untouchables - Free Yourself.flac')).toEqual({ title: 'Free Yourself', artist: 'The Untouchables', album: null });
    expect(trackInfo('Mix/01_Intro.m4a')).toEqual({ title: 'Intro', artist: null, album: 'Mix' });
  });
  it('never leaves the root', () => {
    const root = path.resolve(tmpdir(), 'music-root');
    expect(safeJoin(root, 'a/b.mp3')).toBe(path.join(root, 'a', 'b.mp3'));
    expect(safeJoin(root, '')).toBe(root);
    expect(() => safeJoin(root, '../etc/passwd')).toThrow();
    expect(() => safeJoin(root, 'a/../../x')).toThrow();
  });
  it('byte ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=10-', 100)).toEqual([10, 99]);
    expect(parseRange('bytes=10-19', 100)).toEqual([10, 19]);
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=200-', 100)).toBe('bad');
  });
});

describe('Plex mapping', () => {
  it('tracks, albums, artists; thumbs go through the brain', () => {
    const list = mapPlexList({ MediaContainer: { Metadata: [
      { ratingKey: '101', type: 'track', title: 'Weird Science', grandparentTitle: 'Oingo Boingo', parentTitle: "Dead Man's Party", thumb: '/library/metadata/100/thumb/1', duration: 230000, index: 3 },
      { ratingKey: 100, type: 'album', title: "Dead Man's Party", parentTitle: 'Oingo Boingo' },
      { ratingKey: '99', type: 'artist', title: 'Oingo Boingo' },
      { ratingKey: '5', type: 'movie', title: 'nope' },
    ] } });
    expect(list.map((x) => x.type)).toEqual(['track', 'album', 'artist']);
    expect(list[0]).toMatchObject({ key: '101', subtitle: "Oingo Boingo · Dead Man's Party", artist: 'Oingo Boingo', album: "Dead Man's Party", durationMs: 230000, index: 3, thumb: '/api/media/plex/thumb?path=%2Flibrary%2Fmetadata%2F100%2Fthumb%2F1' });
    expect(list[1]).toMatchObject({ key: '100', subtitle: 'Oingo Boingo' });
    expect(mapPlexItem({ type: 'track', title: 'x' })).toBeNull();
    expect(mapPlexList(null)).toEqual([]);
  });
});

describe('media settings', () => {
  it('masks secrets and hides Spotify tokens', () => {
    const s = defaultMediaSettings();
    s.wopr = { url: 'http://wopr', username: 'jeff', password: 'supersecret' };
    s.plex = { url: 'http://plex:32400', token: 'plextoken1234' };
    s.spotify.tokens.jeff = { access: 'a', refresh: 'r', expiresAt: 1, scope: '', user: 'Jeff R' };
    const m = maskMedia(s);
    expect(m.wopr.password).toBe('••••cret');
    expect(m.plex.token).toBe('••••1234');
    expect(JSON.stringify(m)).not.toMatch(/supersecret|plextoken|"refresh"|"access"/);
    expect(m.spotify.connected).toEqual({ jeff: { user: 'Jeff R' } });
  });
  it('merges: masked secret keeps, "" clears, bad values refused', () => {
    const s = defaultMediaSettings();
    s.wopr.password = 'pw12345';
    expect(mergeMedia(s, { wopr: { password: '••••2345', url: 'http://192.168.1.20:3940/' } }).wopr).toEqual({ url: 'http://192.168.1.20:3940', username: 'jeff', password: 'pw12345' });
    expect(mergeMedia(s, { wopr: { password: '' } }).wopr.password).toBeUndefined();
    expect(() => mergeMedia(s, { wopr: { url: 'wopr.local' } })).toThrow(MediaSettingsError);
    expect(() => mergeMedia(s, { spotify: { clientId: 'short' } })).toThrow(/Client ID/);
    expect(mergeMedia(s, { fm: { presets: [{ mhz: 91.5 }, { mhz: 0.62, name: 'KTAR' }] } }).fm.presets).toEqual([{ mhz: 91.5, name: '91.5 FM', streamId: null }, { mhz: 0.62, name: 'KTAR', streamId: null }]);
    expect(() => mergeMedia(s, { fm: { presets: [{ mhz: 120 }] } })).toThrow();
    expect(mergeMedia(s, { radio: { kjefUrl: '' } }).radio.kjefUrl).toBe(KJEF_PUBLIC);
  });
  it('store writes media.json and reloads tokens and favourites', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'slate-media-'));
    const a = new MediaSettingsStore(dir);
    a.mutate((s) => { s.spotify.tokens.jeff = { access: 'a', refresh: 'r', expiresAt: 5, scope: '', user: null }; s.radio.favourites.jeff = [kjefPreset(KJEF_PUBLIC)]; });
    a.update({ wopr: { url: 'http://x:1', password: 'p' } });
    const b = new MediaSettingsStore(dir);
    expect(b.get().spotify.tokens.jeff.refresh).toBe('r');
    expect(b.get().radio.favourites.jeff[0].id).toBe('preset:kjef');
    expect(b.get().wopr.password).toBe('p');
    expect(JSON.parse(readFileSync(path.join(dir, 'media.json'), 'utf8')).wopr.url).toBe('http://x:1');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('now playing from many sources', () => {
  it('parses the source; unknown sources are malformed', () => {
    expect(parseMediaMessage({ type: 'media', title: 'T', source: 'radio' })).toEqual({ title: 'T', artist: null, album: null, source: 'radio' });
    expect(parseMediaMessage({ type: 'media', title: 'T', source: 'tidal' })).toBeUndefined();
  });
  it('the newest started source wins; stopping it falls back; a new song keeps its place', () => {
    const out: (string | null)[] = [];
    const hub = new NowPlayingHub((np) => out.push(np ? `${np.source}:${np.title}` : null));
    hub.report('ws1:carplay', { title: 'A', artist: null, album: null, source: 'carplay' });
    hub.report('ws1:radio', { title: 'R', artist: null, album: null, source: 'radio' });
    hub.report('ws1:carplay', { title: 'B', artist: null, album: null, source: 'carplay' });
    hub.report('ws1:radio', null);
    hub.report('ws2:carplay', null); // another screen with nothing playing: no change
    hub.dropPrefix('ws1:');
    expect(out).toEqual(['carplay:A', 'radio:R', 'radio:R', 'carplay:B', null]);
  });
});
