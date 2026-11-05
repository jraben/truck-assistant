// Track B's hooks into the cockpit shell (App.tsx, widgets.tsx): the MEDIA
// view, its widgets, and the overlays (WOPR subtitle, gate code, receipts).
import type { ComponentType } from 'preact';
import type { Layout } from '../../../brain/src/types.ts';
import type { WP } from '../components/drive.tsx';
import { MediaW, DataConfirm } from './MediaView.tsx';
import { NowPlayingAny } from './nowplaying.tsx';
import { player } from './player.ts';
import { mediaStatusStore } from './status.ts';
import { GateCard, NextAppointment, WoprSubtitle } from '../wopr/WoprUi.tsx';
import { ReceiptPrompt } from '../receipts/Receipts.tsx';
import { api } from '../lib/brain.ts';

export const MEDIA_ICON = 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M21 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0';

/** The Media view: the source tabs, what's playing, and the next appointment. */
export const MEDIA_VIEW: Layout['views'][number] = {
  id: 'media', label: 'Media', widgets: [
    { type: 'media', col: 1, row: 1, w: 9, h: 2 },
    { type: 'nowPlaying', col: 10, row: 1, w: 3, h: 1 },
    { type: 'nextAppointment', col: 10, row: 2, w: 3, h: 1 },
  ],
};

/** A driver's saved layout from before the Media view existed gets it added after CarPlay (or at the end). Pure. */
export function withMediaView(layout: Layout): Layout {
  if (layout.views.some((v) => v.id === 'media')) return layout;
  const i = layout.views.findIndex((v) => v.id === 'carplay');
  const views = [...layout.views];
  views.splice(i >= 0 ? i + 1 : views.length, 0, MEDIA_VIEW);
  return { ...layout, views };
}

/** Widget types Track B adds ("nowPlaying" now shows any source, not only CarPlay). */
export const TRACKB_WIDGETS: Record<string, ComponentType<WP>> = {
  media: MediaW,
  nowPlaying: NowPlayingAny,
  nextAppointment: NextAppointment,
};

let started = false;
/** Once per page: the player, and pausing Spotify on the truck when the cockpit starts playing something else. */
export function initTrackB() {
  if (started) return;
  started = true;
  player.init();
  player.onStartOther = () => {
    if (mediaStatusStore.get()?.spotify.onTruck && mediaStatusStore.get()?.spotify.playback?.playing) void api('/api/spotify/pause', { method: 'POST', body: '{}' }).catch(() => {});
  };
}

/** Overlays that sit over every view. */
export function TrackBOverlays() {
  initTrackB();
  return (
    <>
      <WoprSubtitle />
      <GateCard />
      <ReceiptPrompt />
      <DataConfirm />
    </>
  );
}
