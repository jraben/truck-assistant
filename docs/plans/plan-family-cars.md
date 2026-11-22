# Family cars and the fault-code reader (plan)

Status: plan, 2026-11-22. Nothing built yet. Feeds RIB-445/446/478 (the tracker
parts and SIMs) and borrows ideas from GlassDash (an iPad "car display" with a
Bluetooth OBD adapter).

## Goal

1. **The three other cars** report where they are, their fuel, 12V battery,
   coolant and fault codes over LTE, and Truck Assistant shows them on a
   **Family cars** page, with alerts and maintenance by real miles.
2. **A fault-code reader** in TA built and proven on those cars, ready for the
   Slate once its OBD/CAN access is known (`docs/ev-features.md`).

Not in scope: Road Vision-style camera detection (a separate project, see the end).

## What GlassDash has, and what we take

| GlassDash | Take for TA |
|---|---|
| Engine data from a Bluetooth OBD adapter: RPM, coolant, battery, **fault codes** | Yes: the family cars now; the Slate when its access is known |
| Works with GPS alone, adapter optional | Already: TA runs on the tablet's GPS |
| 3D car, maps, music, analog gauges | Already in TA |
| "Road Vision" (cars, people, lights from a phone camera) | Later, on TA's own cameras |
| Dashcam to Photos | Already: TA's dashcam loop |

## Hardware, per car (already ordered)

| Part | Job |
|---|---|
| **Vgate vLinker MC+** (in the OBD port) | Talks to the car (ELM327 commands) over **Bluetooth LE**. Sleeps by itself when the car is off. |
| **LILYGO T-SIM7670G-S3** (ESP32-S3 + LTE Cat-1 + GPS) | Reads the vLinker over BLE, has its own GPS, sends over LTE |
| SIM (RIB-446) | LTE data |
| **12V→5V buck** from OBD pin 16 (always-on 12V), or a USB socket that is | Powers the LILYGO. The board's LiPo connector can carry it through short outages. |

The ESP32-S3 has BLE only, no Bluetooth Classic. The vLinker MC+ supports BLE
(that's how iPhone apps use it), so they pair. Check the BLE service on the
first car (commonly `FFF0` with notify `FFF1` / write `FFF2`, or `18F0`).

## How the data flows

```
car ─OBD─ vLinker ─BLE─ LILYGO ─LTE─▶ https://ta.jeffraben.com/api/cars/report ─▶ TA (NAS)
                          GPS                                     │
                                                                  ├─▶ Family cars page, alerts
                                                                  └─▶ Home Assistant (TA's HA link)
```

**One HTTPS endpoint on the NAS copy of TA**, not MQTT. The cars are on cell
data, the NAS is already public at `ta.jeffraben.com` with a real certificate,
and the ESP32 can't join Tailscale. Each car gets its own token (Settings ›
Family cars), sent as `Authorization: Bearer …`; a stolen tracker can be cut
off alone. TA passes the cars to Home Assistant as device trackers and sensors,
so HA automations work too.

## Firmware (LILYGO): what it reads and when

PlatformIO/Arduino, not ESPHome (ESPHome has no ELM327-over-BLE client).

**Driving** (the vLinker is awake and RPM > 0, or the battery is above 13.2 V):
every 10 s, GPS plus fast PIDs; every 60 s, the slow ones; one report every 30 s
over LTE (batched).

| Read | Command | Notes |
|---|---|---|
| Battery | `AT RV` | The adapter's own reading of pin 16; works with the car off |
| RPM, speed | `010C`, `010D` | |
| Coolant | `0105` | Alert above ~110 °C |
| Fuel level | `012F` | % of tank, most cars since ~2008 |
| Control-module voltage | `0142` | |
| Check-engine light + code count | `0101` | |
| Stored and pending codes | `03`, `07` | On start, then every 10 min, and when `0101` changes |
| Distance since codes cleared | `0131` | |
| **Odometer** | `01A6` | **Newer cars only** (about 2019+). Otherwise miles come from GPS, set once from the dash. |

**Parked:** report once, then deep sleep. Wake every 30 min, read `AT RV` and
GPS, report, sleep. That's roughly 2-5 mA average with the modem off between
wakes, small against a car battery. Wake at once on a big voltage rise
(the car started) through the ADC.

**Report** (`POST /api/cars/report`, JSON):
`{ car, at, lat, lon, speedMph, heading, ignition, batteryV, coolantC, fuelPct, rpm, odometerMi, mil, dtcs: ["P0420"], pendingDtcs: [], distSinceClearMi }`.
Missing values are left out. Reports queue on the board while there's no signal.

## Truck Assistant side

- **`brain/src/cars/`**: the report endpoint (token per car, rate-limited), a
  store (latest state + trips, reusing TripStore with `source: 'car:<id>'`), and
  the HA bridge.
- **Fault codes:** an offline table of the generic SAE J2012 codes (P0xxx,
  P2xxx, C/B/U0xxx) with plain-English meanings. Maker-specific codes (P1xxx)
  show as "maker-specific" plus a search link. The same reader serves the Slate later.
- **Family cars page** (a view on the rail, or under Home):
  - each car on the map; its fuel, battery, last seen, and driving / parked;
  - a check-engine badge with the code and what it means;
  - trips and miles per car (the Trips view gains a car filter).
- **Alerts** (TA's existing alerts and notifications):
  - check-engine light on, or a new code, with its meaning;
  - battery below 12.2 V parked (warning) and 11.9 V (won't start soon);
  - coolant high while driving;
  - a car not reporting for 24 h (tracker unplugged or no signal);
  - optional: a car leaving home between set hours (the geofences TA has).
- **Maintenance by real miles:** TA's Maintenance module (miles or months,
  whichever first) gets one log per car, fed by the odometer or GPS miles.
- **Privacy:** these are other people's cars. Each driver should know their
  car reports its location. Settings › Family cars shows who can see what, and
  each car's history can be turned off or deleted.

## Phases

| Phase | What | Needs |
|---|---|---|
| 1 | **Bench:** one vLinker in one car, the LILYGO on USB: BLE pairing, `AT RV`, the PIDs, the codes, printed to serial | Parts (arrived or arriving), one car |
| 2 | **TA endpoint and page:** `/api/cars/report`, tokens, the page, the code table; tested with a simulated car | Code only |
| 3 | **First car on the road:** LTE, power from pin 16, parked sleep; a week of data; check the battery drain | SIM, buck |
| 4 | **Alerts, maintenance, HA**, then cars 2 and 3 | — |
| 5 | **Slate:** the same reader on the truck once its OBD/CAN access is known | Truck data |

## Questions for Jeff

1. **Which three cars** (year, make, model)? That decides the protocol, whether
   the odometer is readable, and the OBD port's always-on 12V.
2. **Who drives them?** For the privacy note, and whose phone gets which alerts.
3. **Where does the tracker live** in each car? (Under the dash next to the
   OBD port is simplest; it needs a sky view for GPS, or an external antenna.)
4. Does the tracker project (RIB-478) already have firmware started somewhere?
   If so, phase 1 builds on it instead of starting over.

## Later: Road Vision on TA's cameras

GlassDash's camera feature, done on the truck: a car in the blind spot while
signalling (the side cameras now pop up on the turn signal), a person behind
while reversing. Object detection on the Pi needs an AI accelerator (Hailo-8L
HAT, ~$70) to run in real time; a separate plan when the Pi and cameras are in.
