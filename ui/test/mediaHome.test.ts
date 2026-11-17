import { describe, expect, it } from 'vitest';
import { SOURCES, tabletAppLink } from '../src/media/sources.ts';
import { emptyPlaylist } from '../src/media/Shortcuts.tsx';

describe('play on the tablet', () => {
  it('opens each phone service in its own Android app, with the Play Store as the fallback', () => {
    const links = Object.fromEntries(SOURCES.filter((s) => s.handOff).map((s) => [s.id, tabletAppLink(s.handOff!)]));
    expect(links.spotify).toBe(`intent://open.spotify.com#Intent;scheme=https;package=com.spotify.music;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=com.spotify.music')};end`);
    expect(links.pandora).toContain('package=com.pandora.android;');
    expect(links.ytmusic).toContain('intent://music.youtube.com#Intent;scheme=https;package=com.google.android.apps.youtube.music;');
    expect(links.amazon).toContain('package=com.amazon.mp3;');
  });
});

describe('saved playlists', () => {
  it('leaves out empty ones', () => {
    expect(emptyPlaylist('0 tracks')).toBe(true);
    expect(emptyPlaylist('0 songs')).toBe(true);
    expect(emptyPlaylist('10 tracks')).toBe(false);
    expect(emptyPlaylist('92270 tracks')).toBe(false);
    expect(emptyPlaylist(null)).toBe(false);
  });
});
