import { describe, expect, it } from 'vitest';
import { parseMediaMessage, sameNowPlaying } from '../src/media.ts';
import { discoveryConfigs } from '../src/ha.ts';

describe('media message (WS {"type":"media"})', () => {
  it('builds nowPlaying from text fields', () => {
    expect(parseMediaMessage({ type: 'media', title: ' Song ', artist: 'Artist', album: null }))
      .toEqual({ title: 'Song', artist: 'Artist', album: null, source: 'carplay' });
  });
  it('nothing playing is null', () => {
    expect(parseMediaMessage({ type: 'media', title: null, artist: null, album: null })).toBeNull();
    expect(parseMediaMessage({ type: 'media' })).toBeNull();
    expect(parseMediaMessage({ type: 'media', title: '  ', album: 'A' })).toBeNull();
  });
  it('rejects non-strings and trims control characters and length', () => {
    expect(parseMediaMessage({ type: 'media', title: 5 })).toBeUndefined();
    expect(parseMediaMessage({ type: 'media', title: 'a\nb', artist: 'x'.repeat(500) })).toEqual({ title: 'a b', artist: 'x'.repeat(200), album: null, source: 'carplay' });
  });
  it('compares by value', () => {
    const a = { title: 'T', artist: 'A', album: null, source: 'carplay' as const };
    expect(sameNowPlaying(a, { ...a })).toBe(true);
    expect(sameNowPlaying(a, { ...a, title: 'U' })).toBe(false);
    expect(sameNowPlaying(null, null)).toBe(true);
    expect(sameNowPlaying(a, null)).toBe(false);
  });
});

describe('HA discovery', () => {
  it('has a Now playing sensor fed from the state topic, without album art', () => {
    const d = discoveryConfigs('slate', '0.1.0').find((x) => x.topic === 'homeassistant/sensor/slate/now_playing/config');
    expect(d?.payload.name).toBe('Now playing');
    expect(d?.payload.state_topic).toBe('slate/brain/state');
    expect(JSON.stringify(d?.payload)).not.toMatch(/bartb|image|cover/i);
  });
});
