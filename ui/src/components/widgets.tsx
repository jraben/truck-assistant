import type { ComponentType } from 'preact';
import { Aux12v, Cabin, LiveStrip, NextCharger, Soc, Speed, Tilt, TripW, type WP } from './drive.tsx';
import { FiveSwitch, Relays, Tpms } from './control.tsx';
import { Chargers, SocSlider } from './charge.tsx';
import { CostSessions, CostSummary } from './costs.tsx';
import { Trips } from './trips.tsx';
import { CarPlay, NowPlayingW } from './carplay.tsx';
import { CamsView, CamTile } from './cams.tsx';

function Unknown({ props }: WP) {
  return <div class="card"><span class="lbl">Unknown widget</span><span class="dimtxt">{String(props?.type ?? '')}</span></div>;
}

/** Widget types usable in Settings.layout. */
export const WIDGETS: Record<string, ComponentType<WP>> = {
  speed: Speed, soc: Soc, nextCharger: NextCharger, trip: TripW, cabin: Cabin, aux12v: Aux12v, tilt: Tilt,
  carplay: CarPlay, liveStrip: LiveStrip, nowPlaying: NowPlayingW,
  relays: Relays, fiveSwitch: FiveSwitch, tpms: Tpms,
  chargers: Chargers, socSlider: SocSlider, costSummary: CostSummary, costSessions: CostSessions,
  trips: Trips, cam: CamTile, cams: CamsView,
};
export const widgetFor = (t: string) => WIDGETS[t] ?? Unknown;
