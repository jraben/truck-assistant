// The shapes in docs/contract.md, verbatim. Change the contract first.
import type { ThemeSettings } from './themes.ts';
import type { RoadTripBrief } from './roadtrip/types.ts';
import type { TrafficBrief } from './traffic/types.ts';
export type * from './traffic/types.ts';
export type * from './roadtrip/types.ts';
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
  /** watts: what the load draws when on, as set in Settings (no current sensor: an estimate). */
  relays: Record<string, { name: string; on: boolean | null; watts: number }>;
  fiveSwitch: (boolean | null)[];
  trip: { id: number; startedAt: string; miles: number } | null;
  truckbox: boolean;
  nowPlaying: NowPlaying | null;
  driver: DriverRef | null;
  driverSuggestion: { id: string; name: string; reason: string } | null;
  place: { stopId: number; name: string | null; since: string } | null;
  network: NetworkStatus;
  drive: DriveState | null;         // Track A: range modes, weather, limits, lockout, heat, brightness
  chargePeak: ChargePeak | null;    // charging during on-peak (null until the brain has looked)
  /** DEMO=1 only: the neighbourhood or road for the top bar ("Arcadia, Phoenix"); null otherwise. */
  area?: string | null;
  /** The active road trip, briefly (next stop, latest alert, the coach's line); null when none. */
  roadTrip?: RoadTripBrief;
  /** A crash or closure close ahead, or an enforcement camera coming up (511 feeds, OpenStreetMap). */
  traffic?: TrafficBrief;
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

/** alertOnCharging: warn when the truck charges at home inside this period (default on for a period priced above the flat / off-peak rate). */
/** months: 1-12 the period applies in (none = all year), for seasonal plans like APS summer May-Oct / winter Nov-Apr. demandPerKw overrides homeRate.demandPerKw while it applies. */
export type TouPeriod = { name: string; days: number[]; start: string; end: string; perKwh: number; alertOnCharging?: boolean; months?: number[]; demandPerKw?: number | null };

/** Charging at home inside an alert (on-peak) period. Part of State. */
export type ChargePeak = {
  charging: boolean | null;         // null = no way to tell
  source: 'ha-power' | 'can' | 'session' | null;  // the wall charger's power sensor, the truck (future CAN), or a just-detected home session
  powerKw: number | null;           // live, when the power sensor shows charging
  atHome: boolean;
  period: { name: string; start: string; end: string } | null;  // the alert period now, if any
  onPeak: boolean;                  // charging inside an alert period: the red banner, the alert, the HA binary_sensor
  estimate: number | null;          // USD one hour at powerKw adds in demand charges (homeRate.demandPerKw); null = unknown
  title: string | null; message: string | null;
  headsUp: string | null; headsUpTitle: string | null;  // plugged in at home in the 30 min before an alert period
};

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
  /** Rated draw of each relay's load in watts (Control screen estimate; nothing measures it). */
  relayWatts: Record<string, number>;
  /** The dash tablet's draw from the truck while it charges, watts (estimate). */
  tabletWatts: number;
  keys: { afdc?: string; openChargeMap?: string; placesFeed?: string; googlePlaces?: string; /** 511 developer keys by state id (traffic/states.ts). */ traffic511?: Record<string, string> };
  homeAssistant: { bridge: boolean; homeChargerEnergyEntity?: string; homeChargerPowerEntity?: string; url: string | null; token?: string };
  homeRate: {
    flatPerKwh: number | null;
    tou: TouPeriod[];
    fixedPerSession: number;
    /** The plan's on-peak demand charge, $/kW (billed on the single highest on-peak hour of the month); null = none / unknown. */
    demandPerKw?: number | null;
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
  payoffGoal: PayoffGoal;           // "pay off the truck with gas savings"
  drivers: Driver[];
};

