// What the brain says about the media sources (GET /api/media/status), polled
// while something on screen needs it.
import { api, store } from '../lib/brain.ts';
import type { MediaStatus } from '../../../brain/src/media/types.ts';

export type * from '../../../brain/src/media/types.ts';

export const mediaStatusStore = store<MediaStatus | null>(null);

let timer: number | undefined;
const wants = new Set<symbol>();
const fast = new Set<symbol>();

export async function refreshMediaStatus() {
  try { mediaStatusStore.set(await api<MediaStatus>('/api/media/status')); } catch { /* keep the last */ }
}

function reschedule() {
  clearInterval(timer);
  timer = undefined;
  if (!wants.size) return;
  timer = window.setInterval(() => void refreshMediaStatus(), fast.size ? 5000 : 20_000);
}

/** Poll while at least one caller wants it (every 5 s while the Media view is open, else 20 s). Returns the stop function. */
export function pollMediaStatus(quick: boolean): () => void {
  const id = Symbol('media-status');
  wants.add(id);
  if (quick) fast.add(id);
  void refreshMediaStatus();
  reschedule();
  return () => { wants.delete(id); fast.delete(id); reschedule(); };
}
