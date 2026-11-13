# Data contract

How the pieces talk. Every part of the build codes against this file; change it
here first.

```
 ESP32 truck box ──MQTT──▶ Mosquitto on the Pi ◀──MQTT── brain (Node)
   (ESPHome)                     │  bridge when on home Wi-Fi      │
                                 ▼                                 │ HTTP + WebSocket
                         Home Assistant broker                     ▼
                                                        cockpit UI (Chromium kiosk
                                                        on the 12.3" bar, 1920x720)
```

- The Pi runs Mosquitto on `localhost:1883`. The truck box joins the Pi's own
  Wi-Fi access point and publishes there. Nothing in the truck needs the internet.
- When the truck is on home Wi-Fi, Mosquitto bridges `slate/#` to the home
  broker so Home Assistant sees everything. Offline, messages wait.
- Truck id: `truck_id` in settings, default `slate`. Shown below as `slate`.

## MQTT: truck box (ESPHome, `topic_prefix: slate/truckbox`)

ESPHome's own topic layout, so it works with HA discovery unchanged.

| Topic | Payload | Notes |
|---|---|---|
| `slate/truckbox/status` | `online` / `offline` | birth / last will |
| `slate/truckbox/switch/relay_1/state` … `relay_6/state` | `ON` / `OFF` | upfit relays |
| `slate/truckbox/switch/relay_1/command` … | `ON` / `OFF` | brain or HA sends |
| `slate/truckbox/binary_sensor/five_switch_1/state` … `_5` | `ON` / `OFF` | read-only sense of the Five Switch circuits |
| `slate/truckbox/binary_sensor/ignition/state` | `ON` / `OFF` | switched 12V sense |
| `slate/truckbox/binary_sensor/reverse/state` | `ON` / `OFF` | reverse lamp sense |
| `slate/truckbox/sensor/cabin_temp/state` | °F, float | |
| `slate/truckbox/sensor/cabin_humidity/state` | %, float | |
| `slate/truckbox/sensor/aux_battery_v/state` | volts, float | 12V battery |
| `slate/truckbox/sensor/pitch/state`, `.../roll/state` | degrees, float | tilt gauge |
| `slate/truckbox/sensor/pack_power_kw/state` | kW, float: + drawing, − regenerating | the HV pack's power, once a CAN bridge can read it; logged per trip for the energy review, not shown live |
| `slate/truckbox/sensor/tpms_fl_psi/state` (fl, fr, rl, rr) | psi, float | BLE TPMS, if fitted |
| `slate/truckbox/sensor/relay_1_w/state` … `relay_6_w`, `.../relay_N_a/state` | watts / amps, float | measured, if an INA226 is fitted on that circuit (`packages/power_ina226.yaml`); `State.relays[id].measuredW` |
| `slate/truckbox/sensor/dash_w/state`, `.../dash_a/state` | watts / amps, float | the dash electronics' feed (Pi, screen, cameras, truck box), if fitted; `State.dashW` |
| `slate/truckbox/sensor/tpms_fl_temp/state` (fl, fr, rl, rr) | °F, float | |

Relay names (default, editable in settings): 1 Bed lights, 2 Light bar,
3 Rock lights, 4 Air compressor, 5 Bed fridge, 6 Inverter.

