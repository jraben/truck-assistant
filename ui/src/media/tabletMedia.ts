// The dash tablet's own music apps (Pandora, YouTube Music, Amazon Music, Spotify):
// what Tasker says is playing, and the buttons that go back to Tasker's Media Control
// (brain/src/tablet.ts, deploy/android/README.md "Music apps on the tablet").
import { api, store, toast } from '../lib/brain.ts';
import type { MediaCmd, TabletMedia } from '../../../brain/src/tablet.ts';
import type { HandOff } from './sources.ts';

export type { TabletMedia };
export const tabletMediaStore = store<TabletMedia | null>(null);

const load = () => api<{ media: TabletMedia | null }>('/api/tablet/media').then((r) => tabletMediaStore.set(r.media), () => {});

/** Poll while a media screen is open; returns the stop function (for useEffect). */
export function pollTabletMedia(ms = 5000): () => void {
  void load();
  const t = setInterval(load, ms);
  return () => clearInterval(t);
}

/** The tablet report, when it is this service's app (by package, else by name). Pure. */
export function tabletPlaying(h: HandOff | undefined, m: TabletMedia | null): TabletMedia | null {
  if (!h || !m || !(m.title || m.artist)) return null;
  if (m.pkg) return m.pkg === h.androidPackage ? m : null;
  return m.app && h.app.test(m.app) ? m : null;
}

/** Play/pause, next, previous on the tablet. */
export async function tabletCmd(cmd: MediaCmd) {
  try {
    await api('/api/tablet/media', { method: 'POST', body: JSON.stringify({ cmd }) });
    // Tasker reports the new state a moment later; look again shortly.
    setTimeout(() => void load(), 1200);
  } catch (e) { toast((e as Error).message); }
}
