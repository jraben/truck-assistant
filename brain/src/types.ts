// The shapes in docs/contract.md, verbatim. Change the contract first.
import type { ThemeSettings } from './themes.ts';
export type { Theme, ThemeSettings } from './themes.ts';

export type Gear = 'P' | 'R' | 'N' | 'D';
export type Wheel = 'fl' | 'fr' | 'rl' | 'rr';

export type State = {
  ts: string;
  speedMph: number | null;
  soc: number | null;
  socSource: 'manual' | 'estimate' | 'can' | null;
  rangeMi: number | null;
  gear: Gear | null;
  gps: { lat: number; lon: number; headingDeg: number | null; fix: boolean } | null;
  ignition: boolean | null;
  reverse: boolean | null;
  cabinTempF: number | null;
  aux12v: number | null;
  tilt: { pitch: number; roll: number } | null;
  tpms: Record<Wheel, { psi: number | null; tempF: number | null }> | null;
  relays: Record<string, { name: string; on: boolean | null }>;
  fiveSwitch: (boolean | null)[];
  trip: { id: number; startedAt: string; miles: number } | null;
  truckbox: boolean;
  nowPlaying: NowPlaying | null;
};

/** What CarPlay is playing, reported by the cockpit UI. Text only; album art stays in the UI. */
export type NowPlaying = { title: string | null; artist: string | null; album: string | null; source: 'carplay' };

export type TouPeriod = { name: string; days: number[]; start: string; end: string; perKwh: number };

export type Settings = {
  truckId: string;
  packKwh: number;
  efficiencyMiPerKwh: number;
  relays: Record<string, string>;
  charging: {
    networks: string[];
    avoidNetworks: string[];
    minKw: number;
    connector: 'NACS' | 'CCS' | 'J1772' | 'any';
    maxDetourMi: number;
    wantAmenities: string[];
    arriveMinSoc: number;
  };
  keys: { afdc?: string; openChargeMap?: string };
  homeAssistant: { bridge: boolean; homeChargerEnergyEntity?: string };
  homeRate: {
    flatPerKwh: number | null;
    tou: TouPeriod[];
    fixedPerSession: number;
  };
  /** Where "home" is (within 150 m = a home charge session). */
  homeLocation: { lat: number; lon: number } | null;
  compareMpg: number;
  gasPrice: number;
  theme: ThemeSettings;
  layout: Layout;
};

export type Charger = {
  id: string; source: 'afdc' | 'ocm';
  name: string; network: string | null;
  lat: number; lon: number; distanceMi: number;
  maxKw: number | null; connectors: string[];
  amenities: string[]; price: string | null;
  score: number; reasons: string[];
};

export type Trip = {
  id: number; startedAt: string; endedAt: string | null;
  miles: number; durationS: number;
  startSoc: number | null; endSoc: number | null; kwhEst: number | null;
  start: { lat: number; lon: number }; end: { lat: number; lon: number } | null;
};

export type TripPoint = { t: string; lat: number; lon: number; speedMph: number | null; headingDeg: number | null };

export type ChargeSession = {
  id: number;
  startedAt: string; endedAt: string | null;
  place: 'home' | 'public' | 'other';
  network: string | null;
  stationName: string | null;
  lat: number | null; lon: number | null;
  kwh: number | null;
  cost: number | null;
  costSource: 'receipt' | 'home-rate' | 'free' | null;
  startSoc: number | null; endSoc: number | null;
  maxKw: number | null;
  note: string | null;
  source: 'manual' | 'detected' | 'home-charger';
};

export type ChargeSummary = {
  period: string;
  sessions: number; kwh: number; cost: number;
  homeCost: number; publicCost: number;
  costPerKwh: number | null;
  miles: number;
  costPerMile: number | null;
  gasEquivalent: number | null;
};

export type LayoutWidget = { type: string; col: number; row: number; w: number; h: number; props?: Record<string, unknown> };
export type Layout = {
  views: { id: string; label: string; widgets: LayoutWidget[] }[];
};

export type Health = { ok: boolean; version: string; mqtt: string; gps: string; uptimeS: number };
