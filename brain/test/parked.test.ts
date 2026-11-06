import { describe, expect, it } from 'vitest';
import { defaultModes, mergeModes, nextDue, petFan } from '../src/modes.ts';
import { karaokeUrl, Parked } from '../src/parked.ts';
import { mapVideo, okHlsPath, startQuery } from '../src/media/plexVideo.ts';

describe('parked apps', () => {
  it('refuses while moving, and hands the page the address when no Pi screen is checking in', () => {
    const p = new Parked();
    expect(() => p.launch('netflix', true)).toThrow(/Parked only/);
    expect(p.launch('netflix', false)).toEqual({ opened: false, open: 'https://www.netflix.com/browse', label: 'Netflix' });
    expect(() => p.launch('moonlight', false)).toThrow(/truck's own screen/);
  });
  it('queues open/close for the Pi launcher, and closes when the truck moves', () => {
    const p = new Parked();
    p.next(['moonlight-qt']);
    expect(p.launch('youtube', false).opened).toBe(true);
    expect(p.next([])).toMatchObject({ action: 'open', url: 'https://www.youtube.com/tv' });
    p.guard(true);
    expect(p.next([])).toMatchObject({ action: 'close' });
    expect(p.status().open).toBeNull();
  });
  it('builds a karaoke search', () => {
    expect(karaokeUrl('Bohemian Rhapsody')).toBe('https://www.youtube.com/results?search_query=Bohemian%20Rhapsody%20karaoke');
  });
});

describe('Plex video', () => {
  it('maps episodes and movies', () => {
    expect(mapVideo({ ratingKey: '12', type: 'episode', title: 'Pilot', grandparentTitle: 'Lost', parentIndex: 1, index: 1, viewOffset: 60000 })).toMatchObject({ key: '12', subtitle: 'Lost · S1 · E1', viewOffsetMs: 60000 });
    expect(mapVideo({ ratingKey: 3, type: 'movie', title: 'Heat', year: 1995, viewCount: 1 })).toMatchObject({ subtitle: '1995', watched: true });
    expect(mapVideo({ ratingKey: 3, type: 'track', title: 'x' })).toBeNull();
  });
  it('relays only Plex transcoder paths', () => {
    expect(okHlsPath('start.m3u8')).toBe(true);
    expect(okHlsPath('session/abc-123/base/index.m3u8')).toBe(true);
    expect(okHlsPath('session/abc/base/00012.ts')).toBe(true);
    expect(okHlsPath('../../library/sections')).toBe(false);
    expect(okHlsPath('session/a/../../x')).toBe(false);
  });
  it('starts where it was left', () => {
    expect(new URLSearchParams(startQuery('12', 's1', { maxKbps: 4000, offsetMs: 61_500 })).get('offset')).toBe('62');
  });
});

describe('camp / pet / trailers', () => {
  it('pet fan switches with a 2°F gap', () => {
    expect(petFan(79, 78, false)).toBe(true);
    expect(petFan(77, 78, true)).toBe(true);
    expect(petFan(75.9, 78, true)).toBe(false);
    expect(petFan(null, 78, true)).toBe(true);
  });
  it('validates trailers and relays', () => {
    const m = mergeModes(defaultModes(), { camp: { relays: ['relay_1', 'nope', 'relay_1'] }, trailers: [{ name: 'Utility 5x8', lengthFt: '12', service: [{ name: 'Bearings', everyMonths: 12, lastDone: '2026-01-15' }] }] });
    expect(m.camp.relays).toEqual(['relay_1']);
    expect(m.trailers[0]).toMatchObject({ name: 'Utility 5x8', lengthFt: 12 });
    expect(() => mergeModes(defaultModes(), { trailers: [{}] })).toThrow(/name/);
    expect(() => mergeModes(defaultModes(), { light: { wledUrl: 'javascript:alert(1)' } })).toThrow(/address/);
  });
  it('works out when a trailer service is due', () => {
    expect(nextDue('2026-01-15', 12)).toBe('2027-01-15');
    expect(nextDue(null, 12)).toBeNull();
  });
});
