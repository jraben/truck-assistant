# Family cars and the fault-code reader (plan)

Status: plan, 2026-11-22 (revised the same day after the tracker handoff).
Nothing built yet. Joins the tracker project (RIB-445/446/478, docs in
`jraben/wopr` `traccar-nas/README.md`, which stays the source of truth for the
boards, the case and the Traccar server) and borrows ideas from GlassDash, an
iPad "car display" with a Bluetooth OBD adapter.

## Goal

1. **The five family vehicles** (2004 F150, 2002 C5, 1998 Jeep, Josie's Hyundai
   Tucson, Austin's 2013 Nissan Rogue) report where
   they are, their 12V battery, engine data and fault codes, and Truck Assistant
   shows them, with the Slate, on a **Family cars** page: alerts, fault codes in
   plain English, and maintenance by real miles.
2. **A fault-code reader** in TA, proven on those vehicles, ready for the Slate
   once its OBD/CAN access is known (`docs/ev-features.md`).

Not in scope: Road Vision-style camera detection (a separate plan, see the end).

## What GlassDash has, and what we take

| GlassDash | Take for TA |
|---|---|
| Engine data from a Bluetooth OBD adapter: RPM, coolant, battery, **fault codes** | Yes: the family vehicles now; the Slate when its access is known |
| Works with GPS alone, adapter optional | Already: TA runs on the tablet's GPS |
| 3D car, maps, music, analog gauges | Already in TA |
| "Road Vision" (cars, people, lights from a phone camera) | Later, on TA's own cameras |
| Dashcam to Photos | Already: TA's dashcam loop |

## The hub is Traccar (already running)

All six vehicles land in the **Traccar server on the NAS** (`~/wopr-traccar`,
web/API `http://192.168.1.219:3952`, device port **5056**, OsmAnd protocol):

```
F150 / C5 / Jeep / Tucson / Rogue:
                   OBD ─ vLinker MC+ ─BLE─ LILYGO T-SIM7670G-S3 ─LTE─┐
                                         (own GPS)                    │ OsmAnd HTTP(S)
Slate:             Truck Assistant (brain/src/traccar.ts) ─hotspot────┤ (5056 only, public)
                                                                      ▼
                                                     Traccar (NAS) ──▶ Home Assistant (Traccar Server integration)
                                                          │
                                                          └──REST API (LAN, read-only user)──▶ TA: Family cars page, alerts
```

- The boards and TA post OsmAnd requests; **every extra query field becomes a
  Traccar position attribute** (`batt`, `coolant`, `mil`, `dtcs`…), which HA
  shows and TA reads.
- **TA reads Traccar's REST API** (`/api/devices`, `/api/positions`,
  `/api/reports/trips`, `/api/events`) on the LAN with a read-only Traccar user,
  so there's one store, not two. TA on the NAS sits on the same host.
- HA keeps its own view through the Traccar Server integration (the Car view,
  `/mobile-dash/car`, in ha-config).

### Exposing 5056 safely