Relay power (settings `relayWatts`, default 36/120/48/360/45/60 W, and
`tabletWatts`, 12 W): what each load draws when on. Nothing measures current,
so the Control screen's per-load watts and its total (W and A at 12 V) are
these numbers, labelled as estimates. State carries each relay's `watts`. The
dash tablet counts only while it charges (the browser's Battery API says so).

## MQTT: brain (`slate/brain/…`)

| Topic | Payload |
|---|---|
| `slate/brain/status` | `online` / `offline` |
| `slate/brain/state` | the JSON `state` object below, retained, at most 1/s |
| `slate/brain/trip/ended` | a trip summary JSON (see `Trip`) |
| `slate/brain/goal` | payoff goal summary, retained (see "Payoff goal") |
| `homeassistant/…/config` | HA discovery for: SoC, range, location (device_tracker), speed, charging, trip distance, now playing (title; artist/album/source as attributes), current place (stop name, "Driving" or "Unnamed stop"; since/stopId as attributes), driver (name), charging on-peak (binary_sensor), truck payoff (saved, percent, projected date) |

## HTTP + WebSocket (brain, port 8080)

- `GET  /api/tablet/sleep` → `{minutes, waitSec, never, keepOn, minBattery}`
  from `Settings.tabletSleep` (`{minutes 0–120, never, minBattery 5–90}`,
  default `{2, false, 30}`): what Tasker on the dash tablet does when the
  truck's power drops (`deploy/android/README.md` step 6). Open (no login):
  Tasker can't log in, and only GET/HEAD of this one path is exempt.
- `GET  /ws` WebSocket. Server sends `{"type":"state","data":State}` on connect
  and on every change (at most 10/s). Client sends
  `{"type":"relay","id":"relay_1","on":true}` or
  `{"type":"soc","value":72}` (manual charge level), or
  `{"type":"gps","lat":…,"lon":…,"accM":…,"speedMps":…,"headingDeg":…,"altM":…}`
  (the dash tablet's own location, at most 1/s, `brain/src/tabletGps.ts`: used
  only from an Android browser on a private/Tailscale address, with
  `Settings.tabletGps` on (default), while no GPS puck has had a fix for 5 s;
  worse than 100 m accuracy is position-only; `Health.gps` reads `tablet` while
  it feeds the position. SIM: `POST /api/sim/gps-device {on}` takes positions
  from the test panel's browser instead of the simulated drive), or
  `{"type":"media","title":"…","artist":"…","album":"…"}` (what CarPlay is
  playing; strings or null, at most 200 characters each; no title and no
  artist = nothing playing). The UI sends it when the song changes, not on
  every position tick, and again after reconnecting. The brain keeps the
  report from the cockpit that sent it and clears `nowPlaying` when that
  socket closes. Album art never leaves the UI (not in State, not in MQTT).
- `GET  /api/state` → `State`
- `GET  /api/settings` → `Settings` (secrets masked); `PUT /api/settings` (partial
  merge). `drivers` is not written through this route: use `/api/drivers`.
- `GET  /api/chargers?lat=&lon=&soc=` → ranked `Charger[]` (ranked by the
  active driver's `charging` prefs). Sources: AFDC at `developer.nlr.gov`
  (NREL became the National Laboratory of the Rockies; `developer.nrel.gov`
  stopped resolving 2026-11-05, same keys) and Open Charge Map, cached 30 min
  per ~0.7 mi cell; Google Places (`keys.googlePlaces`) layered on for live
  stall counts, called at most once per 5 min truck-wide and dropped after
  30 min (a count older than 30 min is shown, not scored); `lastPaid` joined
  from `charge_sessions` on every request (by position within 200 m, else by
  station name + network). Google has no prices and none is guessed.
- `GET  /api/drivers` → `Driver[]`; `POST /api/drivers` `{name, initials?, color?,
  tracker?}` → `Driver` (theme/layout/charging start from the defaults);
  `PUT /api/drivers/:id` (partial merge like settings; `layout` replaced whole,
  null resets); `DELETE /api/drivers/:id` (not the Guest, not the last named
  driver; their trips keep the old `driverId`)
- Driver photos: `POST /api/drivers/:id/photo` with the image bytes
  (`image/jpeg|png|webp`, ≤ 6 MB; type from the magic bytes) → `{photo: {file,
  updatedAt}}`, stored as `DATA_DIR/driver-photos/<id>.<ext>`; `GET` serves it
  (`?v=<updatedAt>` is cached a day), `DELETE` removes it, and deleting the
  driver removes it too. `Driver.photo` is set only here (PUT ignores it);
  `State.driver.photo` is the ready URL or null. Unlike `/api/vehicle/photo`,
  GET needs the login from other devices (faces). /settings crops to a 256 px
  square JPEG before upload. Backups include `driver-photos/`.
- `POST /api/driver` `{id}` → `State['driver']`: pick the active driver. A pick
  while a trip is open re-attributes that trip (and its open stop) to the new
  driver: a correction, not a switch. The brain itself never changes the driver
  mid-trip. `POST /api/driver/dismiss` clears `driverSuggestion`.
- `GET  /api/trips?limit=&driver=&source=` → `Trip[]`; `GET /api/trips/:id` →
  `Trip` + `points`
- Trip energy, for review after the drive (`brain/src/drive/energy.ts`, the
  Trips view's **Energy** button): every ~2 s of a truck trip goes into
  `trip_samples` (position, GPS height, speed, pack power when the truck box
  sends it, and the estimated watts of the dash tech and of relay loads that
  were on), never thinned. `GET /api/trips/:id/energy` →
  `{source: 'measured'|'model'|'mixed'|'none', measuredShare, totals: {miles,
  movingS, usedKwh, regenKwh, netKwh, whPerMi, climbM, descentM, maxKw,
  maxRegenKw, driveKwh, techKwh, accessoryKwh}, breakdown (model only:
  rolling, aero, climbing, accelerating, aux, tech, accessories kWh), massLb,
  load, model, series: [{t, mi, lat, lon, altM, speedMph, powerKw, measured}]
  (≤ 800)}`. Measured where the pack's power was sent; elsewhere the physics
  model with `Settings.energyModel` (`curbLb, driverLb, cdA, crr, driveEff,
  regenEff, auxKw`: estimates until fitted) at truck + driver + the trip's
  load. Height and speed are smoothed (±15 s, ±5 s). Tech = `stackWatts` +
  `tabletWatts`; accessories = `relayWatts` of relays that were on; both go
  through the DC-DC (90%); driving is the rest. `PUT /api/trips/:id/load`
  `{lb: 0-5000 | null, note?}`: what it carried beyond the driver.
- `GET  /api/stops?from=&to=&driver=&source=&limit=` → `Stop[]` (newest first)
- `PUT  /api/stops/:id/name` `{name, radiusM?}` → `{place: Place, renamed: number}`:
  tap-to-name. Saves a place at the stop's position (default radius 120 m) and
  renames every stop inside it.
- `GET  /api/timeline?date=YYYY-MM-DD&driver=` → `{date, items: TimelineItem[]}`
  (local day, oldest first; a stop that spans midnight appears on both days)
- `GET  /api/places?driver=` → `Place[]` (visit counts by that driver, or all);
  `POST /api/places` `{name, lat, lon, radiusM?}`; `PUT /api/places/:id`
  `{name?, radiusM?}`; `DELETE /api/places/:id` (its stops fall back down the
  naming chain)
- `GET  /api/places/suggestions?driver=` → `PlaceSuggestion[]`: spots with 3+
  visits and no place/zone/feed name
- `POST /api/import/phone` `{driverId, from?, to?}` (ISO dates, default the last
  30 days) → 202 `ImportJob`; 409 when one is already running; 400 with a
  "connect Home Assistant on the settings page" message when HA isn't set up
  or the driver has no tracker. `GET /api/import/phone` → the latest
  `ImportJob` or null.
- `GET  /api/gas` → `GasStatus`
- `GET  /api/vehicles/menu/year`, `/make?year=`, `/model?year=&make=`,
  `/options?year=&make=&model=` → `{text, value}[]` (options' value = a
  fueleconomy.gov vehicle id); `GET /api/vehicles/:id` → `CompareVehicle`.
  The brain proxies fueleconomy.gov (`Accept: application/json`) and caches
  every answer in SQLite for good; offline with no cache → 503 with a message.
- `GET  /api/ha/status` → `{configured, reachable, message}`;
  `GET /api/ha/gasbuddy` → `{entities: GasSensor[], message}` (sensors whose id
  or attribution mentions GasBuddy)
- `GET  /api/charges?from=&to=&driver=` → `ChargeSession[]`; `POST /api/charges` (new,
  manual); `PUT /api/charges/:id`; `DELETE /api/charges/:id`
- `GET  /api/charges/summary?period=month|year&driver=` → `ChargeSummary[]`
- `GET  /api/network` → `{status: NetworkStatus, candidates: NetCandidate[]}` (in
  priority order, with what is in range); `POST /api/network/connect`
  `{id}` (a candidate id) picks by hand; `POST /api/network/auto` returns to the
  automatic order.
- `GET  /api/health` → `{ok, version, mqtt, gps, ha, uptimeS}`
- `/` serves the cockpit UI; `/settings` serves the settings portal.

### Shapes (TypeScript)

```ts
type State = {
  ts: string;                       // ISO time the state was built
  speedMph: number | null;          // GPS speed until CAN is known
  soc: number | null;               // %, manual or estimated until CAN
  socSource: 'manual' | 'estimate' | 'can' | null;
  rangeMi: number | null;
  gear: 'P' | 'R' | 'N' | 'D' | null;   // R from the reverse wire; rest needs CAN
  gps: { lat: number; lon: number; headingDeg: number | null; fix: boolean } | null;
  ignition: boolean | null;
  reverse: boolean | null;
  cabinTempF: number | null;
  aux12v: number | null;
  tilt: { pitch: number; roll: number } | null;
  tpms: Record<'fl'|'fr'|'rl'|'rr', { psi: number | null; tempF: number | null }> | null;
  relays: Record<string, { name: string; on: boolean | null }>;  // relay_1..relay_6
  fiveSwitch: (boolean | null)[];   // 5 entries
  trip: { id: number; startedAt: string; miles: number } | null;  // current trip
  truckbox: boolean;                // truck box online
  nowPlaying: NowPlaying | null;    // from the cockpit's CarPlay; null = nothing playing or CarPlay not connected
  driver: { id: string; name: string; initials: string; color: string } | null;  // active driver
  driverSuggestion: { id: string; name: string; reason: string } | null;  // set on ignition (only with settings.askDriver on) until picked or dismissed
  place: { stopId: number; name: string | null; since: string } | null;  // the stop the truck is at; null while driving
  network: NetworkStatus;           // how the cockpit is online (docs/connectivity.md)
  chargePeak: ChargePeak | null;    // charging at home during on-peak (see "Charging on-peak")
};

type NetworkStatus = {
  link: 'home' | 'hotspot' | 'bt' | 'offline';
  label: string;                    // "HOME WI-FI", "JEFF'S HOTSPOT", "BT · JEFF", "OFFLINE"
  ssid: string | null;              // Wi-Fi network joined, if any
  driverId: string | null;          // whose phone it is (hotspot / bt)
  signal: number | null;            // 0-100 (Wi-Fi), null when unknown
  manual: boolean;                  // picked by hand; automatic order paused until "Automatic"
  saveData: boolean;                // on a phone link with Settings.saveDataOnHotspot: heavy features pause
  bytesThisTrip: number;            // over phone links (hotspot + bt) since the current trip started
  bytesThisMonth: Record<string, number>;  // driverId -> bytes over their phone this calendar month
  backend: 'nmcli' | 'sim' | 'unavailable';
  bluetooth: 'supported' | string;  // otherwise why not ("no Bluetooth device in NetworkManager")
  error: string | null;
};

type NowPlaying = { title: string | null; artist: string | null; album: string | null; source: 'carplay' };

// Truck-level settings: one set, whoever drives.
type Settings = {
  truckId: string;
  packKwh: number;                  // usable pack, default 52.7 (verify at delivery)
  efficiencyMiPerKwh: number;       // default 3.5, refined from trips
  relays: Record<string, string>;   // id -> display name
  keys: { afdc?: string; openChargeMap?: string; placesFeed?: string; googlePlaces?: string };  // entered in the settings page, never in files; placesFeed = "user:password" (Basic auth); googlePlaces = optional, billed (live stall counts)
  homeAssistant: {
    bridge: boolean;                // publish MQTT discovery
    homeChargerEnergyEntity?: string;  // HA sensor with the wall charger's session kWh
    homeChargerPowerEntity?: string;   // HA sensor with the wall charger's power, W or kW (see "Charging on-peak")
    url: string | null;             // e.g. http://homeassistant.local:8123 (LAN or Tailscale)
    token?: string;                 // long-lived access token; masked like keys, never logged
  };
  homeRate: {                       // home electricity, for pricing home sessions
    flatPerKwh: number | null;      // used when no TOU periods are set
    tou: { name: string; days: number[]; start: string; end: string; perKwh: number; alertOnCharging: boolean }[];  // e.g. on-peak weekdays 16:00-19:00; see "Charging on-peak"
    fixedPerSession: number;        // default 0
    demandPerKw: number | null;     // the plan's on-peak demand charge, $/kW (see "Charging on-peak")
  };
  compareVehicle: CompareVehicle;   // the gas vehicle you'd otherwise drive; replaces compareMpg
                                    // (an old compareMpg migrates to {id: null, label: "Custom", all three mpg = it, fuel: "regular"})
  gas: {                            // replaces the old gasPrice (migrated into manualPrice)
    source: 'manual' | 'ha';
    manualPrice: number;            // USD/gal, default 3.50; also the last fallback
    haEntities: string[];           // GasBuddy price sensors in HA (sensor.*)
    pick: 'cheapest' | 'average';
  };
  placesFeed: { url: string | null };  // optional: GET -> [{name, lat, lon, radiusM?}]
  homeLocation: { lat: number; lon: number } | null;  // within 150 m = a home charge session
  homeWifi: { ssid: string; password?: string } | null;  // password masked like keys
  saveDataOnHotspot: boolean;       // default true: pause radar animation / internet radio on a phone link
  askDriver: boolean;               // default false: pop up "Who's driving?" on ignition
  payoffGoal: PayoffGoal;           // see "Payoff goal"
  drivers: Driver[];                // always has a Guest; seeded Jeff/Sam/Jordan when empty
};

// Per-driver settings. Old flat settings.json (theme, layout, charging at the top)
// migrate into the first driver, Jeff, on load; nothing is dropped.
type Driver = {
  id: string;                       // lowercase, digits, "-"; "guest" is the built-in Guest
  name: string; initials: string;   // initials: 1-3 characters, shown in the rail
  color: string;                    // #rrggbb
  guest: boolean;                   // the built-in Guest: can't be deleted, no favourites
  tracker: string | null;           // HA person.* or device_tracker.* (presence + phone history)
  theme: {
    active: string;                 // a preset id or a custom theme id
    auto: { enabled: boolean; day: string; night: string };  // switch at local sunrise/sunset from GPS
    custom: Theme[];                // made in the portal's theme editor; import/export as JSON
  };
  layout: Layout;
  charging: {
    networks: string[];             // preferred, e.g. ["Tesla", "Electrify America"]
    avoidNetworks: string[];
    minKw: number;                  // default 50
    connector: 'NACS' | 'CCS' | 'J1772' | 'any';
    maxDetourMi: number;            // default 10
    wantAmenities: string[];        // e.g. ["restroom", "food", "shade"]
    arriveMinSoc: number;           // default 15
  };
  favouritePlaceIds: number[];      // Place ids
  compareVehicle: CompareVehicle | null;  // per-driver override; null = the truck's
  hotspot: { ssid: string; password?: string } | null;  // their phone's hotspot; password masked like keys
  btTetherMac: string | null;       // their phone's Bluetooth address (AA:BB:CC:DD:EE:FF) for PAN tethering
};

// One way online, in the order the brain tries them (docs/connectivity.md):
// home Wi-Fi, the active driver's hotspot, other drivers' hotspots, the active
// driver's Bluetooth tether. Switching driver re-orders at once.
type NetCandidate = {
  id: string;                       // "home", "hotspot:jeff", "bt:jeff"
  kind: 'home' | 'hotspot' | 'bt';
  label: string; ssid: string | null; driverId: string | null;
  inRange: boolean; signal: number | null; active: boolean;
};

// From fueleconomy.gov (id = its vehicle id), or typed in (id null, label "Custom").
type CompareVehicle = {
  id: number | null; label: string;    // e.g. "2019 Toyota Tacoma 4WD"
  mpgCity: number; mpgHighway: number; mpgCombined: number;
  fuel: 'regular' | 'midgrade' | 'premium' | 'diesel';
};

type Charger = {
  id: string; source: 'afdc' | 'ocm' | 'google';
  name: string; network: string | null;
  lat: number; lon: number; distanceMi: number;
  maxKw: number | null; connectors: string[];
  amenities: string[]; price: string | null;   // the feeds' price text, as published
  availability?: { available: number; total: number; outOfService: number; updatedAt: string | null } | null;
                                      // Google Places live counts (DC stalls when the site has any); null/absent = unknown
  lastPaid?: { sessionId: number; at: string; cost: number; kwh: number | null; perKwh: number | null; sessions: number } | null;
                                      // newest public charge_sessions row with a cost at this site (any driver)
  score: number; reasons: string[];   // why it ranked where it did, shown in the UI
};

type Trip = {
  id: number; startedAt: string; endedAt: string | null;
  miles: number; durationS: number;
  startSoc: number | null; endSoc: number | null; kwhEst: number | null;   // always null for phone trips
  start: { lat: number; lon: number }; end: { lat: number; lon: number } | null;
  driverId: string | null;          // null = before drivers existed
  source: 'truck' | 'phone';        // phone = replayed from HA history: miles are straight lines between sparse points
  simulated: boolean;               // recorded by a SIM=1 brain (see "Payoff goal")
  from: StopRef | null; to: StopRef | null;  // shown as "Home → Costco"
};
type StopRef = { stopId: number; name: string | null };   // null name = "Unnamed stop"

// Anywhere the truck (or the phone) stayed put: ignition off, or < 2 mph within
// 75 m for >= 3 min. Shorter stops fold into the trip.
type Stop = {
  id: number; driverId: string | null; source: 'truck' | 'phone';
  arrivedAt: string; departedAt: string | null;  // null = the truck is still there; a phone stop still going
                                                 // when the imported history ends is closed at the range end
  durationS: number;
  lat: number; lon: number;
  reason: 'ignition' | 'dwell';
  name: string | null;              // null = "Unnamed stop"
  // first match wins, each within its radius: saved place > HA zone > places feed > OSM reverse geocode
  nameSource: 'place' | 'zone' | 'feed' | 'geocode' | null;
  placeId: number | null;
};

type Place = {                      // a saved, named place (truck-level, in SQLite)
  id: number; name: string; lat: number; lon: number; radiusM: number;  // default 120
  visits: number; lastVisit: string | null;   // stops inside it (for ?driver=, that driver's)
};
type PlaceSuggestion = { lat: number; lon: number; visits: number; suggestedName: string | null; stopIds: number[] };

type TimelineItem = ({ kind: 'stop' } & Stop) | ({ kind: 'trip' } & Trip);

type ImportJob = {
  id: number; driverId: string; tracker: string; from: string; to: string;
  state: 'running' | 'done' | 'error';
  daysDone: number; daysTotal: number;   // paged by day
  points: number; dropped: number;       // dropped: gps_accuracy > 100 m or no coordinates
  trips: number; stops: number;
  startedAt: string; finishedAt: string | null; error: string | null;
};

type GasStatus = {
  source: 'manual' | 'ha';
  fuel: CompareVehicle['fuel'];     // the grade shown: the compare vehicle's
  today: { price: number; station: string | null; fuel: string | null; fetchedAt: string; updatedAt: string | null } | null;
  manualPrice: number;
  message: string | null;           // e.g. "Connect Home Assistant on the settings page"
  days: { day: string; fuel: string; price: number; station: string | null }[];  // last 60 stored days, every grade
};
type GasSensor = { entityId: string; name: string; price: number | null; unit: string | null; attribution: string | null };

// What Jeff pays to charge. Public sessions are entered by hand (phone,
// settings portal, or the Charge view right after unplugging); home sessions
// are priced from kWh x the home rate plan in Settings.homeRate.
type ChargeSession = {
  id: number;
  startedAt: string; endedAt: string | null;
  place: 'home' | 'public' | 'other';
  network: string | null;           // e.g. "Electrify America"; null for home
  stationName: string | null;
  lat: number | null; lon: number | null;
  kwh: number | null;               // from the receipt, the home charger, or null
  cost: number | null;              // USD actually paid, incl. idle/session fees
  costSource: 'receipt' | 'home-rate' | 'free' | null;
  startSoc: number | null; endSoc: number | null;
  maxKw: number | null;
  note: string | null;
  source: 'manual' | 'detected' | 'home-charger';  // how the session was created
  driverId: string | null;          // active driver when it was logged
  simulated: boolean;               // logged by a SIM=1 brain (receipts never are)
  onPeak?: string | null;           // GET /api/charges only: the alert period a home session overlapped
};

type ChargeSummary = {
  period: string;                   // "2027-05" or "2027"
  sessions: number; kwh: number; cost: number;
  homeCost: number; publicCost: number;
  costPerKwh: number | null;
  miles: number;                    // from truck trips in the same period (phone trips never count)
  costPerMile: number | null;
  gasEquivalent: number | null;     // what the compare vehicle's fuel would have cost for those miles:
                                    // per trip, cityMiles / mpgCity + highwayMiles / mpgHighway when a trip
                                    // carries that split (any rest, or no split, at mpgCombined), x that
                                    // trip-day's price for the vehicle's fuel grade (stored HA price for the
                                    // day, else the nearest known day of that grade, else gas.manualPrice)
  gasVehicle: string;               // label of the vehicle compared against ("2019 Toyota Tacoma 4WD")
};

// A theme is a token set; every UI colour comes from it. Presets: night, day,
// toolbox-red, synthwave, mint-emerald, tar-pit, wopr, clean-slate, bel-air (brain/src/themes.ts).
type Theme = {
  id: string; name: string;         // id: lowercase, digits, "-"; must not reuse a preset id
  colors: Record<'bg'|'panel'|'panel2'|'line'|'fg'|'dim'|'accent'|'accentInk'|'ok'|'warn'|'bad', string>;  // #rrggbb
  fonts: { display: string; body: string; mono: string };  // from the bundled list in themes.ts
  radius: number;                   // corner scale 0..2, 1 = default
  glow: number;                     // 0..1 accent glow on active controls
};

type Layout = {                     // per view, a grid of widgets on the 1920x720 bar
  views: { id: string; label: string; widgets: { type: string; col: number; row: number; w: number; h: number; props?: Record<string, unknown> }[] }[];
};
```

## Home Assistant (REST, from the brain)

`homeAssistant.url` + `token`. Everything here is optional: without it the
cockpit works and says "connect Home Assistant on the settings page" where a
feature needs it.

- Presence: `GET /api/states/<tracker>` (latitude, longitude, last_updated).
  On ignition, a driver whose tracker is within 150 m of the truck and updated
  in the last 10 minutes is suggested; exactly one = preselected, else the last
  driver stays.
- Zones: `GET /api/states`, `zone.*` (latitude, longitude, radius, friendly_name),
  every 30 min, for stop names.
- Phone history: `GET /api/history/period/<start>?filter_entity_id=<tracker>&end_time=<end>&significant_changes_only=0`,
  one request per local day. Full attributes (no `minimal_response`): HA returns
  a list with one list of state objects per entity; each has `attributes.latitude`,
  `longitude`, `gps_accuracy`, and `last_updated`. `significant_changes_only=0`
  because a `person.*` position change is an attribute change, which HA's default
  significant-changes filter can drop. Points with `gps_accuracy` > 100 m or no
  coordinates are dropped. Re-importing replaces that driver's phone trips and
  stops in the range.
- Gas: `GET /api/states/<entity>` for each of `gas.haEntities` every 30 min
  (GasBuddy, firstof9/ha-gasbuddy: state = price; `unit_of_measurement` e.g.
  `USD/gal` or `¢/L`; `attributes.last_updated` = when GasBuddy last saw the
  price; the grade comes from the entity id / name: regular, midgrade, premium,
  diesel). One price per local day per grade is stored (the day's latest
  fetch, cheapest or average). Premium or diesel with no matching sensor use
  `gas.manualPrice`.
- Places feed (`placesFeed.url`, optional Basic auth in `keys.placesFeed`):
  `[{name, lat, lon, radiusM?}]`, refreshed every 30 min.

## Network (brain, Linux)

NetworkManager through `nmcli`, run with `execFile` and an argument list, never a
shell string. Client radio: `NET_CLIENT_IFACE` (default `wlan1`, the USB adapter);
the built-in `wlan0` stays the `slate-truck` access point and is never touched by
the brain. The brain owns only connection profiles named `slate-net-*`
(`slate-net-home`, `slate-net-hotspot-<driverId>`, `slate-net-bt-<driverId>`),
keeps them in step with Settings, sets their autoconnect priorities from the
order above, and switches with `nmcli connection up`. Data use is read from
`/sys/class/net/<iface>/statistics`. On a desk (not Linux, or `SIM=1`, or no
`nmcli`) a simulated backend stands in.

## Outside services

- Reverse geocoding: OpenStreetMap Nominatim, at most 1 request/second,
  `User-Agent: slate-cockpit/<version>` (no personal email), only when online,
  results cached forever in SQLite (rounded to ~11 m).

## Rules

- **Read-only on the truck.** Nothing in this build writes to the Slate's own
  systems. Relays switch only circuits we add.
- **Unknown is `null`**, never 0 or a guess. The UI shows "—" and says why.
- **Keys go in the settings page**, stored in the brain's data dir, never in
  the repo or `.env`.
- **Simulation:** `SIM=1` makes the brain invent GPS, speed and truck-box
  data so everything runs on a desk. By itself it drives a loop around
  Phoenix on real streets (`brain/src/simRoads.ts`, baked from OpenStreetMap
  routing by `scripts/bake-sim-roads.mjs`), at each road's speed, braking for
  corners, with red lights off the freeway; the test panel (More › Test panel, `ui/src/sim/`) takes the wheel
  through `GET/POST /api/sim` (`SimControl`: mode auto|manual, gear
  park|reverse|drive, ignition, targetMph, loop, cabinF, auxV, lowTire,
  switches), `POST /api/sim/jump {leg}`, `/api/sim/tow {seconds}`,
  `/api/sim/bump`, `/api/sim/cameras` (back to the five desk cameras),
  `POST /api/sim/charge {kind: home|fast, target}`, `/api/sim/unplug` and
  `/api/sim/soc {value}`. Every answer adds `soc` and `rangeMi`. While plugged in
  the brain anchors the charge level every 2 points (never a last step under 2),
  so ChargeService logs one growing session; a home charge sets the CAN
  charging hook for the on-peak warning. Putting it in gear unplugs it.
  The panel still only produces truck-box topics and GPS fixes, so the real
  code path runs. Every `/api/sim*` route is 404 unless `SIM=1`.
- **Globe feed:** `GET /globe/aircraft.json` is the truck as one ground
  vehicle in dump1090's `aircraft.json` form (`hex` f1a7e0 from ICAO's reserved
  block, `flight` = `GLOBE_CALLSIGN`, category C2, `alt_baro: "ground"`, `gs`
  in knots, `track`), and no aircraft without a GPS fix. God's Eye View's Local
  ADS-B layer reads it (`LOCAL_RECEIVER_FEEDS=1090=http://<brain>/globe/aircraft.json`).
  Outside `/api` and without a login, because God's Eye sends none: on under
  `SIM=1`/`DEMO=1`, 404 on a real truck unless `GLOBE_FEED=1`.

## Track A: Drive

Drive screen, speedometers, tilt, weather, city/highway range, speed limits,
lockouts, brightness and heat (docs/drive-v2.md §1-6, §8). Brain code in
`brain/src/drive/`, cockpit code in `ui/src/drive/`. Shapes in
`brain/src/drive/types.ts` (re-exported from `types.ts`).

### MQTT: truck box, added

| Topic | Payload | Notes |
|---|---|---|
| `slate/truckbox/sensor/ambient_lux/state` | lux, float | light sensor for auto brightness (SIM provides a day curve) |

### State, added

`State.drive: DriveState | null` (null only before the drive service starts):

```ts
type DriveState = {
  mode: 'city' | 'highway';          // shown mode: the override, else the classifier
  override: 'auto' | 'city' | 'highway';
  avgMph2min: number | null;         // time-weighted rolling 2-minute average; >= drive.highwayMph = highway
  efficiency: { city: number; highway: number; learnedMiles: { city: number; highway: number } };  // mi/kWh
  range: { city: number | null; highway: number | null; current: number | null };  // miles; State.rangeMi is unchanged
  sinceCharge: SinceCharge | null; sinceChargeWhy: string | null;
  speedLimit: { mph: number | null; raw: string | null; road: string | null; wayId: number; at: string } | null;
  speedLimitWhy: string | null;
  weather: WeatherBrief | null; weatherWhy: string | null;
  lockout: { locked: boolean; bigTargets: boolean; passenger: boolean };   // locked: over drive.lockoutMph (unlocks after 5 s at or under); bigTargets: on at >= 25 mph, off after 15 s at <= 15 mph (so it doesn't flicker around 25 or at a light); passenger: passenger mode is on
  heat: { cpuC: number | null; source: 'thermal' | 'vcgencmd' | 'sim' | null; level: 'ok' | 'throttle' | 'warn' | 'shutdown'; parkedInSun: boolean; message: string | null };
  brightness: { pct: number | null; auto: boolean; lux: number | null; night: boolean; backend: 'ddcutil' | 'sysfs' | 'sim' | 'none'; error: string | null };
  tilt: { warnDeg: number; dangerDeg: number; level: 'ok' | 'warn' | 'danger' | null };
};
type SinceCharge = {                 // since the most recently ended charge session
  since: string; sessionId: number; miles: number;
  kwh: number; kwhSource: 'soc' | 'miles';   // SoC drop only from a real (CAN) reading, else miles / per-mode mi/kWh
  miPerKwh: number | null; pctUsed: number | null; costPerMile: number | null;  // that charge's $/kWh x kWh / miles
};
type WeatherBrief = { place: string | null; tempF: number | null; icon: WeatherIcon; condition: string; isDay: boolean;
  highF: number | null; lowF: number | null; windMph: number | null; windDir: string | null;
  fetchedAt: string; stale: boolean;  // stale = older than 45 min
  alerts: { event: string; severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'; expires: string | null }[] };
```

Mode learning: each mode's mi/kWh is an EWMA over 2-mile windows of that mode,
learned only while the SoC is a real reading (CAN); until then the seeds hold.
The SoC estimate decays by the current mode's mi/kWh.

`Trip` gains `cityMiles`, `highwayMiles`, `cityKwh`, `highwayKwh` (numbers or
null for trips recorded before the split; kWh are estimates at the per-mode
mi/kWh, and `kwhEst` becomes their sum). The charge summary's gas comparison
already prices `cityMiles` at mpgCity and `highwayMiles` at mpgHighway.

### Settings, added

```ts
Settings.truck: {                    // the owner's build, for the tilt drawing and /settings > Truck > My Slate
  colors: { body; roof; wheelDecal; trim: '#rrggbb'; logo: '#rrggbb' | 'none'; lampPlates: '#rrggbb' | 'synthwave' };
  finish: 'satin' | 'gloss' | 'matte'; roofWrap: boolean;
  wheels: { inches: 17; style: 'steel' };          // black steel; wheelDecal is the ring decal on it
  accessories: { tonneau: 'none' | 'nexus-flip'; hitch: boolean; bedLights: boolean };   // the ones the drawing shows
  interior: { bolster: string; armrest: string };  // Slate colour names (WRAP_COLORS, e.g. 'Cardinal') or 'none' (standard, no insert); display only
  slateShareUrl: string | null;      // https://www.slate.auto/share/<code> or https://www.slate.auto/store?…shortcode=<code> (code 4-16 letters/digits); '' = null
  accessoryList: string[];           // the build's accessory names as Slate lists them (≤ 60, ≤ 80 chars each)
  photo: { file: 'vehicle-photo.jpg' | 'vehicle-photo.png' | 'vehicle-photo.webp'; updatedAt: string; source: 'upload' | 'url' } | null;
};  // default: the author's build (slate.auto share ABC123): Toolbox Red satin wrap, Clean Slate roof and wheel rings,
    // Tar Pit logos (set 'none' for the build without logo decals), Synthwave lamp plates, black trim, NEXUS, hitch,
    // bed lights, no bolster insert, Cardinal armrest, its 23 accessories (incl. Slate Telematics Module, CCS to NACS
    // Adapter); no share link, no photo.
    // An older settings.json keeps every stored value; the new fields arrive with these defaults.
    // `photo` is set only by /api/vehicle/photo: PUT /api/settings ignores it. A bad stored record loads as null.
Settings.drive: {
  highwayMph: 45; efficiency: { cityMiPerKwh: 4.0; highwayMiPerKwh: 3.2; alpha: 0.2 };  // seeds + EWMA weight
  tilt: { warnDeg: 20; dangerDeg: 30 };
  heat: { throttleC: 75; warnC: 80; shutdownC: 85; parkedSunF: 110 };
  brightness: { auto: true; manualPct: 80; minPct: 10; maxPct: 100; nightMaxPct: 45 };
  speedLimits: true; lockoutMph: 5;
};
Driver.drive: { speedo: 'auto' | 'digital' | 'sweep' | 'fifty-seven' | 'ribbon' | 'minimal'; overLimitWarn: false; overLimitMph: 5 };
Theme.speedo?: same styles      // a theme's pairing, used by a driver's 'auto' (Bel Air -> 'fifty-seven')
```

A driver layout whose Drive view is still the old default widget set is moved
to the new single `drive` widget on load; customised layouts are left alone.

### HTTP, added

- `GET  /api/drive` → `DriveState`
- `POST /api/drive/range-mode` `{mode: 'auto'|'city'|'highway'}` → `DriveState` (kept across restarts)
- `GET  /api/weather` → the full `WeatherReport` (12 hourly periods, sunrise/sunset,
  alerts with polygons as `[lat, lon]` rings) + `error`; 503 with a reason before the first report
- `GET  /api/brightness` → `DriveState['brightness']`; `POST /api/brightness` `{auto?, pct?}`
  (pct 1-100 sets the manual level and turns auto off unless `auto` is given)
- `GET  /api/vehicle/photo` → the truck photo (`DATA_DIR/vehicle-photo.<ext>`), 404 without one. ETag +
  Last-Modified; `?v=<photo.updatedAt>` is cached a day, the bare URL is `no-cache`. Open (no login), so the
  dash and the Truck page can show it.
- `POST /api/vehicle/photo` → `{photo}`: either the raw image bytes (`Content-Type: image/jpeg|png|webp` or
  `application/octet-stream`; the type is taken from the magic bytes; ≤ 6 MB, else 413) or JSON `{url}`
  (https only, every redirect hop https too, at most 3; `image/*` content type; ≤ 6 MB; 15 s). Replaces any
  earlier photo. `DELETE /api/vehicle/photo` → `{photo: null}`. Both sit behind the /settings login (Track D gate).
  (`/truck` and `/api/truck` are Track C's; this is deliberately `/api/vehicle/*`.)
- The Drive screen's tilt card shows the photo while parked (under 1 mph, not locked out, tilt below
  `drive.tilt.warnDeg`) with the pitch and roll beneath; moving or steep, the live drawing returns.

### Outside services, added

- **Weather:** `api.weather.gov` (points → forecast, hourly forecast, latest
  observation of the first station, `alerts/active?point=`), `User-Agent:
  slate-cockpit/<version>`, no email. Fallback: `api.open-meteo.com` (°F, mph,
  `timezone=auto`). Refresh every 15 min while online or after moving 10 km;
  2 min back-off after a failure; the last report is kept in SQLite and shown
  with its age. NWS point lookups cached a week per ~1 km. The place name is
  the stops naming chain (saved place, HA zone, places feed), else NWS's
  nearest town.
- **Radar (UI only):** `api.rainviewer.com/public/weather-maps.json`, tiles at
  zoom ≤ 7 (scaled beyond). Base map `tile.openstreetmap.org`, recoloured by CSS
  for dark themes; attribution on the map. With `network.saveData` the radar
  shows only the latest frame (no animation).
- **Speed limits:** Overpass (`overpass-api.de`, then a mirror), `way(around:40)`
  of road classes, `out tags geom`, at most one query per 15 s while moving and
  online, 2 min back-off on 429/5xx; every returned way is cached in SQLite
  (`osm_ways`, by bounding box) and matched locally by distance (≤ 25 m) and
  heading. `maxspeed` parsing: bare numbers are km/h, "mph"/"knots" units are
  honoured, implicit values (`US:urban`), `none`, `walk`, `signals` are unknown.

### Lockouts (for any view)

`ui/src/drive/Lock.tsx` exports `<DrivingLock what="video"|"browser"|"list">`:
over `drive.lockoutMph` its children are replaced by a "paused while driving"
notice. The Trips lists use it, and the Settings link is disabled. Media and
browser views (Track B) should wrap their video and browser panes in it. At
`lockout.bigTargets` the app root gets `.at-speed` (larger hit targets; the
Theme, Logs and Settings rail buttons stay but dim, and tapping one while driving asks "Are you the passenger?" first; yes turns passenger mode on and opens it); at heat level `throttle` and above
it gets `.calm` (no transitions or animations).

**Passenger mode** (`POST /api/drive/passenger {on: boolean}`, switched in
Settings, Truck) lifts the content lockouts while moving: `<DrivingLock>`, the
traffic camera pictures, and the parked apps (Watch, Games, Karaoke, Plex
video). `lockout.locked` keeps meaning "moving", so camp/pet mode still end,
the light strip still goes off and the Lights tab stays parked only. The app
root gets `.passenger`: the Settings rail button stays at speed, and a
"Passenger" pill in the top strip turns it off. While moving with it off, the
top strip shows an outlined "Passenger?" button that asks and turns it on
(Settings steps aside at speed, so this is the way in). Tapping anything a lockout
paused (except the Lights tab) asks "Are you the passenger?" and turns it on.
Not saved: it lasts until the brain next starts, or until it is turned off. Code that
gates on-screen content uses `useLockout().locked` (or `locked &&
!passenger`); code that means "the truck is moving" uses `lockout.locked`.

### Brightness and heat on the Pi

- Brightness writes go to `ddcutil setvcp 10 <pct> --noverify` (DDC/CI over
  HDMI: needs `i2c-dev` loaded and the brain's user in group `i2c`), else
  `/sys/class/backlight/*/brightness`, else a simulated backend. At most one
  write per 4 s and only for a change of 3 % or more.
- CPU temperature from `/sys/class/thermal/thermal_zone0/temp`, else `vcgencmd
  measure_temp`; simulated on a desk. Held at or above `heat.shutdownC` for 30 s,
  the brain runs `systemctl poweroff` (Linux, not SIM; `HEAT_SHUTDOWN=0` disables).
## Track B: Media and WOPR

Built 2026-11-05 (branch `track/b-media`). Code: `brain/src/trackb.ts`
(registers it all, one call from server.ts), `brain/src/media/`,
`brain/src/wopr/`, `brain/src/receipts/`; UI in `ui/src/media/`,
`ui/src/wopr/`, `ui/src/receipts/`, `ui/src/settings/TrackBSections.tsx`.
Shared shapes: `brain/src/media/types.ts` (types only, imported by the UI).

### Now playing (changes to the above)

- `NowPlaying.source` is `'carplay' | 'spotify' | 'radio' | 'fm' | 'plex' | 'local'`.
- WS `{"type":"media", title, artist, album, source?}`: `source` defaults to
  `carplay` (old clients unchanged). Each cockpit socket keeps one report per
  source; the brain's Spotify poller reports `spotify` while the truck's
  Connect device plays. `State.nowPlaying` = the most recently *started*
  report (a new song from the same source keeps its place); when it stops, the
  next one shows. A closing socket drops its reports. HA's Now playing sensor
  already carries `source` as an attribute.
- The cockpit's own player (radio, AM/FM, Plex, files) sends `title: null`
  with its source when it pauses or stops.
- `ChargeSession.source` gains `'receipt'`.
- Layout widget types: `media` (the source tabs), `nextAppointment` (a card
  any view can place; **Track A: put it in the Drive view's right column**)
  and `nowPlaying` (now any source; tap opens Media). A driver layout without
  a `media` view gets one after `carplay` in the UI (`withMediaView()`;
  nothing is saved).

### Settings: `DATA_DIR/media.json` (its own file, mode 0600)

`GET /api/media/settings` → masked; `PUT` = partial merge (400 on bad values).
Secrets behave like `keys`: shown as `••••abcd`, a masked value = unchanged,
`""`/null = remove.

```ts
type MediaSettings = {
  wopr: { url: string | null; username: string; password?: string };   // WOPR's APP_PASSWORD (Basic auth)
  spotify: { clientId: string | null; deviceName: string; connect: boolean; bitrate: 96 | 160 | 320;
             tokens: Record<string, SpotifyToken> };   // per driver; never returned: GET has spotify.connected[driverId] = {user}
  plex: { url: string | null; token?: string };
  radio: { kjefUrl: string; favourites: Record<string, RadioStation[]> };  // kjefUrl default https://radio.jeffraben.com/stream.mp3
  fm: { presets: { mhz: number; name: string }[]; ppm: number; gain: number | null };  // AM in MHz: 620 kHz = 0.62
  local: { folder: string | null };   // null = DATA_DIR/music
  receipts: { autoImport: boolean };
};
```

### Media routes

- `GET /api/media/status` → `MediaStatus` (saveData, link, spotify, radio.now,
  fm tuner, plex configured, local root, wopr status).
- Radio (Radio Browser; servers from DNS SRV `_api._tcp.radio-browser.info`,
  fallback de1/de2/fi1; `User-Agent: slate-cockpit/<version>`):
  `GET /api/media/radio/presets`; `GET /api/media/radio/search?q=&tag=&country=`
  (503 offline); `GET|POST /api/media/radio/favourites` (`{station}`, the
  active driver's, not Guest); `DELETE /api/media/radio/favourites/:id`;
  `GET /api/media/radio/stream/:id` (the brain relays the stream with the ICY
  metadata taken out; only presets, favourites and search results relay);
  `GET /api/media/radio/now` → `{stationId, name, title, artist, since} | null`.
- AM/FM: `GET /api/media/fm/status` → `{tuner: {state: 'present'|'none'|'no-software'|'sim'|'busy', message}, tuned, presets}`;
  `GET /api/media/fm/stream?mhz=` → audio/mpeg (`rtl_fm | ffmpeg`; 503 with
  the reason when there is no tuner, e.g. SIM); `POST /api/media/fm/stop`;
  `POST /api/media/fm/seek {from, dir: 1|-1}` → `{mhz | null}` (rtl_power sweep).
  Status also carries `source: 'tuner'|'internet'|'hdserver'` and
  `hd: {tuner: bool (nrsc5 installed), server: {configured, reachable}}`.
- HD Radio (HD1-HD4, song titles): on the truck's tuner,
  `GET /api/media/fm/stream?mhz=&hd=1-4` runs `nrsc5 -t raw -o - | ffmpeg`
  (never `--dump-aas-files`: nrsc5 writes those under names the broadcast
  picks, unchecked). Through a remote nrsc5-webplayer (`fm.hdServer`),
  `GET /api/media/fm/hd/stream?mhz=&hd=` tunes it (`/tune_manual`) and relays
  its `/stream.mp3`; `GET /api/media/fm/hd/server-art?f=<name>` relays its
  album art (a checked file name, images only). `GET /api/media/fm/hd/now` →
  `{via, mhz, hd, synced, station, slogan, title, artist, album, genre,
  programs: [{hd, type}], art, merDb, kbps, alert, since, fallback} | null`.
  Truck tuner, HD1 only: no lock for 15 s, or the lock lost for 8 s, switches
  the same `/stream` to the analog signal (rtl_fm, re-encoded to the HD
  stream's 44.1 kHz stereo so the `<audio>` plays on); HD is tried again 2
  and 10 minutes later, then only on `POST /api/media/fm/hd/retry` (409 when
  not on a fallback). `fallback: {since, retryAt | null, analog} | null`
  (`analog` false: trying HD right now). HD2-HD4 never fall back (analog is
  HD1's programme). `POST /api/media/fm/hd/scan {scope: 'presets'|'band'|'mhz',
  mhz?}` → 202 `{job}` listens to each FM frequency with nrsc5 (up to ~15 s
  each; the radio is off meanwhile and a new stream cancels it);
  `GET /api/media/fm/hd/scan` → `{job: {running, done, total, current, error}
  | null, found: [{mhz, hd, station, slogan, programs, at}]}`.
  Auto source order: tuner, then the HD Radio server when it answers, then
  internet streams. Presets may carry `hd: 1-4`.
- Plex (the token stays in the brain): `GET /api/media/plex/sections`,
  `…/artists?section=`, `…/recent?section=`, `…/playlists`,
  `…/children?key=&type=`, `…/search?q=` → `PlexItem[]`;
  `GET /api/media/plex/track/:key` (audio, Range passed through);
  `GET /api/media/plex/thumb?path=/library/…`.
- Files: `GET /api/media/local?path=` → `LocalListing`;
  `GET /api/media/local/file?path=` (Range). Paths can't leave the folder.
- Spotify: `GET /api/spotify/status`; `POST /api/spotify/auth/start {driverId, redirectUri}`
  → `{url}` (PKCE, no secret; redirect must be https or
  `http://127.0.0.1:<port>/api/spotify/callback`); `GET /api/spotify/callback`
  (https setups, e.g. Tailscale serve); `POST /api/spotify/auth/finish {url}`
  (the 127.0.0.1 address pasted from the phone); `DELETE /api/spotify/auth/:driverId`;
  `GET /api/spotify/playlists|devices`;
  `POST /api/spotify/play|pause|next|previous|transfer|playlist` (`playlist`
  takes `{uri}`; transfer/playlist target the device named `deviceName`).
  Each owner registers a free app at developer.spotify.com; development mode
  serves at most **5 Spotify accounts**, added in the app's User Management.
  Control needs Premium. Tokens refresh 60 s early, one refresh shared by
  concurrent callers; `invalid_grant` forgets them.
- Data on a hotspot: when `State.network.saveData`, the UI asks before any
  stream that uses data (radio, Plex, Spotify to the truck), once per connection.

### WOPR routes (brain → WOPR with Basic auth; the password never reaches the UI)

All answer 503 `{error, kind: 'not-configured'|'offline'}` when WOPR isn't set
up or `State.network.link === 'offline'`; WOPR's 401/redirect = `kind: 'auth'`,
its HTML maintenance page / 502 / 503 = `kind: 'restarting'`.

- `GET /api/wopr/status`; `POST /api/wopr/test` (WOPR's ungated `GET /api/status`,
  then a one-minute `GET /api/calendar` to prove the login).
- `POST /api/wopr/stt`, body = the recording (`Content-Type: audio/webm|mp4|ogg`,
  ≤ 8 MB) → WOPR `POST /api/stt` (multipart `file`) → `{text}`.
- `POST /api/wopr/chat {text, history?: {role, content}[]}` → NDJSON lines
  `{t:'text', v}` | `{t:'searching'}` | `{t:'done'}` | `{t:'error', message, kind?}`.
  The brain sends WOPR `POST /api/WOPR {messages, model:'claude', voice:true,
  save:true, skipMemory:false, think:false, deep:false}`, messages =
  [primer, "Understood.", last 12 of history, question], as WOPR's phone page
  does. Primer: `Current time: …`, the truck instructions (spoken, short, can't
  change anything), a `[TRUCK — live]` block (driver, driving / parked at,
  location, battery and range, next calendar stop, now playing, link) and
  WOPR's own `GET /api/mobile/context` (cached 3 min) with `[id:…]` tags
  removed. `[[WOPR_SEARCH]]` / `[[WOPR_KEEPALIVE]]` are stripped by the brain
  (also when split across chunks); action JSON is stripped by the UI with
  WOPR's `splitActions` rule and never applied (a "Not done from the truck"
  note says so).
- `POST /api/wopr/tts {text}` → WOPR `POST /api/tts {text, provider:'cartesia'}`
  → audio. The UI speaks sentence by sentence while the reply streams (WOPR's
  `extractSentences` rule) and shows a subtitle.
- `GET /api/wopr/next` → `{configured, online, next: Appointment | null, fetchedAt, message}`;
  `POST /api/wopr/next/refresh`. From WOPR
  `GET /api/calendar?timeMin=now-15m&timeMax=now+36h` every 5 min: the first
  timed, not-ended event that started at most 15 min ago.
  `Appointment = {id, title, start, end, location, wazeUrl}`; online-meeting
  locations don't count; `wazeUrl = https://waze.com/ul?q=<location>&navigate=yes`.
- Gate codes: when `State.place.stopId` changes to a new stop, the brain sends
  WOPR `POST /api/where {lat, lon}` (plain-text answer) and keeps an answer
  with codes **in memory only** (never on disk, never in State, never on
  MQTT/HA, never logged) until the truck leaves, it is dismissed, or 30 min
  pass. `GET /api/wopr/gate` → `{kind:'codes', place, codes: [{label, value}], how, text, stopId, at} | null`;
  `POST /api/wopr/gate/check` (asked by hand: any answer comes back);
  `POST /api/wopr/gate/dismiss`.

### Charging receipts

- `POST /api/charges/import-receipt {text | html, subject?, from?, receivedAt?, messageId?}`
  → 201 `{draft, duplicate: false}`, 200 `{draft, duplicate: true}` (same
  messageId or same body), 422 (no total and no kWh). Parsers for Electrify
  America, ChargePoint, EVgo, Tesla Supercharger: network, station, address,
  start/end (US time-zone abbreviations), kWh, total incl. fees; missing = null.
- `GET /api/charges/drafts?state=draft|confirmed|dismissed|all` → `ReceiptDraft[]`;
  `POST /api/charges/drafts/:id/confirm {cost?, kwh?, network?, stationName?, startedAt?, endedAt?}`
  → `{draft, session}`: fills a detected public session within 3 h that has no
  cost (costSource 'receipt'), else creates a `source: 'receipt'` session;
  `POST /api/charges/drafts/:id/dismiss`.
- Mail: WOPR has **no route that searches mail and returns bodies** (checked
  2026-11-05: `/api/mail` is the unread count, `/api/mail/archive` moves mail,
  `/api/kb/import/mail` files mail into WOPR's archive with model calls). The
  brain already asks every 6 h (when `receipts.autoImport`) for the route
  below, and on 404 says so on /settings and retries daily;
  `GET|POST /api/charges/receipts/mail` shows / runs it. **Needed in WOPR**
  (read-only; gated like the app and held out of the LAN bypass, since it
  returns mail):

  ```
  GET /api/mail/search?q=<Graph $search text>&since=<ISO>&body=1&top=25
  → { messages: [{ id, internetMessageId, from, subject, receivedDateTime,
                   body, bodyType: 'html' | 'text' }] }
  ```

  i.e. `searchMessages(q, top)` from WOPR's `lib/outlook.ts`, kept to
  `receivedDateTime >= since`, plus each full body
  (`GET /messages/{id}?$select=body`, HTML not stripped). The brain sends
  q = `Electrify America OR ChargePoint OR EVgo OR Supercharging receipt`.

## Track C: Cameras and remote

Design: `docs/remote.md`. Code: `brain/src/cams/`, `brain/src/remote/`,
`ui/src/components/cams.tsx` + `camplayer.tsx`, `ui/src/truck/`,
`ui/src/settings/RemoteSection.tsx`, `firmware/watch/`. Types:
`brain/src/remote/types.ts`.

### Settings: `DATA_DIR/remote.json` (its own file and route, not `Settings`)

`GET /api/remote/settings` → `RemoteSettings` (secrets masked like keys);
`PUT /api/remote/settings` partial merge (arrays replace; a masked secret =
unchanged, `""`/`null` removes it; `{"remote":{"token":"new"}}` makes a new
remote token). 400 with a message on anything invalid.

```ts
type RemoteSettings = {
  cams: { cameras: CameraConfig[]; guides: GuideSettings; autoRear: boolean; defaultLayout: 'grid' | 'single' };
  dashcam: { enabled: boolean; segmentSec: number; capGb: number; preSec: number; postSec: number; parkedMotion: boolean; sceneThreshold: number };
  alerts: { rules: Record<AlertKind, { enabled: boolean; threshold: number | null; holdSec: number; cooldownMin: number }>;
            geofence: { zones: { name; lat; lon; radiusM }[]; quietStart: 'HH:MM'; quietEnd: 'HH:MM' };
            chargeTargetSoc: number; chargerPlugEntity: string | null;
            delivery: { ha: { service: string | null }; ntfy: { server: string; topic: string | null; token?: string } } };
  power: { sleepAfterMin: number; maxAwakeMin: number };
  lte: { apn: string; user: string | null; password?: string };   // read by deploy/pi/lte/setup-lte.sh
  watch: { prefix: string };                                      // default "slate/watch"
  remote: { token?: string };                                     // the Truck page / remote API token
};
type CameraConfig = { id: string; name: string; role: 'rear'|'front'|'bed'|'hitch'|'360'|'cabin'|'other';
  source: 'uvc' | 'capture' | 'rtsp' | 'test'; device: string | null; url: string | null;
  width: number; height: number; fps: number; inputFormat: 'mjpeg' | 'yuyv422' | 'auto';
  enabled: boolean; record: boolean; guides: boolean; mirror: boolean };
type AlertKind = 'cabinHot' | 'low12v' | 'motionParked' | 'theft' | 'geofence' | 'chargeStopped' | 'chargeDone' | 'unplugged' | 'tirePressure' | 'truckboxOffline';
```

### Access

Everything below is behind one check (`brain/src/remote/auth.ts`, meant to be
swapped for a real login later): requests from `REMOTE_TRUSTED_NETS` (default
loopback: the cockpit on the bar) are in; anyone else sends the remote token as
`x-slate-token`, `Authorization: Bearer`, `?token=` (links, iframes,
WebSockets) or the `slate_remote` cookie that `/truck?token=…` sets. Else 401.

### HTTP

- `GET  /truck` → the Truck page (phone-first; iframe-friendly).
- `GET  /api/truck` → `TruckSnapshot` (position from GPS or the watch, charge,
  12V, cabin, ignition, relays, `watch: WatchStatus`, `power: PowerStatus`,
  the last 20 alerts, the last 12 clips, place).
- `POST /api/truck/relay` `{id, on}` → `{ok, via: 'truckbox' | 'watch'}`: through
  the truck box when it is online, else queued to the watch; 409 otherwise.
- `GET  /api/remote/link` → `{token, path, url}` (the Truck link for a phone).
- `POST /api/remote/viewer` `{id}` → `PowerStatus`: a page heartbeat (every 20 s
  while a camera page is visible); `POST /api/remote/wake` `{id}` (Wake & view);
  `POST /api/remote/sleep`; `GET /api/remote/power`.
- `GET  /api/alerts?limit=` → `Alert[]` (newest first); `POST /api/alerts/test`.
- `GET  /api/cams` → `CamStatus` + `serverTime` (ms): `backend: 'go2rtc' |
  'fallback' | 'off'`, `why`, each camera with `live`/`error`, recording
  stats, guides, autoRear, defaultLayout.
- `GET  /api/cams/ws?src=<id>` → WebSocket, proxied to go2rtc's `/api/ws`
  (WebRTC signalling and MSE); `GET /go2rtc/video-stream.js`, `/go2rtc/video-rtc.js`:
  go2rtc's player, proxied. go2rtc backend only.
- `GET  /api/cams/:id/mjpeg` → `multipart/x-mixed-replace; boundary=frame`,
  each part with `Content-Length` and `X-Frame-Time` (ms, brain clock) for the
  latency badge. The fallback backend's live view.
- `GET  /api/cams/:id/snapshot.jpg` → the current picture.
- `POST /api/cams/clip` `{camera?}` → 202 `Clip[]` (one per recorded camera,
  `state: 'recording'` until cut); `GET /api/cams/clips?limit=` → `Clip[]`;
  `GET /api/cams/clips/<id>.mp4` (Range supported); `DELETE /api/cams/clips/:id`.
- `POST /api/cams/motion` `{camera?, how?}`: report motion (tests, HA).

```ts
type Clip = { id: string; camera: string; startedAt: string; durationS: number; reason: 'manual' | 'motion'; bytes: number; state: 'recording' | 'ready' | 'error'; error: string | null };
type Alert = { id: number; at: string; kind: AlertKind; title: string; message: string; source: 'brain' | 'watch'; delivered: string[]; error: string | null };
type PowerStatus = { awakeReason: 'ignition' | 'remote' | 'unknown'; viewers: number; sleepAt: string | null; sleeping: boolean; why: string };
```

### Files (`DASHCAM_DIR`, default `DATA_DIR/dashcam`)

- `loop/<camera>/YYYYMMDD-HHMMSS.mp4`: fragmented-MP4 segments, local start time.
- `clips/<YYYYMMDD-HHMMSS>-<camera>.mp4` + `.json` (the `Clip`). Never deleted automatically.
- `DATA_DIR/go2rtc.yaml`: generated from `cams.cameras`; edits are overwritten.

### MQTT

| Topic | Who | Payload |
|---|---|---|
| `slate/truckbox/binary_sensor/vibration/state` | truck box (`packages/vibration.yaml`) | `ON`/`OFF`, only with the ignition off |
| `slate/watch/status` | watch | `online` / `offline` (will), retained |
| `slate/watch/state` | watch | `{"ts","fix","lat","lon","gps_at","v12","cabin_f","vib","moved","ign","relays","parked","pi","rssi","batt_mv","interval_s","fw"}`, retained |
| `slate/watch/alert` | watch | `{"kind","title","message","ts"}` (HA automation → push) |
| `slate/watch/command` | HA, the brain | `{"pi":"wake"}` `{"pi":"sleep"}` `{"relay":"relay_1","on":true}` `{"interval_s":300}`, QoS 1, persistent session |
| `homeassistant/<component>/slate_watch/<id>/config` | watch | HA discovery: the **Slate Watch** device (location, 12V, cabin, signal, cell, moved, Pi awake, Wake/Sleep Pi buttons) |

The watch prefix is `remote.watch.prefix`. The brain subscribes to
`<prefix>/#` (through the Pi's Mosquitto bridge) and publishes the sleep
command when a remote wake has no viewer.

### Truck box ↔ watch UART (`packages/watch_link.yaml`, 9600 8N1, one line each)

`S?` → `S r=010000 ign=1 rev=0 v=12.61 t=78.2 lv=0`; `R<1-6>=<0|1>` (ON goes
through the truck box's safety gate); `W1`/`W0` (keep Wi-Fi on for a woken Pi /
allow parked Wi-Fi off).

### Env (plumbing only)

`GO2RTC_BIN` (go2rtc), `GO2RTC_API` (127.0.0.1:1984), `GO2RTC_RTSP`
(127.0.0.1:8554), `GO2RTC_WEBRTC` (:8555), `GO2RTC_EXTERNAL=1` (someone else
runs it), `FFMPEG_BIN`, `DASHCAM_DIR`, `CAMS_DISABLED=1`, `POWEROFF_CMD`
(`systemctl poweroff` on Linux; empty = never), `REMOTE_TRUSTED_NETS`
(`127.0.0.0/8,::1`).

### Layout widgets

`cams`: the whole Cams view (grid/single, reverse → rear with guides, save
clip, clips). `cam` `{camera?: id, label?, guides?}`: one camera (older saved
layouts keep working). The default layout's Cams view is one `cams` widget.

## Track D: Logs and ops

Mileage log, maintenance, updates, backups, the login gate and first-boot
setup. Config lives in `DATA_DIR/ops.json` (not settings.json); shapes are in
`brain/src/ops/types.ts` (pure, imported by the UI). Code: `brain/src/ops/`,
`ui/src/ops/`, `deploy/pi/updater/`, `deploy/pi/backup/`, `deploy/image/`.

### Login gate

- From `localhost` (the dash) everything is open (`auth.trustLocal`, default
  true). From any other address, once a password is set: `/settings*`,
  `/truck*` redirect to `/login?next=…`; `/api/*` and `/ws` answer 401
  `{error}`. Always open: `/`, static assets, `/login`, `/api/health`,
  `/api/about`, `/api/update/version`, `/api/auth/*`. No password set = open
  (first boot; the wizard's first step sets one).
- `GET /api/auth/status` → `{passwordSet, authed, local, trustLocal}`
- `POST /api/auth/login` `{password}` → sets cookie `slate_session`
  (HttpOnly, SameSite=Strict, 30 days); 401 wrong; 429 + `Retry-After` after 5
  failures in 15 min per address (15 min lock)
- `POST /api/auth/logout`; `POST /api/auth/password` `{current?, next}` (current
  required once one is set; at least 8 characters; logs out every other session)
- `PUT /api/security/config` `{trustLocal}`; `POST /api/security/logout-everywhere`
- `GET /api/about` → `{name, shortName, notice, license, copyright, version, installed}`
  (the project name comes from `brain/src/project.ts`, one constant)

### Setup wizard

- `GET /api/setup` → `{done, steps: {step: 'done'|'skipped'}, stepsList, passwordSet, apInitialPassword}`;
  steps: `password, ap, truck, home, drivers, ha, hotspot, vehicle`
- `PUT /api/setup` `{step, status: 'done'|'skipped'|null}` | `{done: boolean}` | `{reset: true}`
  (every step answered = done). The cockpit shows the wizard until `done`
  ("Finish later" hides it for that browser session; `?nosetup` never shows it).
- `POST /api/setup/ap-password` `{password}` (8-63) → `{applied, message}`:
  `nmcli connection modify slate-ap wifi-sec.psk …` (the polkit rule allows it);
  simulated on a desk. The other steps use the existing settings and drivers routes.

### Mileage

- `GET /api/mileage?year=&from=&to=&driver=&purpose=` (`purpose` may be
  `untagged`) → `{rows: MileageRow[], totals: MileageTotals, period, config, odometerNow}`.
  Only ended trips. Phone trips are included with `approximate: true` and no odometer.
- `PUT /api/mileage/tags` `{tripIds: number[], purpose?: Purpose|null, note?: string}`
  → `{changed}`. `purpose: null` = back to automatic; `note` omitted = unchanged.
- `GET|PUT /api/mileage/config` → `OpsConfig['mileage']`:
  `{odometerAnchor: {odometer, at}|null, rates: [{from: 'YYYY-MM-DD', centsPerMile, source}],
  driverDefaults: {driverId: Purpose}, placeTags: {placeId: 'business'|'client'|'personal'|'commute'}, feedIsBusiness}`
- `GET /api/odometer` → `{estimate, anchor, source: 'estimate'}`
- `GET /api/mileage/export.csv?…` (Date, Driver, Purpose, Business purpose /
  note, From, To, Start/End odometer (est.), Miles, Approximate, Rate,
  Deduction; totals at the end) and `/api/mileage/export.html?…` (printable)
- Purpose, first match: set by hand; the destination saved place's tag
  (client = business); destination named from the places feed → business
  (`feedIsBusiness`); the driver's default; else untagged.
- Odometer: anchor + truck-trip miles counted forward (and back for earlier
  trips), until CAN gives the real one.
- Default IRS rates: 70¢ (2025, Notice 2025-5), 72.5¢ (from 2026-01-01, Notice
  2026-10), 76¢ (from 2026-07-01, Announcement 2026-11). Check every year.

```ts
type Purpose = 'business' | 'personal' | 'commute' | 'other';
type MileageRow = { tripId: number; startedAt: string; endedAt: string | null; date: string;
  driverId: string | null; driver: string; purpose: Purpose | null;
  purposeSource: 'manual' | 'place' | 'feed' | 'driver' | null; note: string | null;
  from: string; to: string; startOdometer: number | null; endOdometer: number | null;
  miles: number; approximate: boolean; source: 'truck' | 'phone';
  rateCents: number | null; deduction: number | null };
type MileageTotals = { trips: number; miles: number; byPurpose: Record<Purpose | 'untagged', number>;
  businessMiles: number; deduction: number; untaggedTrips: number; approximateMiles: number; ratesUsed: MileageRate[] };
```

### Maintenance and TPMS

- `GET /api/maintenance` → `{log: MaintEntry[], reminders: ReminderStatus[], odometer, notifyService}`
- `GET /api/maintenance/due` → `{odometer, items: ReminderStatus[]}` (due first, then soon): the Drive card
- `POST /api/maintenance/log` `{date, item?, reminderId?, odometer?, cost?, shop?, note?}`
  (a `reminderId` marks that reminder done); `PUT|DELETE /api/maintenance/log/:id`
- `POST /api/maintenance/log/:id/receipt`: body = the photo or PDF itself
  (`image/jpeg|png|webp|heic|heif`, `application/pdf`, up to 15 MB), stored in
  `DATA_DIR/receipts/`; `GET /api/maintenance/receipts/:name`
- `PUT /api/maintenance/reminders` `{reminders: [{id?, name, everyMiles|null, everyMonths|null, note}]}`
  (replaces the list; history kept by id); `POST /api/maintenance/reminders/:id/done` `{at?, odometer?}`
- `PUT /api/maintenance/notify` `{service}`: HA `notify.<service>`, one message a
  day per due item, 9:00-21:00
- `GET /api/tpms/history?days=30` → `{fl|fr|rl|rr: [{t, psi, tempF}]}`. Sampled from
  `State.tpms` every minute, stored on a 0.5 psi change or every 10 min, kept 400 days.
- Defaults: tire rotation, cabin air filter, wiper blades, 12V battery check,
  brake fluid, with **no intervals** ("Set from the owner's manual"). States:
  `due | soon | ok | unset | needs-odometer`; soon = within max(300 mi, 10%) or 30 days.
- Layout widget types: `maintenance`, `mileage`.

### Updates

- `GET /api/update` → `UpdateStatus` `{phase, message, repo, channel, installed, latest, releases, checkedAt, job, canInstall, installNote, canRollback}`;
  phases `idle, checking, up-to-date, available, requested, downloading, building, restarting, verifying, done, rolled-back, failed`
- `POST /api/update/check`; `POST /api/update/install` `{tag?}`; `POST /api/update/rollback`;
  `PUT /api/update/config` `{repo, channel: 'stable'|'main', auto?: {enabled?, when?: 'parked'|'home-wifi'}}`; `GET /api/update/version` → the
  installed `{version, tag, sha, channel, installedAt}` (from `release.json`)
- GitHub is checked every 12 hours once a repo is set (any link but offline).
  Automatic updates (`auto.enabled`, off by default) install an available
  version by themselves only when not driving (ignition off, no trip open,
  under 2 mph) and, with `when: 'home-wifi'`, on home Wi-Fi. A version an
  automatic install already tried is not retried by itself. `UpdateStatus.auto`
  = `{enabled, when, waiting, nextCheckAt, skipped}` (`waiting`: why an
  available update hasn't installed yet).
- Stable: GitHub releases (non-draft, non-prerelease; the asset
  `slate-cockpit-<tag>.tar.gz` from `.github/workflows/release.yml` is preferred),
  else version tags. Main: the latest commit; changelog = commits since the installed sha.
- Brain to updater: `DATA_DIR/update/request.json` (`Job`) → `slate-updater.path`
  runs `update.sh` → `DATA_DIR/update/status.json` `{id, phase, message, at, tag, previous}`.
  Checked every 6 h when online; never installs by itself.

### Backups

- `GET /api/backup` → `{config, status: BackupStatus, targetLabel, local}`;
  `PUT /api/backup/config` `{enabled, hour, keep, keepLocal, includeSecrets, target}`;
  target `{kind:'none'} | {kind:'path', path} | {kind:'rsync', dest:'user@host:/dir', sshKey, port} | {kind:'http', url, auth}`
- `POST /api/backup/run`; `GET /api/backup/list` → `{local, target: {names|null, error}}`;
  `GET /api/backup/download/:name`; `POST /api/backup/restore` `{name, from: 'local'|'target'}`;
  `POST /api/backup/restore-upload` (body = the .tar.gz)
- File: `slate-backup-<truck>-YYYYMMDD-HHMMSS.tar.gz` with `manifest.json`
  (sha256 per file), `cockpit.db` (VACUUM INTO), `settings.json` and `ops.json`
  (keys, tokens, passwords and the admin hash stripped unless `includeSecrets`),
  the clips index JSON (`clips.json`, `clips-index.json`, `clips/*.json`; never
  video), `receipts/`.
- Nightly after `hour`, only on home Wi-Fi (`network.link === 'home'`), not
  during a trip, once a day; a failure retries after an hour. Retention: the newest
  `keep` on the target (path, rsync; an HTTP server keeps its own), `keepLocal` on the truck.
- Restore is staged in `DATA_DIR/restore-pending/` and applied at the next
  start, before the DB opens; the replaced files go to
  `backups/before-restore-<stamp>/`. Secrets missing from the backup are kept
  from the truck's current settings; the current password hash and backup
  target are kept. Under systemd the brain restarts itself.

### MQTT / Home Assistant

- `slate/brain/ops` (retained) `OpsSummary`: `{maintenanceDue, maintenanceSoon, dueItems, lastBackupAt, lastBackupOk, backupTarget, updateAvailable, version, odometerEst}`
- Discovery (the same "Slate Truck" device, when `homeAssistant.bridge`): sensors
  `maintenance_due` (count; items as attributes), `last_backup` (timestamp),
  `update_available`, `odometer_est` (mi); binary_sensor `backup_problem`.

## Payoff goal: "pay off the truck with gas savings"

Truck-level, permanent. Code: `brain/src/goal/` (`ledger.ts` pure math,
`service.ts` SQLite, `routes.ts`), UI `ui/src/components/goal.tsx`.

### Simulated data (`simulated` on trips and charge sessions)

- `Trip.simulated: boolean` and `ChargeSession.simulated: boolean` (SQLite
  `trips.simulated`, `charge_sessions.simulated`, INTEGER 0/1). A brain
  running `SIM=1` sets it on every truck trip it starts and every session it
  logs, except `source: 'receipt'` (a receipt email is real money). Phone
  trips (`source: 'phone'`) are never marked; they never count anyway.
- Rows from before the column existed carry no mark and cannot be told apart
  after the fact. When the column is added on a brain started with `SIM=1`,
  every existing truck trip and every non-receipt session is marked simulated
  (that database was fed by the simulator). On a brain not on SIM they stay
  unmarked; the goal still ignores everything before its start date.
- `TripFilter.real` (brain) selects `simulated = 0`.

### Settings

```ts
Settings.payoffGoal: PayoffGoal;    // PUT /api/settings {payoffGoal}
type PayoffGoal = {
  target: number;                   // USD, default 30740.78 (build 29,290.78 + destination 1,450; no taxes/fees)
  startDate: string | null;         // YYYY-MM-DD, delivery / first drive; null = the first real truck trip's local day
  includeHomeCharging: boolean;     // default true; false = home charging counts as free
};
```

### Ledger (SQLite, in `cockpit.db`, so Track D backups carry it)

- `goal_ledger`: one row per local day that has real trips or sessions, on or
  after the start date (`GoalDay`). A day is computed only from its own trips
  (`source` truck, `simulated` 0) and sessions (`simulated` 0): city miles at
  the comparison vehicle's city mpg, highway at highway mpg, unsplit at
  combined (`tripSplit`), x that day's gas price for the vehicle's grade
  (stored HA price for the day → `day`; else the nearest stored day →
  `nearest`; else, or with `gas.source: 'manual'`, `gas.manualPrice` →
  `manual`). `net = gasCost - chargeCost`; sessions with no cost count $0 and
  are counted in `chargeCostUnknown`. The vehicle is `Settings.compareVehicle`
  (truck-level, not a driver's override) and is stored per day.
- **Freezing:** the first refresh after a month ends computes its days one
  last time and marks them `frozen` (`goal_months` records it). Nothing
  rewrites a frozen day afterwards (a new comparison vehicle, gas source, or a
  charge entered late) except `POST /api/goal/recalc`. The running month is
  recomputed on each refresh. Moving the start date earlier fills the new
  days of a closed month once, frozen.
- Refreshed on start, hourly, 1.5 s after a trip ends, a charge session
  changes, gas prices arrive or the goal/vehicle/gas settings change, and by
  `GET /api/goal` when the last refresh is over 30 s old.
- `goal_adjustments`: one-off amounts (rebates, incentives; negative for a
  cost). Every adjustment counts, whatever its date.

```ts
type GoalDay = {
  day: string; trips: number;
  miles: number; cityMiles: number; highwayMiles: number; otherMiles: number;
  gallons: number; gasPrice: number; priceSource: 'day' | 'nearest' | 'manual';
  vehicle: CompareVehicle;          // as it was when the day was computed
  gasCost: number;
  chargeSessions: number; chargeCost: number; chargeCostUnknown: number;
  homeChargeExcluded: number;       // home $ left out when includeHomeCharging is off
  net: number;
  possibleDemandCharge: number | null;  // see "Charging on-peak": shown, never subtracted
  frozen: boolean; computedAt: string;
};
type GoalAdjustment = { id: number; day: string; label: string; amount: number; createdAt: string };
type GoalMonth = { month: string; net: number; gasCost: number; chargeCost: number; miles: number; days: number; possibleDemandCharge: number | null };
type GoalSummary = {
  target: number; startDate: string | null; startSource: 'setting' | 'first-trip' | null;
  includeHomeCharging: boolean;
  saved: number;                    // ledger net since startDate (to today) + every adjustment
  ledgerSaved: number; adjustmentsTotal: number;
  pct: number;                      // saved / target x 100, one decimal, not capped
  remaining: number;
  miles: number; gasCost: number; chargeCost: number;
  thisMonth: number;                // ledger net, this calendar month
  avgPerMonth: number | null;       // ledger net over the last 90 days (or since start) / days x 30.44
  daysOfData: number;               // startDate .. today inclusive
  projection: { state: 'no-data' | 'not-enough-data' | 'not-saving' | 'projected' | 'paid-off'; date: string | null };
                                    // projected: today + remaining / (90-day net per day), from 30 days of data
  months: GoalMonth[];
  vehicle: string;
  excluded: { simulatedTrips: number; phoneTrips: number; simulatedSessions: number };  // since startDate (all, without one)
  message: string | null;           // e.g. no real truck trips yet
  computedAt: string | null;
};
```

### HTTP (behind the Track D login from other devices, like every `/api` route)

- `GET  /api/goal` → `GoalSummary`
- `GET  /api/goal/ledger?from=&to=` (YYYY-MM-DD, inclusive) → `GoalDay[]`,
  oldest first; `GET /api/goal/ledger.csv?from=&to=` the same as CSV
- `POST /api/goal/recalc` `{confirm: true}` → `GoalSummary`: forget every day
  (frozen too) and compute it all again with today's settings; without
  `confirm: true` → 400
- `GET /api/goal/adjustments` → `GoalAdjustment[]`; `POST` `{day, label, amount}`
  → 201; `PUT /api/goal/adjustments/:id` (partial); `DELETE` → 204
- Settings: `PUT /api/settings {payoffGoal}`

### Screens, MQTT, WOPR

- Charge view widget `payoffGoal` (default Charge view: `costSessions` col 7
  row 2 w3, `payoffGoal` col 10 row 2 w3; an untouched old default view is
  moved to it on load, a customised one is left alone). Drive screen context
  card `goal`: parked only, after since-charge, tilt, media and trip, so it
  never pushes one of those out. `/settings` → Charging & costs → Truck payoff goal.
- MQTT `slate/brain/goal` (retained) `{saved, target, pct, thisMonth,
  projectedPayoff, projectionState}`; discovery sensors `payoff_saved` (USD),
  `payoff_pct` (%), `payoff_date` (date).
- WOPR truck block: `  Truck payoff: $X of $Y (Z%)` once there is a start date.

## Charging on-peak

Alert when the truck charges at home inside an expensive TOU period. The
point is the demand charge: Jeff's APS plan bills the single highest on-peak
hour of the month at `demandPerKw`, so one hour at ~7.2 kW is ~$141. Code:
`brain/src/charges/peak.ts` (pure), `Brain.updatePeak`, the Track C alert engine.

### Settings

- `TouPeriod.alertOnCharging: boolean`. Missing → on for a period priced above
  `flatPerKwh` (or, with no flat rate, above the cheapest period).
- `homeRate.demandPerKw: number | null` ($/kW, the plan's on-peak demand charge).
- `homeAssistant.homeChargerPowerEntity?: string`: the wall charger's power
  sensor (W or kW, by `unit_of_measurement`), read every 30 s over HA REST
  (or from mqtt_statestream when REST isn't set up). If its attributes carry
  a status (`status`, `charger_status`) it also tells plugged-in-not-charging.

### Detection (`State.chargePeak: ChargePeak | null`)

```ts
type ChargePeak = {
  charging: boolean | null;
  source: 'ha-power' | 'can' | 'session' | null;
  powerKw: number | null; atHome: boolean;
  period: { name: string; start: string; end: string } | null;
  onPeak: boolean;                  // charging inside an alert period
  estimate: number | null;          // USD: powerKw x demandPerKw, whole dollars
  title: string | null; message: string | null;
  headsUp: string | null; headsUpTitle: string | null;
};
```

Charging is, first available: the power sensor over 500 W (`ha-power`); the
truck's own signal at home (`Brain.setCanCharging`, a hook for CAN); a home
session detected in the last 10 minutes (`session`). Heads-up: at home,
plugged in (Track C `chargerPlugEntity`, or the power sensor's status) and
not charging, in the 30 minutes before an alert period on a day it applies.

### Out

- Alerts (Track C): kinds `chargingPeak` ("Charging during on-peak": hold
  30 s, repeats every 15 min while it lasts) and `peakSoon` (the heads-up,
  cooldown 60 min), each with its toggle on /settings → Cameras & remote →
  Alerts. Wording: "Truck is charging at home during APS on-peak (4–7pm).
  One hour at 7.2 kW can add about $141 in demand charges this month. Stop
  or delay charging until 7pm." (the $ sentence only when power and
  `demandPerKw` are known).
- Red banner on every cockpit view (amber for the heads-up).
- HA: binary_sensor `charging_on_peak` (device_class problem) from the state topic.
- WOPR truck block: `  Charging alert: <message or heads-up>`.
- `GET /api/charges` adds `onPeak: string | null` (the alert period a home
  session overlapped); the session list shows an "on-peak" tag and a note.
- The goal ledger uses the session's real cost and records the possible
  demand charge (session kW, its `maxKw` or kWh / hours, x `demandPerKw`; a
  day keeps its largest, a month its largest) as
  `GoalDay.possibleDemandCharge`, never subtracting it.

## Road trips

Plan charging stops for a long drive, follow the trip, and coach each charge.
Code: `brain/src/roadtrip/` (pure: `curve.ts`, `planner.ts`, `coach.ts`, `route.ts`;
with IO: `samples.ts`, `service.ts`, `routes.ts`), UI `ui/src/components/roadtrip.tsx`
(the **Road trip** screen, added once to saved layouts after Charge).

### Charging curve (`charge_samples`, `GET /api/charging/curve`)

- Slate hasn't published a curve. It starts generic (`genericCurve()`: 120 kW
  peak, flat to ~50%, tapering past 80%) and is learned in 5% bins from this
  truck's own DC charging: while charging, every 1+ point rise in charge level
  becomes a sample `{socFrom, socTo, kw, stationKw, lat, lon, sessionId}`.
- A bin is learned after 3 samples (75th percentile kW). Samples from a stall
  slower than the truck (the stall was the limit) and Level 2 are ignored.
  Unlearned bins follow the learned ones' scale.
- Real brains learn from real samples only; a SIM brain learns from its own
  (the simulated truck's true curve peaks at 110 kW, so the demo shows learning).
- **Site performance:** a site's median seen/expected kW over 3+ samples is
  joined onto every charger as `Charger.performance`; below 0.7 the charger
  list says "Slow last time" and scores it 15 lower; the planner adds minutes.

### Planning (`POST /api/roadtrip/plan`)

Body `{to: {lat, lon, name?}, from?: {lat, lon, name?}, startSoc?}`; `from`
defaults to GPS, `startSoc` to the current charge level. Returns `TripPlan`.

- **Route:** OSRM (`ROUTER_URL`, default OSRM's public demo server, light use),
  elevation from Open-Meteo (at most ~300 points per route, paced). With no
  router, a straight line plus 25%, with a warning; with no elevation, climbs
  aren't counted, with a warning.
- **Chargers:** the finder's AFDC/Open Charge Map cache, searched every 25 mi
  along the route; DC only (≥ 40 kW and the driver's `minKw`), at most 12 mi
  (and the driver's `maxDetourMi`) off it, scored with the driver's preferences.
- **Energy:** the learned highway efficiency, adjusted for average speed (drag),
  heat/cold (A/C, cabin heat), climbs (1,900 kg, 90% drivetrain) and 60% regen
  on descents.
- **Search:** each charger is a node; the truck may leave it at any level on a
  5% grid up to 90%, adding at least 10 points. A forward pass keeps the
  quickest way to leave each charger at each level: driving + detour + charging
  (the curve, the stall's kW, its past performance) + 10 min per stop + a small
  penalty for a poorly scored, slow, full or tiny (≤2 stalls) site. Every
  arrival stays at or above the driver's `arriveMinSoc`, the destination too.
- **Backups:** for each stop, the first stop of the best plan that skips it,
  from the state before it, with the extra minutes. `null` means nothing else is
  in reach (the screen says to charge a little extra at the stop before).
- **Cost:** kWh bought = pack gain × 1.08 (charging losses), priced at what you
  paid there before, else the listed per-kWh price, else a typical $0.48/kWh
  (counted in `typicalPriceStops`). `TripPlan.gas` is the same trip in the
  driver's gas comparison vehicle at today's gas price.
- Infeasible plans say where the gap is ("No charger in reach between mile X
  and mile Y").

### Stops along the way (`via`)

- `POST /api/roadtrip/plan` takes `via: [{lat, lon, name, placeId?, kind?, stayMin?, chargeKw?}]`
  (up to 8, in order). `stayMin` defaults by kind: restaurant 60, friend 180,
  hotel and home 600, work 60, other 30.
- The route is fetched leg by leg (OSRM) and joined; each leg is planned on its
  own (`planLegs()`), arriving at every stop above the driver's minimum. At a
  stop the truck waits its stay; `chargeKw` (a wall outlet ~1.4, Level 2 ~7.2)
  adds `kW × 0.9 × hours` to the pack, up to 90%. A charger within 2 miles of a
  stop can be used on the leg that starts there.
- `TripPlan.via` lists each stop with `routeMi`, `arriveAt`/`departAt`,
  `arriveSoc`/`departSoc`; the screen shows them between the charging stops.
- **Saved places** (`/api/places`) carry `kind` (home, restaurant, friend,
  hotel, work, other), `chargeKw` and `note`; they are the Road trip screen's
  destinations and stops, and a searched address can be saved from there.

### Following the trip

`POST /api/roadtrip/start {planId}`, `/stop`, `/discard`, `/replan`;
`GET /api/roadtrip` → `RoadTripView {draft, active, progress, coach, alerts,
destinations, presets, curve}`; `State.roadTrip: RoadTripBrief` drives the
top banner on every screen. Every 30 s (10 s on SIM) the brain:

- places the truck on the route; progress only counts on the route (≤ 3 mi
  off) and reachable by driving (never a jump of more than 25 mi ahead), so a
  truck parked elsewhere never "passes" stops or "arrives";
- **replans** when the projected arrival at the next stop falls 4+ points below
  plan (at most every 5 min);
- **live check:** within ~25 min of the next stop, asks Google Places (billed;
  each spot at most every 5 min, needs the key) for free stalls there. All full
  → that stop is avoided and the trip replanned from here, with an alert
  ("Quartzsite is full (0 of 8). Going to Blythe instead, +6 min."). Nothing else
  in reach → it stays, with a "full, expect a wait" alert.

### Coach (`RoadTripView.coach`, `State.roadTrip.coach`)

While charging: the planned departure level for the stop, minutes left from the
curve, **GO** once there (and what each further 10 minutes adds), and **slow
stall** when the last two readings are under 60% of what the truck should take
below 78% (above that the taper is the pack's).

### Demo

Destinations Flagstaff, Tucson and Los Angeles, and the preset **Factory pickup:
Warsaw, IN to home** (from 80%). The demo answers OSRM itself along invented
highway polylines (I-17, I-10, and I-70/I-44/I-40/I-17 from Warsaw) with
invented chargers on them; elevation is the real Open-Meteo.

## Assistant (the voice button)

Code: `brain/src/assistant/` (`types.ts` pure, `providers.ts`, `service.ts`),
settings `ui/src/settings/AssistantSection.tsx`, voice loop `ui/src/wopr/voice.ts`.
Stored in `media.json` as `MediaSettings.assistant`; keys write-only (masked back).

- **Providers:** `wopr` (default; WOPR's `/api/WOPR` with its private context),
  `claude` (Anthropic SDK, streamed, `output_config.effort: low`, server-side
  fallbacks `"default"`; default model `claude-opus-5-5`), `openai` (any
  OpenAI-compatible `/chat/completions`, streamed: presets ChatGPT, Gemini, Groq,
  OpenRouter, Ollama, LM Studio, other; the model is typed), `homeassistant`
  (HA Assist `/api/conversation/process`, its conversation id kept 5 minutes).
- **Context:** non-WOPR assistants get the truck block with generic
  instructions as the system prompt, never WOPR's private context. HA Assist
  gets only the question (its agent has its own prompt).
- **Offline:** a service on the home network (`localhost`, `192.168.*`,
  `*.local`…) isn't blocked when the truck is offline; cloud ones are.
- **Voice:** speech in from WOPR or an OpenAI-compatible `/audio/transcriptions`;
  speech out from WOPR, an OpenAI-compatible `/audio/speech`, or the tablet
  (`/api/assistant/tts` answers 501 `{tablet: true}` and the page speaks with
  `speechSynthesis`).
- **Routes:** `GET /api/assistant/status` `{provider, name, configured, online,
  tabletVoice, message}`, `POST /api/assistant/test`, `POST /api/assistant/chat`
  (NDJSON, same events as WOPR's), `/stt`, `/tts`. The `/api/wopr/chat|stt|tts`
  paths are aliases. WOPR's calendar, gate codes and mailbox stay on
  `/api/wopr/*` whichever assistant is picked.
- Siri and Alexa can't be providers: neither offers an API for asking from
  another app. Siri works through CarPlay; Alexa through its Android app.

## Traffic (511 cameras and incidents, enforcement cameras)

Code: `brain/src/traffic/` (`states.ts`, `feed.ts`, `ahead.ts`, `enforcement.ts`
pure; `service.ts`), UI `ui/src/components/traffic.tsx` (the **Traffic** screen,
added once to saved layouts after Road trip), settings `ui/src/settings/TrafficSection.tsx`.

- **Source:** each state's 511 developer API, fetched by the truck itself (not
  through the home network): `<base>/api/v2/get/cameras` and `/api/v2/get/event`,
  `key` + `format=json`, ten calls a minute. Keys per state in
  `Settings.keys.traffic511` (`{az: "..."}`), masked like every key.
  Checked against the endpoint pages: Arizona (AZ511), Wisconsin (511WI).
  Same platform, endpoints not yet confirmed: Utah, Nevada, Idaho, Georgia,
  Louisiana, Alaska, Ontario (a mismatch shows as that state's error).
- **Which states:** the ones the truck is in, plus those the active trip's route
  crosses in the next 250 miles. Cameras refetch every 12 h (kept in SQLite),
  events every 5 min driving or on a trip, 30 min parked; at least 8 s between
  calls to one site.
- **Ahead:** along the trip route (≤ 0.6 mi off for cameras, 1 mi for events)
  when there is one; else in a 30° cone the way the truck is heading; parked,
  anything within 8–10 mi. Future roadwork is left out.
- **Enforcement cameras:** speed and red-light camera locations from
  OpenStreetMap (Overpass, `highway=speed_camera`, `enforcement`), one query per
  ~17-mile cell, kept a week. Police don't publish live cameras.
- **Banner (`State.traffic`):** an enforcement camera within 0.8 mi while moving,
  else a crash or closure within 25 mi ahead.
- **While driving** (the drive lockout, over `lockoutMph`): camera pictures pause and show
  their place and distance only, like video; incidents and the banner stay.
- **Routes:** `GET /api/traffic` → `TrafficView`, `POST /api/traffic/refresh`.
- **Demo:** an invented AZ511 feed along the simulated drive (placeholder
  pictures from `/api/traffic/demo-cam/<id>`, or `DEMO_FOOTAGE/traffic-<id>.jpg`).

## Contacts (address books, synced)

Code: `brain/src/contacts/` (`vcard.ts`, `types.ts` pure; `sources.ts`, `service.ts`,
`routes.ts`), settings `ui/src/settings/ContactsSection.tsx`.

- **Sources:** Outlook / Microsoft 365 (Graph `/me/contacts`, `Contacts.Read`,
  signed in with the device-code flow: the user's own app registration, public
  client), Google (People API `contacts.readonly`, the user's own "Desktop app"
  OAuth client, redirect `http://127.0.0.1:<port>/api/contacts/google/callback`
  pasted back like Spotify's), and CardDAV (iCloud `https://contacts.icloud.com`,
  Fastmail, Nextcloud…: discovery from the server address via
  `current-user-principal` → `addressbook-home-set` → address books, then a
  `REPORT addressbook-query` for every vCard). Demo: an invented address book.
- **Sync, not import:** every 30 minutes and on demand, each address book's list
  replaces that source's contacts (new in, changed updated, removed gone).
  Addresses are looked up on the map (OpenStreetMap, rate-limited) only when they
  change. Secrets (OAuth tokens, CardDAV passwords) in `DATA_DIR/contacts.json`
  (0600), never sent to the UI; contacts in SQLite `contacts`.
- **Uses:** located contacts are Road trip destinations and stops (`contactId`,
  phones); the planner's search finds your places and contacts before the map.
  **Call:** "Call here" is a `tel:` link on the tablet; "Ring my phone"
  (`POST /api/contacts/:id/call {number}`) sends a phone notification (Settings ›
  Alerts) whose tap opens the dialer.
- **Routes:** `GET /api/contacts?q=`, `GET /api/contacts/status`,
  `PUT /api/contacts/settings`, `POST /api/contacts/sync`,
  `DELETE /api/contacts/source/:id`, `POST /api/contacts/outlook/start`,
  `POST /api/contacts/google/start|finish`, `GET /api/contacts/google/callback`,
  `POST /api/contacts/carddav`, `POST /api/contacts/:id/call`.

## Airport pickup

Code: `brain/src/pickup/` (`flight.ts` pure), UI `ui/src/components/pickup.tsx`
(Road trip screen's side column), banner from `State.pickup`.

- Flight numbers in any common form (`AA 1234`, `AAL1234`, `Southwest 2510`),
  IATA → ICAO callsign table. Position: adsb.fi open data
  `/api/v2/callsign/<CALLSIGN>` (keyless, 1 request/s, personal use); route:
  adsbdb `/v0/callsign/<CALLSIGN>`. ADS-B gives position, not the gate, official
  arrival or carousel.
- Phases: waiting, en-route, approach (< 40 mi), taxiing (on the ground within 5
  mi of the destination), at-gate (stopped 90 s). Landing estimate = distance /
  (85% of ground speed) + approach allowance; out front = touchdown + 10 min taxi +
  15 min deplane (+25 with checked bags); leave = out front − OSRM drive time − 5.
- Polled every 30 s only while a pickup is set. Phone alerts once each: leave
  now, landed, at the gate (tap opens Waze to the airport). A flight number in
  WOPR's next calendar event is offered as a suggestion.
- Routes: `GET/POST/DELETE /api/pickup`. Demo: any flight is a simulated arrival
  from Dallas landing at PHX 25 minutes after it's first asked about.
- `PickupState.plane` `{lat, lon, altFt, gsKt, track, hex} | null` (fresh ADS-B
  only): the card shows altitude and speed. `PickupView.sim` (the test panel's
  flight), `officialOn` (a FlightAware key is set).
- Setting a flight (the form and the calendar suggestion) waits while driving
  (`DrivingLock`); a pickup already on keeps its card and banner.
- Optional gate, terminal, bag carousel, delay, cancelled/diverted:
  `Settings.keys.flightAware` (FlightAware AeroAPI, paid per query; off without
  a key). `GET https://aeroapi.flightaware.com/aeroapi/flights/<CALLSIGN>` with
  the key in `x-apikey` only, once at the start and then every 5 minutes while a
  pickup is on; the leg arriving nearest now is used. `PickupState.official`
  `{status, gate, terminal, baggage, delayMin, estimatedOn, estimatedIn,
  cancelled, diverted, checkedAt} | null`. A 401/403 says the key was refused.
  Field names from AeroAPI v4's documented schema, not yet checked live. The key
  is never logged or returned (masked like every other key; dropped from
  backups without secrets).
- SIM test panel: `POST /api/sim/flight {flight?, who?}` follows the demo's
  simulated arrival (DFW → PHX, lands in ~25 min) with no flight-tracking
  calls, so the card, the leave-by time and the alerts can be run at a desk.
- God's Eye View: with the globe feed on, `/globe/aircraft.json` carries the
  inbound plane beside the truck (God's Eye's Local ADS-B layer, magenta), under
  its real ICAO hex when adsb.fi gave one (its card can then look up the
  aircraft type), else `f1a7e2` (reserved block). God's Eye merges by hex only
  among its local sources; its public Flights layer doesn't check Local ADS-B,
  so **turn the Flights layer off, or you'll see the plane twice**.

## Hazards ahead (weather, wind, fires)

Code: `brain/src/hazards/` (`route.ts` pure, `service.ts`), the Traffic screen's
"Weather and fires ahead" card, the banner via `State.hazard`.

- On a trip: points every 40 miles along the rest of the route, with when the
  truck gets there. Otherwise: the truck's own position. Every 15 minutes.
- NWS `/alerts/active?point=` per point: driving-relevant events only (dust storm,
  severe thunderstorm, tornado, flash flood, winter storm, high wind, dense fog,
  red flag, extreme heat). Open-Meteo hourly forecast for the hour the truck is at
  each point (several points per request): thunderstorm codes 95–99, heavy
  rain/snow, gusts ≥ 45 mph, visibility < 1 mile.
- NASA FIRMS (`Settings.keys.firms`, free MAP_KEY): VIIRS S-NPP hotspots from the
  last day in the route's box, grouped into fires within 10 miles of the route
  (CSV read by column name). Fire perimeters (NIFC) aren't used: their service
  address couldn't be confirmed.
- Routes: `GET /api/hazards`, `POST /api/hazards/refresh`.

## Camp mode's sky

`brain/src/sky/sky.ts`, the Parked › Camp tab. ISS passes for the next 24 hours
above 10°, from CelesTrak's orbit (`gp.php?CATNR=25544&FORMAT=TLE`, refreshed
daily) propagated with SGP4 (`satellite.js`); a pass is "visible" when the
station is sunlit and the sun is more than 6° below the truck's horizon. "What's
that plane?": the nearest airborne aircraft from adsb.fi
`/api/v3/lat/<lat>/lon/<lon>/dist/15`, with its listed route from adsbdb (which
can be out of date). `GET /api/sky/passes`, `GET /api/sky/overhead`.

## God's Eye View scenes

`brain/src/globe/scene.ts`. A planned or active road trip
(`GET /api/roadtrip/scene.gevbundle.json`) or any logged trip
(`GET /api/trips/:id/scene.gevbundle.json`, heights from Open-Meteo) as a God's
Eye scene bundle (bundle version 1, scene document version 5): the route and
stops as one GeoJSON data pack (`scene-bundle` source, exact `byteLength` and
`sha256`), an overview shot and a shot at each stop (or a fly-along for a driven
trip). IMPORT it in God's Eye's Scenes panel. Checked against God's Eye's own
`parseSceneShare`.

## Offline maps

The cockpit's maps work with no signal inside areas downloaded in Settings,
Truck, **Offline maps**. Brain code in `brain/src/maps/`, UI in
`ui/src/map/MapView.tsx` (the **Map** view, added after Drive to every
layout), `ui/src/lib/basemap.ts` and `ui/src/settings/MapsSection.tsx`.

- **Source:** Protomaps' daily OpenStreetMap vector build
  (`https://build.protomaps.com/<yyyymmdd>.pmtiles`, newest from
  `build-metadata.protomaps.dev/builds.json`), read with HTTP range requests
  like `pmtiles extract`: directories are walked for the wanted tile IDs, then
  tile bytes are fetched in merged ranges (gaps ≤ 64 KB, ≤ 4 MB a request). Not
  OpenStreetMap's tile server, whose policy forbids bulk downloads.
- **Storage:** `DATA_DIR/maps.db` (its own SQLite file, so `cockpit.db` and its
  backups stay small): `areas` and `tiles(z, x, y, data)`, tiles kept
  gzip-compressed as served. Deleting an area drops only tiles no other area
  covers, then `incremental_vacuum` gives the space back. One download at a
  time; one unfinished at shutdown resumes at the next start, skipping tiles
  already stored. Refused when it wouldn't leave 500 MB free, or over 400,000
  tiles. Zoom 6-15 (Protomaps stops at 15; maps over-zoom past an area's level).
- **Routes:** `GET /api/maps` → `{enabled, areas[], usedBytes, freeBytes,
  maxZoom, maxTiles}`; `PUT /api/maps {enabled}`; `POST /api/maps/estimate
  {bbox | aroundTruckMi}` → `{bbox, tiles: {zoom: count}}`; `POST
  /api/maps/areas {name, bbox: [w, s, e, n] | aroundTruckMi, maxZoom}`; `POST
  /api/maps/areas/:id/download {fresh}` (retry/resume, or `fresh` re-fetches
  everything from the newest build); `DELETE /api/maps/areas/:id`; `GET
  /api/maps/tiles/:z/:x/:y.mvt` (404 when not downloaded).
- `Area = {id, name, bbox, maxZoom, status: queued|downloading|ready|error,
  tilesTotal, tilesDone, bytes, error, build, createdAt, updatedAt}`.
- **Drawing:** the online OpenStreetMap raster stays the base; each ready area
  adds a `protomaps-leaflet` layer limited to its bounds and `maxDataZoom`, so
  outside the areas the online map shows through, and with no signal only the
  areas draw. The trip energy map uses it too.

## Navigation hand-off

Every Navigate button (charge stops, road-trip stops, the airport pickup,
calendar appointments) opens `ui/src/components/NavModal.tsx`; links come from
`ui/src/lib/nav.ts`. Link formats are from each app's own source (manifest
intent-filters and URL parsers); Chrome on Android launches an app only through
a BROWSABLE intent-filter.

| App | Link | On the tablet (Chrome) |
|---|---|---|
| Waze (iPhone, CarPlay; needs signal) | `https://waze.com/ul?ll=…&navigate=yes`, or `?q=` for an address | QR code and link |
| Organic Maps (offline) | `om://route?sll=<truck>&saddr=Truck&dll=<dest>&daddr=<name>&type=vehicle` (all five, in order); `om://map?ll=…&n=…` without a fix; `om://search?query=…&cll=<truck>&map` | `intent://…;scheme=om;package=app.organicmaps;…` |
| CoMaps (offline) | the same under `cm://` (it does not open `om://`) | `intent://…;scheme=cm;` with no package, so the Play (`app.comaps.google`) and F-Droid (`app.comaps.fdroid`) builds both answer; fallback to Play |
| OsmAnd (offline) | `https://osmand.net/map/?start=<truck>&end=<dest>&profile=car` (needs a point) | `intent://osmand.net/map/…;scheme=https;package=net.osmand` (or `net.osmand.plus`) |
| ABRP | no documented destination link | the place to copy, and a link to ABRP |

Per screen (`localStorage`): `slate.nav.apps` (which show; default all),
`slate.nav.app` (`auto` or an app; `auto` is Waze with signal, else the first
offline app shown, from `State.network.link`), `slate.nav.osmand` (package).
Set in Settings, Truck, **Navigation**, which also explains setting up offline maps
inside each app.

## Route planning (local GraphHopper)

Road routes for the road-trip planner and the airport pickup
(`brain/src/roadtrip/route.ts` `fetchRoute`) come from, in order:

1. **A local GraphHopper** (`graphhopperUrl`; set up with `deploy/graphhopper/`):
   `POST /route {points, profile: car, points_encoded: false, elevation}` with
   `elevation` only when `/info` says the graph has it (then climbs need no
   internet; `addElevation` skips Open-Meteo). While a trailer is hitched
   (`modes.activeTrailer`), the request adds `custom_model: {speed: [{if: true,
   limit_to: <towMph in km/h>}]}` and `ch.disable: true` (the graph uses LM).
2. **OSRM**: `ROUTER_URL`, else the public demo when `publicOsrm` is on.
3. **A straight line** plus 25%, labelled `routeSource: 'straight'`.

`routeSource` is `graphhopper | osrm | straight`. Settings, Truck, **Route
planning**: `GET /api/routing` → `{graphhopperUrl, publicOsrm, towMph,
graphhopper: {ok, info: {bbox, profiles, elevation, dataDate, version}} |
{ok: false, error} | null, towing: {trailer, mph} | null, osrm}`; `PUT
/api/routing {graphhopperUrl?, publicOsrm?, towMph? (35-80)}`. Default
`graphhopperUrl` is `GRAPHHOPPER_URL`. Kept in the kv table (`routing`).

## Version line and update size

The cockpit's bottom line (`ui/src/components/VersionBar.tsx`, hidden at speed):
`TA_v<version>[+<sha7>] · updated <installedAt>`, from `GET /api/update`
(re-read every 10 min), plus an **Update available** chip when `phase` is
`available` (or progress while installing). Tapping it shows the running and new
versions, `latest.download`, home-Wi-Fi advice from `State.network.link`, the
first release notes, and a link to Settings, Updates (installing stays there).

`Release.download = {bytes, exact, packagesChanged}`: a release's prebuilt
asset size is exact (GitHub's `assets[].size`); a source install estimates from
the last download (`release.json` `downloadBytes`, written by
`deploy/pi/updater/update.sh`); on `main`, `packagesChanged` is whether
`package-lock.json` differs between the installed and latest commits (GitHub
compare), meaning `npm ci` fetches new packages too.
