// Tilt: Jeff's truck from the side (pitch) and the rear (roll), rotated live
// about the ground line, with a level line and the degrees.
import type { DriveState, TruckLook } from '../../../brain/src/drive/types.ts';
import { TruckRear, TruckSide } from './TruckArt.tsx';

const tone = (deg: number | null, t: DriveState['tilt'] | undefined) => {
  if (deg === null || !t) return '';
  const a = Math.abs(deg);
  return a >= t.dangerDeg ? 'danger' : a >= t.warnDeg ? 'warn' : '';
};

export function TiltPair({ tilt, truck, limits, bedLightsOn, compact }: { tilt: { pitch: number; roll: number } | null; truck: TruckLook; limits?: DriveState['tilt']; bedLightsOn?: boolean; compact?: boolean }) {
  const p = tilt ? Math.max(-45, Math.min(45, tilt.pitch)) : 0;
  const r = tilt ? Math.max(-45, Math.min(45, tilt.roll)) : 0;
  return (
    <div class={`tiltpair ${compact ? 'compact' : ''} ${tilt ? '' : 'unknown'}`}>
      <figure>
        <div class="tiltview side">
          <i class="level" />
          {/* nose to the right: nose-up pitch is a counter-clockwise turn */}
          <div class="rot" style={{ transform: `rotate(${-p}deg)`, transformOrigin: '50% 93%' }}><TruckSide t={truck} id="tilt-side" bedLightsOn={bedLightsOn} /></div>
        </div>
        <figcaption class={tone(tilt?.pitch ?? null, limits)}><span class="lbl">Pitch</span><b class="num">{tilt ? `${tilt.pitch > 0 ? '+' : ''}${tilt.pitch.toFixed(1)}°` : '—'}</b></figcaption>
      </figure>
      <figure>
        <div class="tiltview rear">
          <i class="level" />
          <div class="rot" style={{ transform: `rotate(${r}deg)`, transformOrigin: '50% 93%' }}><TruckRear t={truck} id="tilt-rear" /></div>
        </div>
        <figcaption class={tone(tilt?.roll ?? null, limits)}><span class="lbl">Roll</span><b class="num">{tilt ? `${tilt.roll > 0 ? '+' : ''}${tilt.roll.toFixed(1)}°` : '—'}</b></figcaption>
      </figure>
    </div>
  );
}