OsmAnd has **no authentication**: anyone who can reach 5056 and knows a device
id can post a fake position. So:
- **Device ids are long random strings** (Traccar's "identifier"), not `f150`.
  They're set in Traccar and baked into each board's config.
- **Prefer HTTPS:** a DSM reverse-proxy name (e.g. `gps-in.jeffraben.com`, on
  the existing wildcard certificate) forwarding only to 5056. The A7670G modem
  speaks HTTPS through its AT commands, so positions and fault codes don't cross
  the internet in clear text. A plain port forward of 5056 works but is
  unencrypted.
- **Never expose 3952** (the web UI and API). Read the UniFi forwarding table
  before changing it.

## The vehicles

| Vehicle | OBD protocol | Notes |
|---|---|---|
| 2004 F150 | J1850 PWM | Generic OBD-II codes plus Ford P1xxx |
| 2002 C5 | J1850 VPW | Codes plus GM P1xxx |
| 1998 Jeep | ISO 9141 / VPW | Early OBD-II; fewest PIDs |
| Hyundai Tucson (Josie; year to confirm in WOPR) | CAN (ISO 15765-4) from 2008 on | More PIDs: fuel level likely; odometer only 2019+ |
| 2013 Nissan Rogue (Austin) | CAN (ISO 15765-4) | Fuel level likely; no odometer PID; Nissan P1xxx codes |

The vLinker MC+ covers all of these protocols. The F150, C5 and Jeep sit on
**trickle chargers** when parked. The Tucson and Rogue are daily drivers
without one, so the parked check-in keeps to once an hour and the board goes
fully quiet below 12.0 V, to protect their batteries.

**Parts for the Tucson and Rogue:** the tracker order was three sets, so two
more are needed: 2× vLinker MC+, 2× LILYGO T-SIM7670G-S3 with GPS, 2× 1NCE SIMs,
2× cases (a new `lid-tucson` / `lid-rogue` in `traccar-nas/case/`).

**The three older vehicles (pre-2008) support fewer PIDs.** Fault codes (mode `03`, `07`), the
check-engine light (`0101`), RPM, speed, coolant and the adapter's battery
reading (`AT RV`) work on all three. **Fuel level (`012F`), module voltage
(`0142`), distance since clear (`0131`) and the odometer (`01A6`) mostly don't**
on these model years. The firmware asks each vehicle which PIDs it has (`0100`,
`0120`, `0140` bitmaps) and only polls those. **Miles come from GPS**, set once
from the dash odometer.

## Firmware (one sketch for all three; not written yet)

PlatformIO/Arduino on the ESP32-S3. ESPHome has no ELM327-over-BLE client.

- **BLE to the vLinker** (ELM327 AT commands). The ESP32-S3 has BLE only, which
  is why the MC+ (BLE) was chosen. Check its GATT service on the first vehicle
  (commonly `FFF0` with notify `FFF1` / write `FFF2`, or `18F0`).
- **Running** (battery above ~13.2 V, or RPM > 0): GPS and fast PIDs every
  10 s, one report every 30 s; read the codes at each start and when `0101`
  changes.
- **Parked:** an hourly check-in (battery, position), deep sleep between, and
  wake on the voltage rising past 13.2 V.
- **Report:** OsmAnd `GET /?id=<random id>&lat=…&lon=…&speed=…&bearing=…&timestamp=…&batt=12.6&ignition=true&rpm=…&coolant=…&mil=1&dtcs=P0300,P0171&pending=…`.
  Queue reports on the board while there's no signal, and send them in order
  with their own timestamps.

## Truck Assistant side

- **`brain/src/cars/`**: a Traccar API client (read-only user, LAN), the latest
  state per device, trips from Traccar's trip report, and change detection for
  alerts. `brain/src/traccar.ts` (the Slate's own reporting) stays as it is.
- **Fault codes:** an offline table of the generic SAE J2012 codes (P0xxx,
  P2xxx, C/B/U0xxx) with plain-English meanings, plus the common Ford and GM
  P1xxx codes for these three vehicles. Unknown codes show as "maker-specific"
  with a search link. The same reader serves the Slate later.
- **Family cars page** (a rail view, or under Home):
  - all six vehicles (the Slate and five family vehicles) on the map: last
    seen, driving or parked, battery, and fuel where the vehicle has it;
  - a check-engine badge with the code and what it means, and when it appeared;
  - trips and miles per vehicle (the Trips view gains a vehicle filter).
- **Alerts** (TA's alerts and notifications):
  - check-engine light on, or a new code, with its meaning;
  - battery below 12.2 V parked (warning) and 11.9 V (won't start soon), useful
    if a trickle charger is off or unplugged;
  - coolant high while running;
  - a vehicle not reporting for a day while away from home;
  - optional: a vehicle leaving home between set hours (TA's geofences).
- **Maintenance by real miles:** TA's Maintenance module (miles or months,
  whichever first) gets one log per vehicle, fed by GPS miles.
- **Privacy:** Josie and Austin drive their own cars. Each driver should know,
  and agree, that their car reports its location. Settings › Family cars shows
  who can see what; each driver gets their own car's alerts; and each vehicle
  can be hidden from TA or have its history turned off.

## Phases

| Phase | What | Needs |
|---|---|---|
| 0 | Traccar admin account, registration off; HA integration confirmed; the random device ids | Traccar (tracker project) |
| 1 | **Bench:** one vLinker in one vehicle, the LILYGO on USB: BLE, `AT RV`, the supported-PID bitmap, codes, printed to serial | Boards (on order; not confirmed arrived) |
| 2 | **Firmware → Traccar on the LAN** (`192.168.1.219:5056`), then over LTE through the public HTTPS name | 1NCE SIM, the public route |
| 3 | **TA: Family cars page and the code table**, reading Traccar; tested with the Slate's own reports and a simulated vehicle | Code only; can start now |
| 4 | Alerts, maintenance by miles; the F150, C5 and Jeep on the road | — |
| 4b | The Tucson and Rogue, once their two extra kits arrive and Josie and Austin agree | 2 more kits |
| 5 | **Slate:** the same reader on the truck once its OBD/CAN access is known | Truck data |

Phase 3 doesn't wait for the boards: the Slate already reports into Traccar.

## Open

- The Tucson's year (WOPR's records on the NAS have it; it decides the protocol and PIDs).
- Order the two extra kits for the Tucson and Rogue.
- Have the boards and adapters arrived? The AliExpress orders (3× LILYGO, 3× vLinker MC+) still showed "awaiting delivery" on Nov 21.
- Is the HA Traccar Server integration finished, and which entities exist?
- The public route for 5056: an HTTPS reverse-proxy name (preferred) or a port forward.

## Later: Road Vision on TA's cameras

GlassDash's camera feature, done on the truck: a car in the blind spot while
signalling (the side cameras now pop up on the turn signal), a person behind
while reversing. Object detection on the Pi needs an AI accelerator (Hailo-8L
HAT, about $70) to run in real time; a separate plan when the Pi and cameras are in.
