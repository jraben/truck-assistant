import { describe, expect, it } from 'vitest';
import { HdServer, HdServerError, mapServerStatus, newHdLog, nrsc5Args, readHdLine, serverBase, validHd } from '../src/media/hd.ts';
import { defaultMediaSettings, mergeMedia, MediaSettingsError } from '../src/media/settings.ts';

describe('HD Radio on the truck tuner (nrsc5)', () => {
  it('asks nrsc5 for raw PCM on stdout, program numbered from 0, and never dumps broadcast files', () => {
    expect(nrsc5Args(90.5, 2, { ppm: 0, gain: null })).toEqual(['-t', 'raw', '-o', '-', '90.5', '1']);
    expect(nrsc5Args(107.1, 1, { ppm: -3, gain: 40 })).toEqual(['-t', 'raw', '-o', '-', '-p', '-3', '-g', '40', '107.1', '0']);
    expect(nrsc5Args(99.9, 1, { ppm: 0, gain: null })).not.toContain('--dump-aas-files');
    expect([0, 1, 4, 5, 1.5].map(validHd)).toEqual([false, true, true, false, false]);
  });

  it("reads nrsc5's log: station, programs, song, signal", () => {
    const s = newHdLog(91.5, 2);
    const log = [
      '10:00:01 Found 1 device(s)',
      '10:00:03 Synchronized',
      '10:00:03 Station name: KJZZ',
      '10:00:03 Slogan: Phoenix Public Radio',
      '10:00:04 Audio program 0: public, type: News, sound experience 0',
      '10:00:04 Audio program 1: public, type: Jazz, sound experience 0',
      '10:00:05 Title: So What',
      '10:00:05 Artist: Miles Davis',
      '10:00:05 Album: Kind of Blue',
      '10:00:06 MER: 9.8 dB (lower), 11.2 dB (upper)',
      '10:00:07 Audio bit rate: 31.9 kbps',
    ];
    const changed = log.map((l) => readHdLine(s, l));
    expect(s).toMatchObject({ synced: true, station: 'KJZZ', slogan: 'Phoenix Public Radio', title: 'So What', artist: 'Miles Davis', album: 'Kind of Blue', merDb: 11.2, kbps: 32 });
    expect(s.programs).toEqual([{ hd: 1, type: 'News' }, { hd: 2, type: 'Jazz' }]);
    expect(changed[0]).toBe(false);            // nothing a listener sees
    expect(changed[6]).toBe(true);             // a new title
    expect(readHdLine(s, '10:00:08 Title: So What')).toBe(false); // same title again
    readHdLine(s, '10:01:00 Lost synchronization');
    expect(s.synced).toBe(false);
  });
});

describe('HD Radio through an nrsc5-webplayer', () => {
  const STATUS = { title: 'Blue in Green', artist: 'Miles Davis', album: '', genre: 'Unknown Genre', slogan: 'Jazz24', mer: '10.4 dB', bitrate: '48.0 kbps', art_url: '/aas/1234_cover.jpg?t=99', running: true };

  it('cleans its address', () => {
    expect(serverBase('http://192.168.1.50:7430/')).toBe('http://192.168.1.50:7430');
    expect(serverBase('ftp://x')).toBeNull();
    expect(serverBase('not a url')).toBeNull();
  });

  it("maps its /status, dropping its placeholders and proxying art by name only", () => {
    const n = mapServerStatus(STATUS, { mhz: 88.5, hd: 2 }, 't')!;
    expect(n).toMatchObject({ via: 'server', mhz: 88.5, hd: 2, title: 'Blue in Green', artist: 'Miles Davis', album: null, genre: null, slogan: 'Jazz24', merDb: 10.4, kbps: 48 });
    expect(n.art).toBe('/api/media/fm/hd/server-art?f=1234_cover.jpg');
    expect(mapServerStatus({ ...STATUS, art_url: '/etc/passwd' }, { mhz: 88.5, hd: 2 }, 't')!.art).toBeNull();
    expect(mapServerStatus({ ...STATUS, title: 'Loading...', artist: 'Tuning receiver...' }, { mhz: 88.5, hd: 2 }, 't')).toMatchObject({ title: null, artist: null, synced: false });
    expect(mapServerStatus({ ...STATUS, running: false }, { mhz: 88.5, hd: 2 }, 't')).toBeNull();
  });

  it('tunes, waits for its stream to start, and reads it', async () => {
    const calls: string[] = [];
    let streamTries = 0;
    const f = (async (u: string | URL) => {
      const url = String(u); calls.push(url.replace('http://radio.lan:7430', ''));
      if (url.includes('/tune_manual')) return Response.json({ status: 'success' });
      if (url.endsWith('/stream.mp3')) return ++streamTries < 3 ? new Response('Stream not active', { status: 503 }) : new Response(new Uint8Array([0xff, 0xfb, 1, 2]));
      if (url.endsWith('/status')) return Response.json(STATUS);
      if (url.endsWith('/stop')) return Response.json({ status: 'success' });
      return new Response('?', { status: 404 });
    }) as typeof fetch;
    const s = new HdServer(() => 'http://radio.lan:7430', f);
    const audio = await s.stream(88.5, 2);
    const chunks: Buffer[] = [];
    expect(audio.type).toBe('audio/mpeg');
    for await (const c of audio.body) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks)).toHaveLength(4);
    expect(calls[0]).toBe('/tune_manual?freq=88.5&program=1');
    expect(streamTries).toBe(3);
    expect((await s.now())?.title).toBe('Blue in Green');
    await s.stop();
    expect(s.current()).toBeNull();
    expect(await s.now()).toBeNull();
  }, 10_000);

  it("passes on the webplayer's own reason, and refuses odd art names", async () => {
    const f = (async () => Response.json({ status: 'error', message: 'Failed to launch nrsc5 on all devices.' }, { status: 500 })) as typeof fetch;
    const s = new HdServer(() => 'http://radio.lan:7430', f);
    await expect(s.tune(88.5, 1)).rejects.toThrow('HD Radio server: Failed to launch nrsc5 on all devices.');
    await expect(s.art('../secret')).rejects.toBeInstanceOf(HdServerError);
    await expect(new HdServer(() => null, f).tune(88.5, 1)).rejects.toThrow(/No HD Radio server set/);
  });
});

describe('HD Radio settings', () => {
  it('keeps HD presets and the server address, and refuses bad ones', () => {
    const s = mergeMedia(defaultMediaSettings(), { fm: { source: 'hdserver', hdServer: 'http://192.168.1.50:7430/', presets: [{ mhz: 88.5, hd: 2 }, { mhz: 91.5, name: 'KJZZ' }] } });
    expect(s.fm.source).toBe('hdserver');
    expect(s.fm.hdServer).toBe('http://192.168.1.50:7430');
    expect(s.fm.presets[0]).toMatchObject({ mhz: 88.5, hd: 2, name: '88.5 FM HD2' });
    expect(s.fm.presets[1].hd).toBeUndefined();
    expect(() => mergeMedia(defaultMediaSettings(), { fm: { presets: [{ mhz: 88.5, hd: 5 }] } })).toThrow(MediaSettingsError);
    expect(() => mergeMedia(defaultMediaSettings(), { fm: { presets: [{ mhz: 0.62, hd: 1 }] } })).toThrow(MediaSettingsError);
    expect(() => mergeMedia(defaultMediaSettings(), { fm: { hdServer: 'radio.lan' } })).toThrow(MediaSettingsError);
    expect(mergeMedia(s, { fm: { hdServer: '' } }).fm.hdServer).toBeNull();
  });
});
