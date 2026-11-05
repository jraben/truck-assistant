import { describe, expect, it } from 'vitest';
import { mbPerHour, mediaMessage, savingData } from '../src/media/player.ts';
import { blockedReason } from '../src/wopr/voice.ts';

describe('media player (pure parts)', () => {
  it('reports what plays, and "nothing" with the source when it stops', () => {
    expect(mediaMessage('radio', { title: 'Weird Science', artist: 'Oingo Boingo', album: 'KJEF' })).toEqual({ type: 'media', source: 'radio', title: 'Weird Science', artist: 'Oingo Boingo', album: 'KJEF' });
    expect(mediaMessage('local', null)).toEqual({ type: 'media', source: 'local', title: null, artist: null, album: null });
    expect(mediaMessage('fm', { title: null, artist: null, album: 'x' })).toMatchObject({ title: null });
  });
  it('data estimate and the hotspot switch', () => {
    expect(mbPerHour(64)).toBe(29);
    expect(savingData({ network: { saveData: true } } as never)).toBe(true);
    expect(savingData(null)).toBe(false);
  });
});

describe('WOPR voice', () => {
  it('says why it cannot start', () => {
    expect(blockedReason(null, true)).toMatch(/brain/);
    expect(blockedReason({ network: { link: 'offline' } }, true)).toMatch(/offline/);
    expect(blockedReason({ network: { link: 'home' } }, false)).toMatch(/settings page/);
    expect(blockedReason({ network: { link: 'hotspot' } }, true)).toBeNull();
    expect(blockedReason({ network: { link: 'home' } }, null)).toBeNull();
  });
});
