# Slate Dash — Path: Raspberry Pi "brain" + ESP32-P4 touch display

*Planned 2026-11-05. Prices are from the web on that date. Anything marked **[UNVERIFIED]** was not confirmed against a primary source.*

---

## Summary

A **Raspberry Pi 4 (4 GB)** sits hidden behind the dash and does all the real work: GPS, trip logging, charge planning, Home Assistant/MQTT, media, cameras, CarPlay (via a Carlinkit dongle) and the web management UI. A **10.1" ESP32-P4 touch display** (Guition JC8012P4A1, 800×1280, about $44, in a 3D-printed shell that fits the Slate Tablet Mount) is the dashboard. It runs LVGL firmware, boots in about 1–2 s, and draws widgets from state the Pi publishes. The two are joined by **one USB cable** (the P4 shows up as a USB network adapter, USB-NCM), with Wi-Fi as a fallback.

**What this path does well:** it's cheap (about $415 base, $460 with a rear camera, $680 with 360° cameras). The screen is instant-on. The flash-based screen has no SD card to corrupt. Clean custom dashboards are easy. The screen draws little power and runs cool. It is easy for other owners to copy (one board, one Pi image, printed parts).

**What it can't do, plainly:**
- **CarPlay/Waze on the ESP32 screen is only experimental.** The P4 has a *hardware H.264 encoder* but only a *software* H.264 decoder: about 7–10 fps at 720p and about 25–31 fps at 640×480 (Espressif's own figures). The workable trick is for the Pi 4 to decode the Carlinkit H.264 in hardware and re-send it as MJPEG, which the P4 *does* decode in hardware (109 fps at 720p in Espressif's benchmark). The link bandwidth and latency then decide whether it feels usable. **The baseline plan keeps the phone as the Waze screen in its own mount.**
- **A real web browser cannot run on an ESP32.** The only way is "remote browser": headless Chromium on the Pi, streamed to the screen as JPEG frames with touch sent back. It is laggy (about 10–15 fps) but fine for static pages.
- **Battery SoC and energy per trip depend on CAN/OBD access, and Slate has not published any.** Without it, SoC is entered by hand or estimated.

---

## Architecture

```
                    ┌──────────────── Slate cab ───────────────────────────────┐
  12V (fused, ign)──┤ CarPiHAT (12V→5V, ignition sense, safe shutdown, CAN RO) │
                    │        │                                                 │
                    │  ┌─────▼──────────── Raspberry Pi 4 4GB (behind dash) ─┐ │
 USB GPS (u-blox) ──┼─►│ gpsd → trips.sqlite (USB SSD)                       │ │
 Carlinkit CCPA  ───┼─►│ node-carplay: H.264 → HW decode → MJPEG             │ │
 USB rear cam/360 ──┼─►│ ffmpeg/v4l2 capture (MJPEG passthrough)             │ │
 (360 ECU→USB grab) │  │ Mosquitto (local) ⇄ bridge to home HA when online   │ │
 BT (phone audio) ──┼─►│ BlueZ A2DP sink + AVRCP now-playing                 │ │
 CAN H/L (RO,?) ────┼─►│ can-reader (only if Slate exposes a bus)            │ │
 Opto inputs ───────┼─►│ aux switch / bed light / reverse-light sense        │ │
 Relay board ◄──────┼──│ (only on circuits we own: bed light)                │ │
                    │  │ web admin :443, Tailscale, sync agent, charge advisor│ │
                    │  └──┬──────────────┬───────────────────────────────────┘ │
                    │     │USB-NCM (IP)  │USB DAC → class-D amp → Slate spkrs  │
                    │  ┌──▼───────────────────────────┐                        │
                    │  │ ESP32-P4 10.1" touch (LVGL)  │ ← 5V from own buck      │
                    │  │ widgets + MJPEG video pane   │   in printed shell on   │
                    │  │ HW JPEG decode, touch→MQTT   │   Slate Tablet Mount    │
                    │  └──────────────────────────────┘                        │
                    │  Phone (own mount): Waze, hotspot, Slate app             │
                    └──────────────────────────────────────────────────────────┘
         home Wi-Fi / phone hotspot ──► Tailscale ──► NAS: hub container + HA (MQTT)
```

