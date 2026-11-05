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
