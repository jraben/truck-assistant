// The side camera while a turn signal is on: the left camera on the left of the screen
// for a left signal, the right one on the right, over whatever screen is up, like a
// blind-spot view. It stays 2 s after the signal stops (the blinks and the lane change
// finishing), never for hazards or in reverse (the rear camera has the screen), and a
// tap hides it until the next signal. Settings › Cameras: "Side camera on turn signal".
import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from '../../../brain/src/types.ts';
import { signalSide } from '../../../brain/src/truckbox.ts';
import { camByRole, useCamStatus, useViewerHeartbeat } from '../lib/cams.ts';
import { CamPlayer } from './camplayer.tsx';

export const SIDE_HOLD_MS = 2000;

export function SideCam({ s }: { s: State | null }) {
  const raw = signalSide(s?.turnSignals);
  const side = raw === 'left' || raw === 'right' ? raw : null;
  const [shown, setShown] = useState<'left' | 'right' | null>(null);
  const [hidden, setHidden] = useState<'left' | 'right' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    if (side) { setShown(side); if (hidden && hidden !== side) setHidden(null); }
    else timer.current = window.setTimeout(() => { setShown(null); setHidden(null); }, SIDE_HOLD_MS);
    return () => clearTimeout(timer.current);
  }, [side]);
  const { status } = useCamStatus(30_000);
  const cam = shown && status?.autoSide ? camByRole(status.cameras, shown) : null;
  const on = !!cam && s?.reverse !== true && hidden !== shown;
  useViewerHeartbeat(on);
  if (!on || !status || !cam) return null;
  return (
    <button type="button" class={`sidecam ${shown}`} aria-label={`${cam.name} camera (turn signal). Tap to hide.`} onClick={() => setHidden(shown)}>
      <CamPlayer cam={cam} backend={status.backend} guides={status.guides} big />
      <span class="sidecam-tag">{shown === 'left' ? '◀ LEFT' : 'RIGHT ▶'}</span>
    </button>
  );
}