**Pi model:** **Pi 4 4 GB ($75)**.
- **Pi 5 is wrong for this job.** It costs more ($85 for 4 GB) and wants a 5 A supply. It also runs hotter. Most important, **it has no H.264 hardware decoder** (HEVC only), and H.264 is exactly what Carlinkit and cheap cameras emit.
- **Pi Zero 2 W ($15) is too limited.** It has 512 MB RAM and a single USB port, can't run the browser, can't do CarPlay plus cameras plus GPS at once, and has no Ethernet.
- **Pi 4 2 GB ($67.50) works** if you skip the remote browser.

**Pi ↔ screen link:** **USB-NCM** (the P4's USB 2.0 HS OTG port acting as a USB network device, TinyUSB). It is wired, 480 Mbit/s raw and immune to cab RF, and it carries MQTT plus the MJPEG video. **Wi-Fi fallback:** the Pi runs an AP and the P4's ESP32-C6 joins it (2.4 GHz Wi-Fi 6 over ESP-Hosted, realistically about 15–30 Mbit/s **[UNVERIFIED]**). That is enough for widgets and 800×480 video, but marginal for 1280×800 video.
- UART is too slow for video. ESP-NOW is pointless with a Pi in the loop.
- The Guition/Waveshare P4 boards list no Ethernet port.

---

## Parts list

| # | Part | Purpose | Price (USD) |
|---|---|---|---|
| 1 | Raspberry Pi 4 Model B 4 GB | brain | 75.00 |
| 2 | Guition JC8012P4A1 10.1" ESP32-P4 + C6, 800×1280 IPS cap-touch (bare) | display | ~44 (AliExpress) |
|   | *alt:* Waveshare ESP32-P4-WIFI6-Touch-LCD-10.1 (enclosed, 1280×800, **buy the no-battery version**) | display, if no printing | 80–110 |
| 3 | CarPiHAT (Pi 4 version): 12V→5V buck, ignition sense, safe shutdown, CAN transceiver, 12V outputs | power + CAN | ~90 **[UNVERIFIED US price]** |
|   | *budget alt:* 12V→5V 5 A automotive buck + ignition opto + latching power-off circuit (DIY) | power | ~30 |
| 4 | Aluminium passive heatsink for Pi 4 (no fan, fans die in dust) | cooling | 10 |
| 5 | 128 GB USB SSD/flash (data) + 32–64 GB high-endurance microSD (read-only root) | storage | 35 |
| 6 | USB GPS, u-blox 7/8 class (VK-162 type) | GPS | 15 |
| 7 | Carlinkit CPC200-CCPA (wireless CarPlay/AA → USB "head unit" dongle) | CarPlay (optional) | 45–65 |
| 8 | USB DAC + 2–3 ch class-D amp (TPA3116 class) — **only if Slate speakers are passive** | audio | ~40 |
| 9 | Fuse taps, fuse block, opto-isolator board, 2-ch relay, Deutsch/JST connectors, wire | install | ~35 |
| 10 | Filament (ASA/PETG-CF, see printed parts) | shells/brackets | ~15 |
|   | **Base total (with CarPlay dongle)** | | **≈ $415** |
|   | Base without CarPlay | | ≈ $360 |
|   | Budget build (DIY power, no CarPlay) | | ≈ $300 |
| 11 | Rear camera: USB UVC weatherproof camera with **native MJPEG** output (ELP type, 170° lens) | reverse cam | ~45 |
|   | **Total with rear camera** | | **≈ $460** |
| 12 | Generic 4-camera AHD 360° "bird's-eye" kit with its own ECU + CVBS/AV out (AliExpress, needs calibration mat) | 360° | 150–300 (use ~250) |
| 13 | USB AV/CVBS capture dongle (UVC) | 360 ECU → Pi | ~15 |
|   | **Total with 360° (replaces item 11)** | | **≈ $680** |

Branded 360 kits (Brandmotion FLTW-3600, Metra/iBeam TE-360-3D at about $1,400–1,870) work the same way through the capture dongle, but they blow the budget.

---

## How each want is met

### 1. Charge info + where to charge
- **How SoC gets in, in order of preference:**
  - **(a) CAN, read-only.** The CarPiHAT's transceiver listens to the OBD/diagnostic port if Slate has one, decoding PIDs/frames once the community maps them. Today this is **unknown**.
  - **(b) Manual.** A one-tap SoC slider on the screen at start/stop.
  - **(c) Estimated.** Last known SoC minus Wh/mi × GPS miles, re-anchored at each home charge from the wall meter.
  - Slate's own app shows SoC but has no API, and the $275 telematics module is fleet-oriented with no published interface.
- **Station data:**
  - **NREL/NLR AFDC API.** Free key. `alt-fuel-stations/v1/nearest` and `nearby-route` return network, connector types, power level, access hours and pricing text.
  - **Open Charge Map API.** Free key, community data, often has usage cost and comments.
  - **PlugShare** has no public API (deep link to the app only).
- **Offline:** the Pi pre-caches the whole AFDC set for AZ plus planned routes while on home Wi-Fi. Live availability needs the phone hotspot.
- **Suggestions:** a score built from Jeff's preferences, which are set in the web UI: preferred and excluded networks, minimum kW, max $/kWh, amenities, detour distance. The ranked list shows on screen. Tapping one sends a Waze deep link (`https://waze.com/ul?ll=lat,lon&navigate=yes`) to the phone via HA notification or a QR code.

### 2. Waze
**Baseline: Waze runs on the phone in its own 3D-printed mount.** It's free, solid and always current. **Experimental:** CarPlay through the Carlinkit, decoded by the Pi and relayed to the P4 as MJPEG (see Summary). It needs testing for latency and fps, and is not promised. Waze has no embed API, so it cannot be a widget.

### 3. Media dashboard + speakers
The Pi is a Bluetooth A2DP sink, so the phone pairs to "Slate". BlueZ AVRCP gives title, artist, album, position and play/pause/skip, and the screen shows a now-playing card. Album art comes from the Spotify Web API when the hotspot is up. Audio path: Pi → USB DAC → amp → Slate speakers, or the CarPlay audio stream when Carlinkit is used. Source switching (BT / CarPlay / local files on the SSD) is a screen widget.

### 4. Clean, customizable look
- LVGL 9 on the P4 at 1280×800 landscape.
- The firmware has a widget library: speed, SoC, range, charger list, now-playing, clock/weather, trip, HA buttons, camera pane.
- **Layouts** are a JSON grid, and **themes** are color/font token sets. Both are edited in the web UI and pushed over MQTT (retained), and the screen re-renders live.
- Several pages (Drive / Charge / Media / Home / Cams) are swiped or switched by the aux switches.

### 5. Inexpensive and reliable
See *Reliability & heat*. In short:
- Screen boots in about 1–2 s.
- Pi boots in about 10–15 s (target), on a read-only root with data on the SSD.
- Safe shutdown on ignition off.
- No battery inside the cab electronics.
- Passive cooling.

### 6. Cameras / 360° / auto reverse
- **Rear camera:** a USB MJPEG camera on the Pi, relayed with no transcode to the P4's hardware JPEG decoder.
- **Auto switch on reverse:** an opto-isolator on the reverse-light feed goes to a Pi GPIO, and the screen switches to the camera with guide lines.
- **360°:** a kit ECU does the stitching, its CVBS output goes into the USB capture dongle, and the Pi relays it.
- **Limitation:** if the Pi is still booting (first ~10–15 s), the camera isn't ready.
  - Mitigation: a 10-minute "stay alive" after ignition off covers most short stops.
  - Phase 4 experiment: a camera on the P4's own MIPI-CSI or USB host, for an instant reverse view.

### 7. Web browser
**Not native: an ESP32 cannot run a browser.** The remote browser works like this: Chromium headless on the Pi, frames sent as JPEG to a full-screen pane, touches sent back. It is fine for a status page or HA dashboard, but bad for video or scrolling. The honest answer is to use the phone.

### 8. Web management dashboard
- **Where it lives:** on the Pi itself (`https://slate.local` on the truck's AP, or via Tailscale). So **no server is needed for other owners**: they join the truck Wi-Fi with a phone.
- **What it does:** layouts, themes, preferences, accounts, HA token, OTA for both Pi and P4 firmware, trip viewer.
- **Optional home hub:** a Docker container on Jeff's NAS keeps the full trip history and map. Config is edited while the truck is away, and the truck pulls a versioned config whenever it sees home Wi-Fi or the phone hotspot.
- **Auth:** a local admin password plus a device pairing code shown on screen. TLS uses a self-signed cert or Tailscale certs.
- **Accounts:**
  - **Spotify:** Web API OAuth PKCE. Each owner registers their own client ID; dev-mode limits make a shared app impractical.
  - **Plex:** has an API.
  - **Google Calendar:** OAuth.
  - **HA:** long-lived token.
  - **Apple Music:** needs a MusicKit developer token ($99 program) **[skip]**.
  - **YouTube Music, Pandora, SiriusXM, Audible:** no usable public API, so they are played via the BT source only.

### 9. Home Assistant
- **Truck as an HA device:** the Pi publishes **MQTT discovery** for:
  - sensors: SoC, range, location as `device_tracker`, charging state, cabin and Pi temperature, trip stats;
  - switches: bed light relay;
  - cameras: snapshot on arrival.
- **Link to home:** a local Mosquitto on the Pi bridges to HA's broker when home Wi-Fi or the hotspot plus Tailscale is reachable.
- **ESPHome option:** the P4 *could* be an ESPHome device itself. P4/MIPI-DSI support in ESPHome is new and community-level, so the Pi stays the single HA endpoint.
- **Garage on arrival:** an HA automation fires when the truck's GPS enters the home zone *and* the truck is moving toward home. It sends a confirm prompt to the screen ("Open garage? 5 s"), or opens automatically if Jeff chooses. A screen HA-button page offers garage, gate and lights.
- **Offline:** the buttons grey out, state is queued (persistent MQTT session), and trips sync later.

### 10. Route/trip tracking
- gpsd from the u-blox puck logs 1 Hz fixes to SQLite on the SSD.
- Trips start and stop on ignition. Per-trip stats: distance, time, max speed, elevation, and energy (CAN SoC delta if available, else estimated Wh/mi).
- The map is drawn on the web UI (Leaflet + OSM tiles cached at home).
- On home Wi-Fi the sync agent uploads trips (GPX/GeoJSON) to the NAS hub and to HA.

---

## Slate accessory integration

| Accessory | What it is (best evidence) | Integration | Unknowns |
|---|---|---|---|
| **The Five Switch – Upgrade Version ($39.99)** | Slate's aux button panel. Slate says each electronic accessory added can have its aux button "programmed" to control it. No public wiring spec. | **Mirror:** an opto-isolator taps each switch output (if they are plain 12V-switched circuits) into Pi GPIO, shown as on-screen indicators and HA binary sensors. **Drive:** only via our own relay in parallel on circuits we install. If Slate routes the switches through a body module (CAN/LIN), they are read-only at best. A spare switch can be mapped to "next page" on the screen. | Whether the switches are dry contacts, switched 12V or a networked module; current rating; what "Upgrade Version" adds. **[UNVERIFIED]** |
| **Bed Light Kit ($139.95)** | 12V LED kit, likely on an aux switch | Opto sense shows its status; optional relay gives screen/HA control (e.g., auto-on when the tailgate opens at night). | Draw and connector |
| **Front L+R ($149.99) + Center ($249.99) integrated speakers** | Dash-mounted speakers; Slate expects you to "bring your own sound" from the phone or tablet. A 3-piece 400 W system has been floated. Dash panels ($59.99) required. | If passive: Pi USB DAC → class-D amp (3-ch, or 2-ch with center summed). If Slate's kit includes an amp/BT receiver: feed its input or pair the Pi to it. | **Whether an amp is included is not published** |
| **Hands Free Bluetooth Controller (TBD)** | Reported as a steering-wheel BT controller for connected devices | If it's a standard BT HID/AVRCP remote: pair it to the Pi (BlueZ) to drive media and page switching. If it only pairs to phones: leave it on the phone. | Profile (HID vs proprietary), pairing limit |
| **Tablet Mount (TBD)** | Dash mount for the owner's tablet | 3D-print a tablet-shaped shell around the 10.1" P4 board so it clamps like a tablet. A 5V + USB pigtail runs through the mount. | Clamp range and whether it powers the device |
| **Classic L2 Wall Charger ($479)** | Home EVSE | If it has no smart API: a Shelly/Emporia meter on its circuit in HA gives home-charge kWh, used to re-anchor the SoC estimate. | Whether it has Wi-Fi/OCPP |
| Hitch receiver | — | Hitch-view camera optional (same USB cam type); "trailer mode" page. | — |
| Tailgate lock kit / NEXUS tonneau | Mechanical | Optional reed switch on the tailgate → HA "bed open" sensor. | — |
| Telematics module ($275, fleet-focused) | Slate's connectivity add-on | Not needed. Might someday expose data, but there is no public API. | Everything |

---

## Reliability & heat (Phoenix)

- **Heat is the main threat.**
  - Parked cab air reaches 60–75 °C, and the dash top gets hotter.
  - The Waveshare P4 boards are rated **0–60 °C** for operation. LCDs typically store to about 70 °C **[UNVERIFIED for these panels]**.
  - Mitigations:
    - The screen is in a **removable** printed shell, or covered with a reflective sun shade.
    - The P4 firmware reads its temperature, dims or kills the backlight above 55 °C and refuses to boot above 65 °C.
    - The Pi goes low behind the dash in shade, with a passive heatsink. It throttles at 80–85 °C, and it is fully off when parked.
    - **No lithium cells anywhere** (skip the battery variant of the Waveshare board; use a supercap hold-up on the power board if needed).
- **Power loss / SD corruption:**
  - The CarPiHAT senses ignition, keeps 5V for a configurable delay (10 min default) and then shuts the Pi down cleanly before cutting power.
  - The root filesystem is **read-only overlay** (raspi-config overlayfs), and all writes go to the USB SSD (ext4, journaled, `commit=5`).
  - The SQLite database runs in WAL mode.
  - The P4 has only flash, so nothing on it can corrupt. A/B OTA partitions allow rollback.
- **Boot time:**
  - Screen: about 1–2 s to UI, showing the clock plus cached data plus "hub starting".
  - Pi: target ≤15 s to services (Lite OS, no desktop, systemd-analyze trimmed, no Docker in the truck).
- **Vibration:**
  - Locking connectors (JST-GH/Deutsch) and a strain-relief clip on every cable.
  - Heatsink screwed rather than taped; no USB cables hanging under load.
  - The SSD is a solid flash stick or SSD, not a spinning drive.
- **Power draw when off:** below 1 mA (CarPiHAT). The 12V battery is safe while parked.

---

## Software stack & customization

- **ESP32-P4:**
  - ESP-IDF 5.5+ with `esp_lvgl_port`, LVGL 9.
  - `esp-mqtt` client for state and touch events; a hardware JPEG decoder pipe for the video pane.
  - TinyUSB NCM device for the link, ESP-Hosted Wi-Fi as fallback.
  - The firmware is a *renderer*: layout and theme JSON in, widgets out. No logic about the truck lives on it.
- **Pi (Raspberry Pi OS Lite 64-bit), systemd services:**
  - `gpsd`, `mosquitto` (with bridge), `truckd` (Python: state model, trips, charge advisor, CAN decoder plug-ins).
  - `vidrelay` (ffmpeg / V4L2 M2M: Carlinkit H.264 → hardware decode → MJPEG; UVC MJPEG passthrough).
  - `node-carplay` (react-carplay's driver, Carlinkit CCPA/CCPM).
  - `bluealsa`/BlueZ (A2DP sink + AVRCP), `chromium --headless` (remote browser, optional).
  - `admin-web` (FastAPI + small SPA), `tailscaled`, `sync-agent`.
- **Home hub (NAS, optional):** a Docker compose with the trip DB (Postgres/PostGIS or SQLite), a map viewer and config versioning. It talks to HA over MQTT.
- **Customization:** widget catalog, drag-grid layout editor in the web UI, theme tokens (incl. a dark electric-blue default), per-page backgrounds, units, night mode tied to sun position.
- **Publishing for other owners:**
  - a GitHub repo with the Pi image built by `pi-gen` (flash, then join the "SlateDash-setup" AP, then a wizard);
  - P4 firmware as a web-flasher (ESP Web Tools, from the browser);
  - STL/STEP files for every printed part, and a wiring PDF.

---

## 3D-printed parts

Material rule for a Phoenix cab: **PLA softens at about 55–60 °C, so never use it.** PETG (Tg about 80 °C) is OK only in shaded or under-dash spots. **ASA** (Tg about 100 °C, UV-stable) is the default for anything in sunlight. **PC/PC-CF** is for the hottest dash-top parts. Anneal PETG-CF and PC-CF parts where possible, and use heat-set brass inserts rather than threads cut into plastic.

| Part | Purpose | Material |
|---|---|---|
| Display shell (front bezel + rear cover) | Encloses the bare Guition 10.1" board, tablet-shaped to clamp in the Slate Tablet Mount; vent slots; light-colored rear to reflect heat | **ASA** (front, matte black) / ASA white (rear) |
| Display sun visor/hood | Cuts glare and direct sun on the panel | ASA |
| Quick-release cradle insert for Tablet Mount | Lets the screen come off in summer; carries the 5V + USB pigtail with a keyed connector | PC or PETG-CF |
| Pi 4 + CarPiHAT enclosure | Behind-dash mount, open fins around the heatsink, cable strain reliefs, tie-down tabs | PETG-CF (shaded) / ASA |
| Phone mount (Waze) | Clips to the dash or vent beside the screen; MagSafe puck pocket | ASA |
| GPS puck pod | Holds the u-blox puck near the windshield or under a plastic dash panel with a clear sky view | ASA |
| Rear camera bracket | Above the plate or at the tailgate handle; angle-adjustable | **ASA** (outdoor UV) |
| 360 camera brackets ×4 | Mirror/fender/tailgate/grille mounts; set angles repeatable for calibration | ASA |
| Hitch camera housing (optional) | Trailer view | ASA |
| Aux switch-panel surround / label plate | Fits the Five Switch area if the stock bezel needs adapting; holds printed legends | ASA |
| Opto/relay board box | Small sealed box near the fuse block | PETG-CF |
| Amp mount (if needed) | Under-dash or under-seat amp bracket with airflow | PETG-CF |
| Cable clips, grommets, strain reliefs | Vibration-proof routing | PETG / TPU (grommets) |
| Calibration mat holders (shop use) | Keeps the 360 calibration cloth square | PLA OK (not stored in truck) |

---

## Phased build

1. **Bench (now, before delivery).**
   - Pi 4 + P4 screen on the desk.
   - USB-NCM link, MQTT widgets, layout and theme JSON, web admin.
   - GPS logging and the AFDC/OCM charge advisor with manual SoC.
   - BT now-playing.
   - Print and test-fit the shells.
2. **Truck v1 (delivery week).**
   - Power board on fused ignition and constant 12V; Pi behind the dash; screen in the Tablet Mount; phone mount for Waze.
   - Trips plus sync to the NAS; HA via MQTT; garage-on-arrival with confirmation.
   - Measure cab temperatures and set the thermal cutoffs.
3. **Audio + accessories.**
   - Find out whether the Slate speakers are passive; add the DAC and amp.
   - Opto-sense the Five Switch and bed light; add the relay for the bed light.
   - Pair the BT controller to the Pi.
4. **Cameras.**
   - Rear USB camera with reverse trigger.
   - Then the 360 kit with the capture dongle.
   - Experiment with a camera direct on the P4 for instant reverse.
5. **CAN discovery (read-only).**
   - If an OBD/diag port exists: sniff passively, map SoC, speed and charge state, then publish a decoder plug-in for other owners.
   - Never transmit on the bus.
6. **Experimental video.**
   - Carlinkit CarPlay relay; measure fps and latency. Keep it only if it stays above 20 fps and below 250 ms.
   - Remote browser.
7. **Publish.** Pi image, web-flasher firmware, STLs, wiring guide.

---

## Risks / unknowns

1. **No public Slate CAN/OBD access.** SoC, charge state and energy per trip may stay manual or estimated. This is the biggest gap against wants 1, 9 and 10.
2. **Heat.** The P4 board is rated 0–60 °C, and a Phoenix dash exceeds that. The screen may need to come out or be shaded in summer, and there are thermal cutoffs in firmware.
3. **Video on ESP32 is the weak spot.** H.264 decode is software-only (≤10 fps at 720p). The MJPEG relay depends on link bandwidth and USB-NCM stability. ESPHome/LVGL P4 support is young and community-level, so expect firmware bugs.
4. **Slate accessory electrics are unpublished.** The Five Switch wiring, whether the speakers have an amp, the BT controller's profile and Tablet Mount dimensions are all unknown until delivery or a service manual.
5. **Pi boot delay delays the rear camera.** Mitigated by the stay-alive window; an instant camera path is an experiment.
6. **Prices are moving.** Pi prices rose 3 times in 2025–26 from the RAM shortage. AliExpress screen prices vary.
7. **Spotify/Apple API policy.** Each owner must register their own Spotify app; there is no Apple Music without a paid developer account.

---

## Sources

- Espressif `esp_h264` 1.5.0 readme: P4 hardware *encoder*, *software* decoder (tinyH264); P4 decode 1280×720 at 7–10 fps, 640×480 at 25–31 fps — https://components.espressif.com/components/espressif/esp_h264/versions/1.5.0/readme
- ESP-IDF ESP32-P4 JPEG codec docs (hardware decode 1080p ≈48 fps, 720p ≈109 fps) — https://docs.espressif.com/projects/esp-idf/en/v5.4.4/esp32p4/api-reference/peripherals/jpeg.html
- CNX Software, Waveshare ESP32-P4-WIFI6-Touch-LCD 7/8/10.1 (1280×800, USB-C OTG, 0–60 °C, 32 MB PSRAM, $80–117) — https://www.cnx-software.com/2026/01/17/tablet-like-esp32-p4-based-7-8-and-10-1-inch-hmi-displays-integrate-wi-fi-6-connectivity-5mp-camera/
- Guition JC1060P470 / JC8012P4A1 prices and specs — https://www.atomic14.com/esp32/boards/guition-jc1060p470/ ; https://www.cnx-software.com/2025/05/06/7-inch-esp32-p4-wireless-touchscreen-display-supports-guition-designer-for-lvgl-arduino-and-esp-idf-programming/ ; https://jtenniswood.github.io/espcontrol/screens/jc8012p4a1
- ESPHome on P4 (community, early) — https://community.home-assistant.io/t/guition-esp32-p4-jc1060p470/959144 ; https://github.com/embenix/ESP32-P4-DSI-Support-Hub
- LVGL adapter, P4 hardware JPEG path — https://components.espressif.com/components/espressif/esp_lvgl_adapter/versions/0.7.4/examples/lvgl_decode_image
- react-carplay / node-carplay (Carlinkit CCPA/CCPM on Linux/Pi) — https://github.com/rhysmorgan134/react-carplay ; https://github.com/marcraft2/tesla-carplay
- Carlinkit CPC200-CCPA pricing — https://carlinkitcarplay.com/products/carlinkit-wirless-adapter-for-android-head-unit-support-carplay-and-android-auto
- Raspberry Pi 2026 price increases — https://www.tomshardware.com/raspberry-pi/component-shortages-drive-raspberry-pi-prices-up-by-up-to-23-percent-escalating-lpddr4-lpddr5-costs-trigger-the-third-price-hike-of-the-year ; https://www.theregister.com/2026/02/02/raspberry_pi_ram_shortage_price_hike/
- CarPiHAT / CarPiHAT PRO 5 — https://thepihut.com/products/carpihat-car-interface-hat-for-raspberry-pi ; https://core-electronics.com.au/carpihat-pro-5-car-interface-dac.html ; https://www.cnx-software.com/2020/09/07/carpihat-connects-raspberry-pi-to-your-car-with-opto-gpio-can-bus-12v-outputs/
- UPS-HAT auto-power-on caveat — https://community.sixfab.com/t/ups-hat-car-power-boot-up-and-car-power-off-shutdown/282
- AFDC station API (nearest / nearby-route) — https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/
- 360 camera kits and prices — https://tadibrothers.com/products/360-degree-truck-camera-system-for-surround-view-with-dvr-4-cameras ; https://reach.dog/shop/12-volt-depot/products/ibeam-360-degree-3d-svm-camera-system-with-dvr ; https://jbspowercentre.com/collections/sensors/products/dksf-fltw-3600
- Slate speakers / pricing / BYO sound — https://theweeklydriver.com/2026/07/slate-truck-price-base-vs-loaded-options/ ; https://www.moneytalksnews.com/i-built-a-custom-slate-truck-heres-my-honest-review/ ; https://jalopnik.com/2200623/slate-truck-pricing-24950-new-details-specs-announced
- Slate aux buttons "programmable" + speakers thread (owner forum, not official) — https://www.slateforums.com/forum/threads/speakers-are-standard.13104/ ; https://www.slateforums.com/forum/threads/12v-accessory-bus-bar-switch-array.13003/
- Slate telematics module ($275, fleet-focused), no modem — https://www.slashgear.com/2222441/slate-truck-cool-features/
- Not found anywhere public: Five Switch spec, Hands Free Bluetooth Controller spec, Tablet Mount dimensions, speaker amp, Slate CAN/OBD access. All marked **[UNVERIFIED]** above.