/** Truck-level: what the truck cost and from when its gas savings count. */
export type PayoffGoal = {
  /** USD. Default 30740.78 = the build (29,290.78) + destination (1,450); taxes and fees are not in it. */
  target: number;
  /** YYYY-MM-DD, the day the truck was delivered / first driven. Null = the first real truck trip's day. */
  startDate: string | null;
  /** true: savings = gas - every charge's cost. false: home charging is treated as free (only public/other charges are subtracted). */
  includeHomeCharging: boolean;
};

/** A one-off line Jeff wants counted (rebate, incentive; negative for a cost). Stored in SQLite. */
export type GoalAdjustment = { id: number; day: string; label: string; amount: number; createdAt: string };

/** One local day of the payoff ledger (SQLite goal_ledger). Frozen days are never rewritten except by POST /api/goal/recalc. */
export type GoalDay = {
  day: string;                      // YYYY-MM-DD, local
  trips: number;
  miles: number; cityMiles: number; highwayMiles: number; otherMiles: number;  // other = no city/highway split, at combined mpg
  gallons: number;
  gasPrice: number;                 // USD/gal used for the day
  priceSource: 'day' | 'nearest' | 'manual';  // that day's stored price, the nearest stored day's, or the manual price
  vehicle: CompareVehicle;          // the comparison vehicle as it was when the day was computed
  gasCost: number;
  chargeSessions: number;
  chargeCost: number;               // what counted (home excluded when includeHomeCharging is off)
  chargeCostUnknown: number;        // sessions that day with no cost entered (counted as $0)
  homeChargeExcluded: number;       // home charging $ left out because includeHomeCharging was off
  net: number;                      // gasCost - chargeCost
  /** USD a home charge inside an on-peak period may add as a demand charge (kW x homeRate.demandPerKw). Shown, never subtracted from net. */
  possibleDemandCharge: number | null;
  frozen: boolean;
  computedAt: string;
};

export type GoalMonth = { month: string; net: number; gasCost: number; chargeCost: number; miles: number; days: number; possibleDemandCharge: number | null };  // demand: the month's highest (billed once a month)

export type GoalSummary = {
  target: number;
  startDate: string | null;
  startSource: 'setting' | 'first-trip' | null;
  includeHomeCharging: boolean;
  saved: number;                    // ledger net since startDate + every adjustment
  ledgerSaved: number;
  adjustmentsTotal: number;
  pct: number;                      // saved / target x 100, not capped
  remaining: number;
  miles: number; gasCost: number; chargeCost: number;
  thisMonth: number;                // ledger net this calendar month
  avgPerMonth: number | null;       // ledger net over the last 90 days (or since start), per 30.44 days
  daysOfData: number;               // days from startDate to today, inclusive
  projection: { state: 'no-data' | 'not-enough-data' | 'not-saving' | 'projected' | 'paid-off'; date: string | null };
  months: GoalMonth[];              // oldest first
  vehicle: string;                  // the comparison vehicle now (frozen days keep their own)
  excluded: { simulatedTrips: number; phoneTrips: number; simulatedSessions: number };
  message: string | null;
  computedAt: string | null;
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
  /** The cockpit rail's icon order (ids from layout views and rail.ts RAIL_EXTRA_IDS); null = default. */
  railOrder: string[] | null;
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
  /** How fast this site charged the truck before vs the charging curve (road-trip samples); null = no history. */
  performance?: SitePerformance | null;
  score: number; reasons: string[];
};

export type SitePerformance = { ratio: number; kwSeen: number; kwExpected: number; samples: number; at: string };

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
  simulated: boolean;               // recorded by a brain running SIM=1 (never counts toward the payoff goal)
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
  simulated: boolean;               // logged by a brain running SIM=1 (receipts never are: the money was real)
  /** Set by GET /api/charges: the alert (on-peak) period the session overlapped, null if none. */
  onPeak?: string | null;
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
  /** Set once the Road trip screen has been added to a saved layout (so deleting it sticks). */
  roadTripAdded?: boolean;
  /** Same, for the Traffic screen. */
  trafficAdded?: boolean;
};

export type Health = { ok: boolean; version: string; mqtt: string; gps: string; ha: string; uptimeS: number };
