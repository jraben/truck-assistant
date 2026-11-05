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
| `slate/truckbox/sensor/tpms_fl_psi/state` (fl, fr, rl, rr) | psi, float | BLE TPMS, if fitted |
| `slate/truckbox/sensor/tpms_fl_temp/state` (fl, fr, rl, rr) | °F, float | |

Relay names (default, editable in settings): 1 Bed lights, 2 Light bar,
3 Rock lights, 4 Air compressor, 5 Bed fridge, 6 Inverter.

## MQTT: brain (`slate/brain/…`)

| Topic | Payload |
|---|---|
| `slate/brain/status` | `online` / `offline` |
| `slate/brain/state` | the JSON `state` object below, retained, at most 1/s |
| `slate/brain/trip/ended` | a trip summary JSON (see `Trip`) |
| `homeassistant/…/config` | HA discovery for: SoC, range, location (device_tracker), speed, charging, trip distance, now playing (title; artist/album/source as attributes), current place (stop name, "Driving" or "Unnamed stop"; since/stopId as attributes), driver (name) |

## HTTP + WebSocket (brain, port 8080)

- `GET  /ws` WebSocket. Server sends `{"type":"state","data":State}` on connect
  and on every change (at most 10/s). Client sends
  `{"type":"relay","id":"relay_1","on":true}` or
  `{"type":"soc","value":72}` (manual charge level), or
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
  active driver's `charging` prefs)
- `GET  /api/drivers` → `Driver[]`; `POST /api/drivers` `{name, initials?, color?,
  tracker?}` → `Driver` (theme/layout/charging start from the defaults);
  `PUT /api/drivers/:id` (partial merge like settings; `layout` replaced whole,
  null resets); `DELETE /api/drivers/:id` (not the Guest, not the last named
  driver; their trips keep the old `driverId`)
- `POST /api/driver` `{id}` → `State['driver']`: pick the active driver. A pick
  while a trip is open re-attributes that trip (and its open stop) to the new
  driver: a correction, not a switch. The brain itself never changes the driver
  mid-trip. `POST /api/driver/dismiss` clears `driverSuggestion`.
- `GET  /api/trips?limit=&driver=&source=` → `Trip[]`; `GET /api/trips/:id` →
  `Trip` + `points`
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
  driverSuggestion: { id: string; name: string; reason: string } | null;  // set on ignition until picked or dismissed
  place: { stopId: number; name: string | null; since: string } | null;  // the stop the truck is at; null while driving
  network: NetworkStatus;           // how the cockpit is online (docs/connectivity.md)
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
  keys: { afdc?: string; openChargeMap?: string; placesFeed?: string };  // entered in the settings page, never in files; placesFeed = "user:password" (Basic auth)
  homeAssistant: {
    bridge: boolean;                // publish MQTT discovery
    homeChargerEnergyEntity?: string;  // HA sensor with the wall charger's session kWh
    url: string | null;             // e.g. http://homeassistant.local:8123 (LAN or Tailscale)
    token?: string;                 // long-lived access token; masked like keys, never logged
  };
  homeRate: {                       // home electricity, for pricing home sessions
    flatPerKwh: number | null;      // used when no TOU periods are set
    tou: { name: string; days: number[]; start: string; end: string; perKwh: number }[];  // e.g. on-peak weekdays 16:00-19:00
    fixedPerSession: number;        // default 0
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
  id: string; source: 'afdc' | 'ocm';
  name: string; network: string | null;
  lat: number; lon: number; distanceMi: number;
  maxKw: number | null; connectors: string[];
  amenities: string[]; price: string | null;
  score: number; reasons: string[];   // why it ranked where it did, shown in the UI
};

type Trip = {
  id: number; startedAt: string; endedAt: string | null;
  miles: number; durationS: number;
  startSoc: number | null; endSoc: number | null; kwhEst: number | null;   // always null for phone trips
  start: { lat: number; lon: number }; end: { lat: number; lon: number } | null;
  driverId: string | null;          // null = before drivers existed
  source: 'truck' | 'phone';        // phone = replayed from HA history: miles are straight lines between sparse points
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
// toolbox-red, synthwave, mint-emerald, tar-pit, wopr, clean-slate (brain/src/themes.ts).
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
  data so everything runs on a desk.

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
  `PUT /api/update/config` `{repo, channel: 'stable'|'main'}`; `GET /api/update/version` → the
  installed `{version, tag, sha, channel, installedAt}` (from `release.json`)
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
