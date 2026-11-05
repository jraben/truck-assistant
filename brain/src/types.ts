// The shapes in docs/contract.md, verbatim. Change the contract first.
import type { ThemeSettings } from './themes.ts';
import type { DriveSettings, DriveState, DriverDrive, TruckLook } from './drive/types.ts';
export type * from './drive/types.ts';
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
  driver: DriverRef | null;
  driverSuggestion: { id: string; name: string; reason: string } | null;
  place: { stopId: number; name: string | null; since: string } | null;
  network: NetworkStatus;
  drive: DriveState | null;         // Track A: range modes, weather, limits, lockout, heat, brightness
};

export type NetworkStatus = {
  link: 'home' | 'hotspot' | 'bt' | 'offline';
  label: string;
  ssid: string | null;
  driverId: string | null;
  signal: number | null;
  manual: boolean;
  saveData: boolean;
  bytesThisTrip: number;
  bytesThisMonth: Record<string, number>;
  backend: 'nmcli' | 'sim' | 'unavailable';
  bluetooth: string;
  error: string | null;
};

export type NetCandidate = {
  id: string;
  kind: 'home' | 'hotspot' | 'bt';
  label: string; ssid: string | null; driverId: string | null;
  inRange: boolean; signal: number | null; active: boolean;
};

export type WifiNet = { ssid: string; password?: string };

export type DriverRef = { id: string; name: string; initials: string; color: string };

/** What is playing, reported by the cockpit UI (CarPlay, or the Media view's player) or the brain (Spotify). Text only; album art stays in the UI. */
export type NowPlayingSource = 'carplay' | 'spotify' | 'radio' | 'fm' | 'plex' | 'local';
export type NowPlaying = { title: string | null; artist: string | null; album: string | null; source: NowPlayingSource };

export type TouPeriod = { name: string; days: number[]; start: string; end: string; perKwh: number };

export type ChargingPrefs = {
  networks: string[];
  avoidNetworks: string[];
  minKw: number;
  connector: 'NACS' | 'CCS' | 'J1772' | 'any';
  maxDetourMi: number;
  wantAmenities: string[];
  arriveMinSoc: number;
};

export type GasSettings = {
  source: 'manual' | 'ha';
  manualPrice: number;
  haEntities: string[];
  pick: 'cheapest' | 'average';
};

/** Truck-level settings. Per-driver prefs live in drivers[]. */
export type Settings = {
  truckId: string;
  packKwh: number;
  efficiencyMiPerKwh: number;
  relays: Record<string, string>;
  keys: { afdc?: string; openChargeMap?: string; placesFeed?: string; googlePlaces?: string };
  homeAssistant: { bridge: boolean; homeChargerEnergyEntity?: string; url: string | null; token?: string };
  homeRate: {
    flatPerKwh: number | null;
    tou: TouPeriod[];
    fixedPerSession: number;
  };
  /** Where "home" is (within 150 m = a home charge session). */
  homeLocation: { lat: number; lon: number } | null;
  compareVehicle: CompareVehicle;
  gas: GasSettings;
  placesFeed: { url: string | null };
  homeWifi: WifiNet | null;
  saveDataOnHotspot: boolean;
  truck: TruckLook;                 // Track A: what the truck looks like (tilt drawing)
  drive: DriveSettings;             // Track A
  drivers: Driver[];
};

export type Driver = {
  id: string;
  name: string;
  initials: string;
  color: string;
  guest: boolean;
  tracker: string | null;
  theme: ThemeSettings;
  layout: Layout;
  charging: ChargingPrefs;
  favouritePlaceIds: number[];
  compareVehicle: CompareVehicle | null;
  hotspot: WifiNet | null;
  btTetherMac: string | null;
  drive: DriverDrive;               // Track A: speedometer style, over-limit warning
};

export type FuelGrade = 'regular' | 'midgrade' | 'premium' | 'diesel';
export type CompareVehicle = { id: number | null; label: string; mpgCity: number; mpgHighway: number; mpgCombined: number; fuel: FuelGrade };

export type Charger = {
  id: string; source: 'afdc' | 'ocm' | 'google';
  name: string; network: string | null;
  lat: number; lon: number; distanceMi: number;
  maxKw: number | null; connectors: string[];
  amenities: string[]; price: string | null;
  /** Live stall counts from Google Places (fast chargers only when it splits them); null = not known. */
  availability?: ChargerAvailability | null;
  /** The newest logged session with a cost at this site (any driver: the price is the site's). */
  lastPaid?: LastPaid | null;
  score: number; reasons: string[];
};

export type ChargerAvailability = { available: number; total: number; outOfService: number; updatedAt: string | null };
export type LastPaid = { sessionId: number; at: string; cost: number; kwh: number | null; perKwh: number | null; sessions: number };

export type Trip = {
  id: number; startedAt: string; endedAt: string | null;
  miles: number; durationS: number;
  startSoc: number | null; endSoc: number | null; kwhEst: number | null;
  start: { lat: number; lon: number }; end: { lat: number; lon: number } | null;
  driverId: string | null;
  source: 'truck' | 'phone';
  from: StopRef | null; to: StopRef | null;
  cityMiles: number | null; highwayMiles: number | null;   // Track A: null before the split was recorded
  cityKwh: number | null; highwayKwh: number | null;
};

export type StopRef = { stopId: number; name: string | null };

export type Stop = {
  id: number; driverId: string | null; source: 'truck' | 'phone';
  arrivedAt: string; departedAt: string | null;
  durationS: number;
  lat: number; lon: number;
  reason: 'ignition' | 'dwell';
  name: string | null;
  nameSource: 'place' | 'zone' | 'feed' | 'geocode' | null;
  placeId: number | null;
};

export type Place = { id: number; name: string; lat: number; lon: number; radiusM: number; visits: number; lastVisit: string | null };
export type PlaceSuggestion = { lat: number; lon: number; visits: number; suggestedName: string | null; stopIds: number[] };
export type TimelineItem = ({ kind: 'stop' } & Stop) | ({ kind: 'trip' } & Trip);

export type ImportJob = {
  id: number; driverId: string; tracker: string; from: string; to: string;
  state: 'running' | 'done' | 'error';
  daysDone: number; daysTotal: number;
  points: number; dropped: number;
  trips: number; stops: number;
  startedAt: string; finishedAt: string | null; error: string | null;
};

export type GasStatus = {
  source: 'manual' | 'ha';
  fuel: FuelGrade;
  today: { price: number; station: string | null; fuel: string | null; fetchedAt: string; updatedAt: string | null } | null;
  manualPrice: number;
  message: string | null;
  days: { day: string; fuel: string; price: number; station: string | null }[];
};
export type GasSensor = { entityId: string; name: string; price: number | null; unit: string | null; attribution: string | null };

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
  source: 'manual' | 'detected' | 'home-charger' | 'receipt';  // receipt: confirmed from a charging receipt email (Track B)
  driverId: string | null;
};

export type ChargeSummary = {
  period: string;
  sessions: number; kwh: number; cost: number;
  homeCost: number; publicCost: number;
  costPerKwh: number | null;
  miles: number;
  costPerMile: number | null;
  gasEquivalent: number | null;
  gasVehicle: string;
};

export type LayoutWidget = { type: string; col: number; row: number; w: number; h: number; props?: Record<string, unknown> };
export type Layout = {
  views: { id: string; label: string; widgets: LayoutWidget[] }[];
};

export type Health = { ok: boolean; version: string; mqtt: string; gps: string; ha: string; uptimeS: number };
