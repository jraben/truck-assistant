import { describe, expect, it } from 'vitest';
import { sourceById } from '../src/media/sources.ts';
import { tabletPlaying, type TabletMedia } from '../src/media/tabletMedia.ts';
import { sourceLine } from '../src/media/MediaView.tsx';

const m = (o: Partial<TabletMedia>): TabletMedia => ({ title: 'Ventura Highway', artist: 'America', album: null, app: null, pkg: null, playing: true, at: '2026-11-17T18:00:00Z', ...o });

describe("the tablet's music app", () => {
  it('belongs to a source by package, else by app name', () => {
    const pandora = sourceById('pandora')!.handOff;
    const yt = sourceById('ytmusic')!.handOff;
    expect(tabletPlaying(pandora, m({ pkg: 'com.pandora.android' }))).not.toBeNull();
    expect(tabletPlaying(yt, m({ pkg: 'com.pandora.android' }))).toBeNull();
    expect(tabletPlaying(yt, m({ app: 'YouTube Music' }))).not.toBeNull();
    expect(tabletPlaying(pandora, m({ app: 'YouTube Music' }))).toBeNull();
    expect(tabletPlaying(pandora, m({ pkg: 'com.pandora.android', title: null, artist: null }))).toBeNull();
  });
  it("shows on its tile: playing or paused, and the song", () => {
    const p = sourceById('pandora')!;
    expect(sourceLine(p, null, null, null, m({ pkg: 'com.pandora.android' }))).toBe('On the tablet: Ventura Highway · America');
    expect(sourceLine(p, null, null, null, m({ pkg: 'com.pandora.android', playing: false }))).toBe('Paused: Ventura Highway · America');
    expect(sourceLine(p, null, null, null, null)).toBe('Opens its app');
  });
});
