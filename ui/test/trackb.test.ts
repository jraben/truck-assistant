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

describe('media sources', async () => {
  const { SOURCES, isSourceId, phonePlaying, sourceById } = await import('../src/media/sources.ts');
  it('has no CarPlay or Apple Music tile, and the three hand-off services', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(['spotify', 'pandora', 'ytmusic', 'amazon', 'plex', 'radio', 'fm', 'local']);
    expect(isSourceId('carplay')).toBe(false);
    expect(isSourceId('apple')).toBe(false);
    for (const s of SOURCES) expect(s.art).toBeTruthy();
  });
  it('matches what the phone reports to the hand-off service playing it', () => {
    const np = { app: 'Pandora', title: 'Song', artist: 'Band' };
    expect(phonePlaying(sourceById('pandora')!.handOff, np)).toBe(np);
    expect(phonePlaying(sourceById('amazon')!.handOff, np)).toBeNull();
    expect(phonePlaying(sourceById('ytmusic')!.handOff, { app: 'YouTube Music', title: 'x', artist: null })).not.toBeNull();
    expect(phonePlaying(sourceById('pandora')!.handOff, { app: 'Pandora', title: null, artist: null })).toBeNull();
    expect(phonePlaying(sourceById('plex')!.handOff, np)).toBeNull();
  });
});
