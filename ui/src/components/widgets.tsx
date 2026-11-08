import type { ComponentType } from 'preact';
import { Aux12v, Cabin, LiveStrip, NextCharger, Soc, Speed, Tilt, TripW, type WP } from './drive.tsx';
import { FiveSwitch, Relays, Tpms } from './control.tsx';
import { Chargers, SocSlider } from './charge.tsx';
import { CostSessions, CostSummary } from './costs.tsx';
import { PayoffGoalCard } from './goal.tsx';
import { Trips } from './trips.tsx';
import { DriveScreen } from '../drive/DriveScreen.tsx';
import { CarPlay } from './carplay.tsx';
import { TRACKB_WIDGETS } from '../media/trackb.tsx';
import { HOME_WIDGETS } from '../home/Home.tsx';
import { PARKED_WIDGETS } from '../parked/Parked.tsx';
import { CamsView, CamTile } from './cams.tsx';
import { MaintWidget } from '../ops/Maintenance.tsx';
import { MileageWidget } from '../ops/Mileage.tsx';

function Unknown({ props }: WP) {
  return <div class="card"><span class="lbl">Unknown widget</span><span class="dimtxt">{String(props?.type ?? '')}</span></div>;
}

/** Widget types usable in Settings.layout. */
export const WIDGETS: Record<string, ComponentType<WP>> = {
  speed: Speed, soc: Soc, nextCharger: NextCharger, trip: TripW, cabin: Cabin, aux12v: Aux12v, tilt: Tilt,
  carplay: CarPlay, liveStrip: LiveStrip,
  relays: Relays, fiveSwitch: FiveSwitch, tpms: Tpms,
  chargers: Chargers, socSlider: SocSlider, costSummary: CostSummary, costSessions: CostSessions, payoffGoal: PayoffGoalCard,
  trips: Trips, cam: CamTile, cams: CamsView,
  drive: DriveScreen,
  ...TRACKB_WIDGETS, // media, nowPlaying (any source), nextAppointment
  ...HOME_WIDGETS,   // garage, haPanel, homeCams
  ...PARKED_WIDGETS, // parked: watch, games, karaoke, camp, pet, tow, lights
  maintenance: MaintWidget, mileage: MileageWidget,
};
export const widgetFor = (t: string) => WIDGETS[t] ?? Unknown;
