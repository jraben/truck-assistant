# Slate Dash — Android path plan
### Android head-unit screen + Carlinkit CarPlay dongle (Autokit) + custom web dashboard

*Prepared 2026-11-05 for Jeff Raben (Phoenix, AZ). Tags: **[V]** checked against a source cited below; **[U]** unverified, an estimate, or a seller claim; **[UNK]** unknown until the truck is delivered and someone measures it.*

---

## 1. Summary

**Primary recommendation:** a **battery-free Android car head unit, used as a standalone dash display.** The reference unit is the **TEYES CC3 2K "360" universal 10.36"**, a 2000×1200 QLED panel with the 360-capable mainboard, 6/128 GB, a built-in 4G modem and GNSS [U for exact SKU and price]. It sits on Slate's Tablet Mount or the interior T-rail through a published 3D-printable adapter. CarPlay comes from a **Carlinkit CPC200-CCPA** (the Autokit dongle made for Android head units). The custom dashboard is a web app shown full-screen in **Fully Kiosk Browser**, which is set as the launcher. A small native **"Slate Bridge" Android service** links it to an **ESP32-S3 "truck bridge" box** for switches, relays, the reverse signal and (if Slate exposes it) CAN data.

**Why a head unit and not a rugged tablet.** I considered the Galaxy Tab Active5 Pro: 600 nits, IP68, hot-swap battery, No Battery Mode, about $730–870 [V]. The head unit wins on four of Jeff's wants:
- **No lithium battery in a Phoenix cab.** Nothing can swell, so nothing has to be pulled out of the truck in July.
- **Real ignition behaviour.** An ACC wire gives sleep on power-off and fast boot. The tablet's No Battery Mode needs a dedicated USB-C PD source, and it caps brightness and CPU [V]. That USB-C port is also the one the Carlinkit dongle and a camera capture device would need.
- **Native 360° camera and a reverse-trigger wire.** Four AHD inputs, and the screen switches to the cameras automatically in reverse. A tablet has neither.
- **A built-in 4-channel amplifier and line outputs.** That leaves an option open for Slate's speakers.

**The cost:** lower brightness than an outdoor tablet (assume roughly 500–800 nits [U]), and more wiring.

**Rough cost:**
- Base build: **about $780–960**
- With the 360° camera kit plus a hitch cam: **about $1,050–1,330**
- Plus about $10–20 a month for a data SIM (optional but recommended)
- Slate accessories Jeff already ordered are not included.

---

## 2. Architecture

```
                         ┌────────────────────── Phoenix sun / cab ──────────────────────┐
  iPhone ──(wireless CarPlay: BT+5GHz Wi-Fi)──► Carlinkit CPC200-CCPA ──USB──┐
                                                                             ▼
  4 x AHD 1080p cams (F/R/L/R) ──AHD──► ┌──────────────────────────────────────────┐
  Hitch cam (AHD) ─────────────────────►│  ANDROID HEAD UNIT (TEYES CC3 2K 360)    │
  Reverse lamp 12V ──► REVERSE wire ───►│  - Autokit app  (CarPlay: Waze, music)   │
  Switched 12V ──► ACC wire ───────────►│  - Fully Kiosk = launcher → Dashboard PWA│
  Constant 12V (fused) ──► B+ ─────────►│  - "Slate Bridge" service (Kotlin):      │
                                        │      BLE↔ESP32, ws://127.0.0.1:8765,     │
                                        │      MediaSession reader, GPS logger,    │
                                        │      MQTT client, offline queue (SQLite) │
                                        │  - HA Companion, Tailscale, Chrome       │
                                        │  - 4G SIM / phone hotspot / garage Wi-Fi │
                                        │  - 4ch amp + RCA line-out ───────────────┼──► (A) wired → Slate speakers? [UNK]
                                        └──────────┬───────────────────────────────┘    (B) BT TX → Slate BT speakers [UNK]
                                                   │ BLE
                                        ┌──────────▼──────────────────────────┐
                                        │ ESP32-S3 "Truck Bridge" (fused 12V) │
                                        │  - 5x opto inputs: Five Switch circuits (read) │
                                        │  - relay outs: bed lights / aux (parallel)     │
                                        │  - CAN transceiver: listen-only  [UNK if usable]│
                                        │  - temp sensor (cab heat), 12V voltage         │
                                        └─────────────────────────────────────┘
                         └────────────────────────────────────────────────────────────────┘
        Internet (when present) ── Tailscale ──► Jeff's NAS: Slate Hub (portal), MQTT, Traccar, HA, WOPR
```

**Data flows:**
- The **dashboard PWA** talks only to `ws://127.0.0.1:8765` (the bridge service) and to cached data, so it works fully offline.
- The **bridge service** owns everything that crosses the network: config pulled from the Hub, telemetry and trips pushed, MQTT to HA. Each is queued until a network shows up.
- **CarPlay** stays a separate full-screen app (Autokit). The dashboard deep-links to it and back.

---

## 3. Parts list

Prices are approximate, seen in Nov 2026 listings. **[U]** unless a source is cited.

### Base build

| # | Part | Purpose | Approx. |
|---|------|---------|--------:|
| 1 | TEYES CC3 2K **360** universal 10.36" (6+128 GB, 4G, 360 mainboard) | Screen, Android, GNSS, 4G, AVM, amp | $450–600 |
| 2 | Carlinkit **CPC200-CCPA** (Autokit dongle for Android head units) | Wireless CarPlay | $60–90 |
| 3 | Printed screen shell + Tablet Mount adapter (see §3a), plus M4/M5 heat-set inserts and stainless hardware | Mount (STL published) | $15–25 filament/hardware |
| 4 | Slate **Tablet Mount** (Jeff ordered; price TBD) | Base bracket | TBD |
| 5 | ESP32-S3 dev board + SN65HVD230 CAN transceiver + 5-ch PC817 opto board + 4-ch 12V relay board + 12→5V buck + DS18B20 temp probe (enclosure printed, §3a) | Truck bridge | $45–65 |
| 6 | Add-a-circuit fuse taps (×3), 18/16 AWG wire, inline fuses, Posi-Taps, loom, grommets | Power: B+, ACC, reverse | $35–50 |
| 7 | Bluetooth transmitter, aptX Low Latency (e.g. 1Mii / Avantree class), **only if Slate speakers are BT-only** | Audio to Slate speakers | $35–50 |
| 8 | Matte anti-glare screen film + reflective windshield sunshade | Sun / heat | $30–45 |
| 9 | Fully Kiosk Browser PLUS license | Kiosk / launcher | ~$9 |
| 10 | Data SIM (US Mobile / T-Mobile data-only class) | Internet in truck | $10–20/mo |
| | **Base total (one-time)** | | **≈ $780–960** |

### Cameras (adds to base)

| # | Part | Purpose | Approx. |
|---|------|---------|--------:|
| 11 | TEYES 360° AHD 1080p 4-camera kit (front grille, tailgate, two under-mirror/side) | Bird's-eye 360, 4-channel DVR | $180–280 |
| 12 | AHD hitch camera (wide angle, IP68, for the 2" receiver) | Towing / hitch alignment | $30–50 |
| 13 | Extension leads and tailgate grommets (camera brackets printed, §3a) | Install | $30–45 |
| | **Camera add-on** | | **≈ $250–390** |
| | **Total with cameras** | | **≈ $1,050–1,330** |

Totals stay in the same ranges: printing saves roughly $20–40 over bought brackets and enclosures, which offsets a few price swings in the listings.

**Fallback if the TEYES 360 SKU isn't available:** any Android head unit with a CVBS/AHD rear-cam input, plus a generic 4-channel AHD 360 "AVM box" ($235–250 class [V listings]). It stitches the view itself and outputs one video feed to the rear-cam input. Auto-reverse still works through the AVM box's reverse trigger.

---

## 3a. 3D-printed parts

Jeff prints these himself, and every file is published with the project (STEP + STL, parametric source in FreeCAD/OnShape) so other owners can reprint them.

**Material rule for a Phoenix cab:**
- **No PLA anywhere.** It softens around 55–60 °C, and dash surfaces pass 80 °C.
- **ASA** is the default for anything on or above the dash or outside. It is UV-stable and holds up to about 95–100 °C.
- **PETG-CF** only for parts below the dash line, out of the sun. It softens around 80 °C.
- **PC-CF or PA-CF (nylon-CF)** for the load-bearing screen arm and adapter, if Jeff's printer can handle them (enclosed, hardened nozzle). Otherwise ASA, with thicker walls.
- **TPU** for clips, gaskets and anti-rattle pads.

**Build rules:**
- Brass heat-set inserts for every screw that gets removed more than once.
- 5–6 perimeters and 40%+ gyroid infill on structural parts.
- Matte black or grey finish on dash parts, to cut windshield reflection.
- Anneal PA-CF per the filament maker.

| # | Part | Purpose | Material | Notes |
|---|------|---------|----------|-------|
| P1 | **Screen shell / bezel** for the 10.36" head-unit panel | Encloses the bare panel back, hides cables, gives a clean "factory" face matching the dash | ASA (matte) | Integrated sun-hood lip (10–15 mm) to cut glare; vent slots top and bottom for convection |
| P2 | **Tablet Mount adapter plate** | Screen shell → Slate Tablet Mount interface, or straight onto the interior T-rail | PC-CF / PA-CF (ASA fallback, thicker) | Modelled once the mount's geometry is measured (interface is [UNK]); ribbed for vibration; tilt adjustable ±10° |
| P3 | **Brain-box cradle** | Holds the head-unit mainboard/chassis under the dash, out of the sun | PETG-CF | Standoffs for airflow; zip-tie slots; fuse-block mount |
| P4 | **ESP32 truck-bridge enclosure** | Houses the ESP32, CAN transceiver, opto board, relays, buck | PETG-CF (under dash) | Labelled terminal-block windows; DS18B20 probe pass-through to the cab air; strain-relief bosses |
| P5 | **Carlinkit dongle + USB holder** | Keeps the dongle fixed and ventilated, away from metal (for Wi-Fi) | PETG-CF | Snap-fit; it runs warm, so it gets an open lattice |
| P6 | **Camera brackets ×4** (front grille, tailgate, L/R side under mirrors) | Mount the AHD 360 cameras at calibrated angles | ASA | Fixed angle per position, so recalibration repeats after removal; drip edge over each lens; stainless hardware |
| P7 | **Hitch-cam mount** | Holds the AHD camera on the 2" receiver (pin-through or receiver-face clamp) | ASA (PA-CF if clamped) | Quick-release so it comes off with the hitch |
| P8 | **Switch panel / legend inserts** | Labelled caps and inserts for the Five Switch plate; or a fully printed panel if the plate needs it | ASA | Engraved or multi-colour icons (Bed, Aux 1–4); only if Slate's covers allow, otherwise stick-on legends |
| P9 | **Cable clips, channels and grommet collars** | Clean routing to the T-rail, door sills, tailgate | TPU (clips), ASA (channels) | Sized for the AHD leads and 16 AWG; anti-rattle |
| P10 | **BT transmitter / audio box holder** (only for Path B) | Mounts the Bluetooth transmitter near the center speaker | PETG-CF | Keeps the antenna clear of metal |
| P11 | **Tailgate / tonneau reed-switch mounts** | Optional open/closed sensors | ASA | Exterior, UV |
| P12 | **Optional GNSS / 4G antenna pod** | Positions the head unit's antennas for a clear sky view | ASA | Under the windshield edge, not in the screen shell |

**Test before installing:** put each dash part on the dash in a sealed truck at an August noon (or in an oven at 85 °C for 2 h) and check for creep at the screw bosses before trusting it with a 1 kg screen.

---

## 4. How each want is met

### Want 1 — Charge info and charging suggestions

**How state of charge (SoC) gets in, best to worst:**
1. **CAN listen-only via the ESP32** [UNK]. Slate has said it will use CAN [U, forum report of an interview]. As a zero-emission vehicle it is exempt from the federal OBD-II mandate [U, forum], so a standard OBD-II port carrying SoC is **not assured**. Phase 0 is a sniff to find out: is there a port, what is the bitrate, does it carry pack SoC? Only transmit-free hardware: the transceiver is strapped listen-only.
2. **Slate's own systems.** The Slate phone app (late 2026) works only near the truck. The $275 subscription Telematics Module adds remote unlock and preconditioning [V Engadget]. **No public API is announced.** If a cloud API or a documented BLE profile appears, the bridge service gets one adapter for it.
3. **Manual / estimated.** Tap SoC on the dashboard, read off Slate's 4" cluster. The bridge then models it as SoC − kWh used. kWh used comes from CAN current if available, otherwise from distance × a learned Wh/mi (63 kWh usable, ~205 mi est. range [V]).
4. **At home:** the session energy from the wall charger (see Slate accessories, §5) adds an exact kWh-in figure.

**Charging data sources:**

| Source | What it gives | Access |
|---|---|---|
| **NREL AFDC Alt-Fuel Stations API** | Every US public station, network (`ev_network`), connector types, DC fast count, power, `ev_pricing` text, status codes, hours, amenities via facility type | Free API key, developer.nrel.gov [V fields; 2026 status not re-verified] |
| **Open Charge Map API** | Community POIs, connectors, kW, usage cost text, photos, comments | Free key, open data |
| **Google Places API (New) `evChargeOptions`** | **Live-ish availability**: per connector type/kW, `availableCount`, `outOfServiceCount`, `availabilityLastUpdateTime`, plus ratings and nearby amenities | Paid per call (Google Maps Platform); freshness not documented [V fields] |
| **Tesla Superchargers** | Slate has a NACS port and Supercharger access [V], up to 120 kW DC [V] | No public station API for non-Tesla accounts. Use AFDC/OCM for locations; pricing is in the Tesla app [U] |
| **PlugShare** | Best check-ins/reviews | **No public API** (partner only). Deep-link to the app or site |
| **Electrify America / EVgo / ChargePoint** | Accounts, pricing, sessions | No public consumer APIs. Stored as membership flags in the Hub, deep-link their apps (OCPI is B2B only) |
| **ABRP Telemetry API** | Push live SoC so ABRP (also in CarPlay) plans stops | Free telemetry key on request plus a per-user token [V community docs] |

**Suggestion engine (runs on the bridge service, offline-capable using a cached station set along the route):**

`score = w_net·networkPref + w_kw·min(kW,120)/120 + w_price·(1 − price/maxPrice) + w_amen·amenityMatch + w_avail·(available/total) − w_detour·detourMin − w_risk·(arrivalSoC < reserve)`

- **Inputs:** current SoC, next Waze/ABRP destination if known, Jeff's weights edited in the Hub (§8).
- **Output:** the top 3 cards ("EVgo Chandler — 2 of 4 free, 100 kW, Starbucks, arrive 31%") with a one-tap hand-off to Waze/ABRP.
- **Learning:** the Truck view shows charging stats (kWh, $ per session, average kW achieved per network) from logged sessions, so the "speed" preference learns from Slate's real 120 kW-peak curve.

### Want 2 — Waze

**Use Waze in CarPlay as primary.**
- It runs on the iPhone's GPS, data, account, saved places and Siri.
- It needs no data plan on the truck.
- It is what Jeff already uses.
- Its EV charger search, filtered by plug type, works in CarPlay [V].

**Install native Android Waze on the head unit as the fallback:** phone not present, phone dead, or a passenger driving. It uses the head unit's GNSS and the 4G SIM.

Neither version plans by SoC [V]. That is why SoC goes to **ABRP** (CarPlay app) and to the dashboard's own suggestion engine.

Autokit is one full-screen app. The dashboard keeps a slim overlay strip (SoC, next charger, cab temp) through a Fully Kiosk overlay or Android split-screen [U: needs a test on the TEYES build].

### Want 3 — Media dashboard

**Now playing:**
- **Android apps** (Spotify, YouTube Music, Pandora, Plexamp, Audiobookshelf…): the bridge service's `NotificationListenerService` reads `MediaSession` metadata, art and position from any of them and exposes play/pause/skip.
- **CarPlay audio** goes phone → dongle → Autokit. Autokit is not known to publish a MediaSession [UNK]. So for CarPlay the card falls back to the **Spotify Web API** "currently playing" endpoint (works in dev mode) and to Apple Music via MusicKit (needs Apple Developer membership). Otherwise it just shows "CarPlay audio".

**Sources tile:** CarPlay, Spotify, YT Music, Pandora, Podcasts (in-dashboard RSS player via Podcast Index), Audiobookshelf (from the NAS, cached offline), FM is not available.

**Speakers:** routing is covered under Slate accessories, §5. The head unit's EQ and amp, or the BT transmitter, sit behind the media card's "Output" selector.

### Want 4 — Super clean, customizable look

- **Fully Kiosk Browser** is the **launcher**: no Android chrome, no status bar, auto-restart on crash, screen-off/on on power events, a remote admin API.
- **The dashboard** is the existing prototype (Drive, CarPlay, Control, Truck, Cams, Plan) built as a static PWA:
  - **Widget grid layout** described in JSON (`layout.json`: views → tiles → widget type + props)
  - **Themes** as CSS custom-property tokens (`theme.json`: dark electric blue default; "noon" high-contrast for AZ sun; "night" red-shifted)
  - **Auto theme** by sun elevation (computed from GNSS position, offline)
- **Editing:** in the Hub portal (§8), or on-screen with an "edit layout" long-press. Bundles are versioned and can be rolled back.
- **For other owners:** they get the same bundle format, so they can share layouts and themes as files.

### Want 5 — Inexpensive yet reliable

**Power wiring:**
- **B+** (fused constant 12V) and **ACC** (fused switched 12V) go to the head unit.
- The head unit uses its **sleep / fast-boot** mode: about 2–5 s to the screen [U]. A **deep-off timer** (for example 24 h) protects the 12V battery.
- ACC sources on Slate are **[UNK]**: find a circuit that is live only when the truck is "on". The Accessory Console feed or a 12V outlet circuit are candidates. Measure before tapping.

**Power loss:** head units are built for hard cuts. Settings live in the dashboard bundle, so a factory reset re-pulls the config.

**Heat:** no battery, so nothing to swell. See Reliability & heat, §6.

**Price:** the base build is under $1k, and the parts are commodity, so replacement is cheap.

### Want 6 — Cameras / 360°

- **TEYES 360 AHD kit:** front grille, tailgate/handle area, and two side cameras on brackets under the door mirrors (Slate mirror geometry [UNK]).
- **What the head unit does with it:** stitches a bird's-eye view, records 4-channel DVR, and switches to the **Cams view automatically on the reverse wire**. The reverse signal is tapped from the reverse-lamp feed: reverse lamps are mandatory, and Slate's factory backup camera also proves a reverse signal exists [V Engadget]. Slate's factory 4" cluster backup camera stays untouched as a redundant view.
- **Hitch cam:** an AHD wide-angle camera on the 2" receiver, wired to the head unit's second or front camera input. A Cams-view button and "trailer mode" show it at speed.
- **Turn-signal side views:** possible by tapping the indicator feeds into the AVM's L/R triggers [U].
- **Not recommended:** Wi-Fi/IP cameras (latency, boot time) and USB UVC capture (shares the dongle's USB).

### Want 7 — Web browser

- **Chrome for Android** is installed and reachable from a dashboard tile. Fully Kiosk can also open a whitelisted in-kiosk browser tab.
- **Speed-lockout:** the bridge has GNSS speed. Above 5 mph the browser and video tiles are greyed out. A passenger override needs a long-press [optional].

---

## 5. Slate accessory integration

| Accessory | What it is | Integration | Unknowns |
|---|---|---|---|
| **The Five Switch – Upgrade Version ($39.99)** | A 5-gang switch plate with five covers, designed for Slate's **Accessory Console upgrade (sold separately)**, fits all body styles [V Slate store listing via search]. It is a plate for switches in the Accessory Console, not a standalone controller. | **Mirror (read-only, safe):** each switch's output wire goes into an ESP32 opto input, and the dashboard shows each circuit's live state. **Drive:** a relay wired **in parallel** with the switch on circuits Jeff owns (for example bed lights). Dashboard ON = relay closes; the physical switch still works. Logic is "either one = on". Never interrupt Slate's own wiring. | Whether the Accessory Console provides fused, switched circuits behind the plate, and their current ratings. Slate has not documented this [V slatemod]. Jeff needs to order or confirm the Accessory Console itself. |
| **Bed Light Kit ($139.95)** | 12V bed lighting. Details not published [UNK]. | If it lands on a Five Switch position, that position is mirrored and driven as above. Otherwise its feed goes through an ESP32 relay channel. Dashboard: a Bed Lights tile, plus auto-on when the tailgate is open and it's dark [U: needs a tailgate sensor, e.g. a reed switch on an ESP32 input]. | Connector, current, whether it is switched by the console or by the controller. |
| **Front L+R Integrated Speakers ($149.99)** and **Front Center Integrated Speaker ($249.99)** | Dash speakers. Slate says the truck has **no factory audio system** [V forum relay of a Slate correction]. Engadget says the center is required for the L+R pair [V]; Slate's listing text says L+R can work with or without the center [U]. Members believe they are **Bluetooth** [U]. Amp, input and aux are **undocumented** [V slatemod]. | **Path A (wired input or passive speakers):** head-unit RCA line-out, or its built-in 4-channel amp, goes straight to them. Best quality, no pairing. **Path B (BT-only, most likely):** head units are BT *sinks*, not sources, so add an aptX-LL BT **transmitter** on the head unit's RCA out, permanently paired to the center speaker. Everything (CarPlay, Android apps, nav prompts) plays through it. **Path C:** pair the iPhone directly to the speakers and let CarPlay audio go there. This loses head-unit audio such as dashboard chimes and Android apps. | The single biggest unknown. Inspect the center unit on delivery: aux jack? speaker-level inputs? daisy-chain? |
| **Hands Free Bluetooth Controller (TBD)** | A steering-wheel BT button. It "connects to your device so you can skip songs" and Slate says it "can be programmed to control exterior lights and other add-ons" [V Engadget]. | **Primary:** pair it to the **iPhone**, so media keys control CarPlay audio. If Slate's programmable mode is its own BLE profile, the ESP32 bridge can also listen or pair and map buttons to dashboard actions [UNK]. **Alternative:** pair it to the head unit as a BT HID media remote, if the TEYES stack supports HID host [U]. | Protocol (BT HID vs proprietary BLE), and how "programmable" works (Slate app?). |
| **Tablet Mount (TBD)** | Dash tablet bracket on Slate's interior **T-rails** [V slatemod]. | Publish a 3D-printed adapter plate: Slate mount interface → head-unit screen back. The head-unit "chassis" brain box goes behind or under the dash, out of the sun. **Load test:** the screen plus bracket weighs about 1–1.3 kg [U]. | Mount interface dimensions and load rating [UNK]. Double-DIN/single-DIN fit is reported both ways in the forums [U]. |
| **Classic Level 2 Wall Charger ($479)** | Maker and connectivity not published [UNK]. Slate charges at about 11 kW onboard [U]. | **If it has Wi-Fi or a local API:** HA integration gives session kWh and $ (TOU rate), and the truck shows it. **If it's dumb:** add a CT clamp (Emporia Vue / Shelly EM class, ~$60–80) on its circuit in HA, so sessions are detected by power and kWh is exact. **Either way:** HA → MQTT → truck "Last home charge: 38.2 kWh, $4.71". | Maker, app, OCPP? |
| **2" hitch receiver** | — | Hitch cam (want 6); trailer mode adds a Wh/mi penalty in the range model. | — |
| **Tailgate lock kit, NEXUS tonneau** | — | Optional ESP32 reed switches give "tailgate open / tonneau open" on the Truck view and in HA. No control. | Sensor mounting points. |

---

## 6. Reliability and heat (Phoenix)

- **No battery in the cab.** This is the reason to choose a head unit. The 12V truck battery is Slate's problem and is designed for it.
- **Ratings are unknown.** Head units typically claim -20 to +70 °C operating [U]. A parked Phoenix cab passes that: dash surfaces measured over 80 °C in summer. LCDs can go **temporarily dark** (isotropic transition) and recover as they cool. The electronics survive storage heat far better than lithium.
- **Mitigations:**
  1. A reflective windshield shade every summer park.
  2. The brain box below the dash line, not in sun.
  3. Thermal-limited boot: the bridge reads the ESP32 cab-temperature probe. If the cab is above 65 °C at power-on, the dashboard shows "cooling" with backlight at 50% until the HVAC drops it.
  4. Optional: precondition via Slate's telematics, which would also cool the screen.
  5. Matte film reduces glare and hot-spotting.
- **Brightness:** the weakest point. Mitigations are mount angle (tilt away from the windshield's reflection), the "noon" high-contrast theme, and avoiding mid-grey UI. If it's unreadable after testing, a brighter display is a later swap; the bundle and wiring stay.
- **Power-loss safety:** the dashboard is a static bundle on the device. SQLite runs in WAL mode with an fsync per trip segment, so a hard cut loses at most a few seconds of GPS.
- **Boot path:** ACC on → head unit wakes (sleep mode) → Fully Kiosk as launcher → bridge service starts on boot → dashboard connects within about 5 s. The Autokit dongle reconnects to the iPhone in about 10–20 s [U].
- **Updates:** OTA updates on cheap units can break things. **Freeze** firmware and Autokit versions once stable, and only update with a known rollback. Autokit updates have both broken and fixed things for people [V Trustpilot].
- **Security:** the Hub is behind auth (§8), the truck's MQTT uses per-device credentials, and remote access is over Tailscale. No inbound ports in the truck.

---

## 7. Software stack and customization

| Layer | Choice | Notes |
|---|---|---|
| OS | Head-unit Android (CC3 2K ships Android 10 [U]) | Root not needed. Disable vendor launcher; Fully Kiosk set as default home |
| CarPlay | Carlinkit CPC200-CCPA + **Autokit** APK | Dongle firmware and APK pinned |
| Kiosk / launcher | **Fully Kiosk Browser PLUS** | Remote admin, motion/screen control, JS interface, auto-restart |
| Dashboard | Static **PWA** (TypeScript, Preact or Svelte, no framework lock-in), built from the existing prototype | Reads `layout.json`, `theme.json`, `prefs.json` from the bridge. Offline-first service worker |
| **Slate Bridge** (native, Kotlin) | Foreground service: BLE client to ESP32; WebSocket server on 127.0.0.1; MediaSession listener; GNSS logger; SQLite store; MQTT client (HiveMQ/Paho); Hub sync; reverse/ACC event handling; app intents (open Waze/Autokit/ABRP) | One small open-source APK; the only native code |
| Truck bridge firmware | **ESPHome**-compatible or plain Arduino/ESP-IDF on ESP32-S3 | BLE GATT service (`switches`, `relays`, `can_frames`, `temp`, `vbat`); CAN listen-only |
| Maps in dashboard | MapLibre GL + OSM vector tiles, with an offline Phoenix-region tile pack | Route history and charger map |
| Remote access | **Tailscale** Android app | Reaches HA, MQTT and the Hub on the NAS without exposing them |
| HA | HA Companion app + MQTT discovery | §9 |

**Customization surface:** layout, theme, widgets, charging weights, home Wi-Fi SSID, garage-door automation, speed lockout. All of it is edited in the Hub, shipped to the truck as a **signed, versioned bundle**, and can be rolled back.

---

## 8. Management dashboard (web portal) — want 8

**What it is:** the **"Slate Hub"**, a small self-hostable web app published as a Docker image (one `docker compose up`).
- **For Jeff:** it runs on the Synology as its own container next to his other stacks. It is reached over Tailscale, or published at `slate.example.com` through the existing DSM proxy behind auth. It is kept **separate from WOPR's codebase**, so it can be published, but it **pushes summaries to WOPR** (SoC, trips) through an ingest token.
- **For other owners:** the same image runs on any Docker host (NAS, Pi, mini PC). A **no-server mode** also exists: the bridge app serves the same portal UI locally at `http://<truck-ip>:8080`, reachable from a phone on the same Wi-Fi or hotspot. Config then lives only on the truck. Nobody is forced to host anything.

**Auth:**
- **Users:** passkeys (WebAuthn) plus password fallback, single admin by default, optional TOTP.
- **Truck pairing:** the screen shows a QR or 8-digit code. The Hub issues a per-device token (revocable), and the truck authenticates with it from then on.
- **Secrets:** OAuth refresh tokens and API keys are stored **only in the Hub**, encrypted at rest with a key from an env var. The truck gets short-lived access tokens, or the Hub proxies calls, so a stolen head unit leaks no long-lived credentials. Keys are pasted into the Hub's **settings page**, never into config files.

**Sync without a factory modem:**
1. **Garage Wi-Fi** is the primary channel. When parked at home, the head unit joins the home SSID and syncs everything in bulk: config down; trips, DVR clips (optional), logs up.
2. **The 4G SIM in the head unit**, if fitted: small, frequent syncs (SoC, location, MQTT).
3. **iPhone Personal Hotspot**: the head unit auto-joins it as a known network. It is usable but flaky, because iOS hotspots sleep.

Config is **pull-based**: the truck polls `/api/truck/bundle?since=<version>` when online, and the Hub's "Push to truck" just bumps the version. Telemetry uses a **store-and-forward queue** in SQLite.

**Streaming and account services — what can be linked:**

| Service | Usable API / OAuth? | How it works here |
|---|---|---|
| **Spotify** | Yes, with limits. Web API OAuth works in **development mode (≤25 users per app)**. Extended access since May 2025 needs a registered business with ≥250k MAU [V]. Playlist writes reported 403 in dev mode [U]. | **Each owner registers their own free Spotify developer app** (client ID pasted in the Hub), which suits self-hosting. Gives now-playing, play/pause/skip, device transfer. Playback itself stays in the Spotify app or CarPlay. |
| **Apple Music** | MusicKit (JS/Android) needs a **$99/yr Apple Developer** membership for the developer token [U]. | Optional. Without it, Apple Music plays through CarPlay or the Android Apple Music app, and the dashboard shows "CarPlay audio". |
| **YouTube Music** | **No official API** for playback or library. | Native Android app or CarPlay only. Now-playing comes from MediaSession on Android. |
| **Pandora** | **No public API**. | Android app or CarPlay. |
| **Podcasts** | **Yes**: RSS plus Podcast Index API (free key). | The dashboard has its own podcast player. The subscription list is managed in the Hub and episodes are pre-downloaded on garage Wi-Fi. |
| **Audiobooks** | Audible and Libby: **no public API**. **Audiobookshelf** (self-hosted) has a full REST API. | Audible/Libby through the native app or CarPlay. Audiobookshelf integrated in the dashboard, with offline downloads and progress sync. |
| **Plex / Plexamp** | Plex API with token | Optional Plexamp app; now-playing via MediaSession. |
| **Charging networks** (Tesla, EA, EVgo, ChargePoint) | No consumer APIs for non-Tesla vehicles [U]. | The Hub stores **memberships and preferences** (which networks, member pricing, plan tiers) for the scoring engine, plus deep links to each app. |
| **ABRP** | Telemetry API (free key on request) [V] | Hub stores the user token; the bridge pushes SoC. |
| **Google Places (availability)** | Paid API key | Optional; owner pastes their own key. |
| **HA, MQTT, Traccar** | Tokens / credentials | Per-truck credentials issued by the Hub. |

---

## 9. Home Assistant integration — want 9

**Mechanism:** two channels, chosen for what each does best.
1. **HA Companion app for Android on the head unit.** It gives a `device_tracker` from the head unit's GNSS, phone-style sensors (battery level is meaningless here; network, Wi-Fi SSID, charging=ACC power), notification commands, and HA actionable notifications on screen [V companion docs]. Its offline buffering is **not documented** [V], so it is not trusted for history.
2. **MQTT (Mosquitto on the NAS) from the Slate Bridge**, using **HA MQTT Discovery**, so the truck appears as one HA device "Slate Truck" with:
   - `sensor.slate_soc`, `sensor.slate_est_range`, `binary_sensor.slate_charging`, `sensor.slate_charge_power` (from CAN or the wall-charger CT)
   - `device_tracker.slate` (GPS), `sensor.slate_cab_temp`, `sensor.slate_12v`
   - `switch.slate_bed_lights`, `switch.slate_aux_1..5` (relay outputs); `binary_sensor.slate_switch_1..5` (mirrored Five Switch states)
   - `binary_sensor.slate_tailgate`, `sensor.slate_last_trip_kwh`
   - `camera.slate_*`: **not live off-LAN.** When on home Wi-Fi the bridge can post the latest DVR snapshot via MQTT image or an HA webhook. Live streaming from the truck over 4G is not recommended (data, heat).

   MQTT uses a QoS 1 **persistent session** plus a local outbound queue. Offline messages are stored and replayed with their original timestamps when a link returns, and are posted to HA's history with state timestamps.

**HA controls from the screen:**
- A "Home" view tile set (garage door, gate, porch lights, alarm, house temps) defined in the Hub.
- Calls go to HA's REST API over **Tailscale** (HA is never exposed publicly). A long-lived token is held by the bridge, scoped to an HA user with limited permissions.
- **Garage door on arrival:** a two-trigger automation in HA: the truck's `device_tracker` enters the home zone, or the truck joins the home SSID, AND the truck is moving towards home → open, with a confirm tile on the screen ("Opening garage — cancel 5s").

**Offline behaviour:**
- No 4G and no hotspot → HA tiles show "offline", and no command is queued (a stale garage-open must never fire later).
- On arrival, the home Wi-Fi association is itself the local, internet-free trigger: the head unit reaches HA on the LAN directly.
- Sensor data queues as above.

**Optional:** the ESP32 bridge can also run **ESPHome** and talk to HA natively when the truck is in Wi-Fi range of the house (garage), as a second path that needs no Android.

---

## 10. Route and trip tracking — want 10

**GPS source:**
- **Primary:** the head unit's built-in **GNSS** receiver (GPS/GLONASS/BeiDou typical [U]), roof-adjacent external antenna supplied with the unit.
- **Fallback:** CarPlay sessions don't expose iPhone GPS to Android. If the head unit's fix is poor, the bridge flags low-quality segments.

**Logging:**
- The bridge service records 1 Hz while moving and 0.1 Hz while stopped, into **SQLite on the head unit**: `points(ts, lat, lon, alt, speed, hdop)`.
- **Trips** are segmented by ACC on/off: start/end, distance, duration, average speed, **energy** = ΔSoC × 63 kWh usable (or integrated CAN power if available), Wh/mi, outside temp (if available), charge stops joined to sessions.
- Retention: everything kept locally until synced, then 90 days on the truck.

**Sync home:**
- Points stream (when online) or batch-upload (garage Wi-Fi) to **Traccar** on the NAS (Docker; OsmAnd HTTP protocol). Traccar is open-source and self-hostable, which suits other owners, and it has a web map and trip/stop reports out of the box.
- The Hub also keeps trips in its own SQLite/Postgres for the energy stats Traccar doesn't do.
- Summaries go to WOPR for Jeff: "drove 42 mi, 13.1 kWh, 312 Wh/mi".

**Maps:**
- In the Hub portal: MapLibre with OSM tiles, a heat-map of routes, a trip list with energy, filters (date, Wh/mi, temperature).
- In the truck: a "Trips" card on the Truck view with the last 10 trips and an offline tile pack.
- GPX/GeoJSON export per trip.

**Privacy:** location stays on Jeff's hardware. Other owners self-host or use no-server mode. Nothing goes to third parties except ABRP (opt-in).

---

## 11. Phased build

| Phase | When | Work | Exit test |
|---|---|---|---|
| **0 — Bench** | Now → delivery | Buy the head unit, dongle, ESP32. Power them from a bench PSU. Install Fully Kiosk, Autokit, the bridge skeleton, the dashboard PWA from the prototype. Test CarPlay with Jeff's iPhone. Test BT-transmitter audio. Soak the head unit at 70 °C in an oven or a hot car for boot-time and stability data. | CarPlay up in <20 s from cold; dashboard offline; survives 20 hard power cuts. |
| **1 — Truck survey** | Week 1 of delivery | Find ACC, reverse and constant feeds. Inspect the speaker inputs, Accessory Console wiring, Tablet Mount geometry, any diagnostic port. **CAN sniff**, listen-only. | A written pinout plus the speaker answer (Path A/B/C). |
| **2 — Base install** | Weeks 1–2 | Mount (print adapter), power wiring, audio path, Hub on the NAS, MQTT/HA device, Waze/ABRP, garage Wi-Fi sync, Traccar logging. | 1 week of daily driving with no reboots and no missed trips. |
| **3 — Truck bridge** | Weeks 2–4 | ESP32 inputs for the Five Switch circuits, relays for bed lights, cab temp, tailgate. SoC via CAN if found, otherwise the manual/estimated model. | Dashboard mirrors and drives the lights; HA shows the truck entities. |
| **4 — Cameras** | Weeks 4–6 | 360 kit, hitch cam, reverse trigger, AVM calibration (TEYES calibration mat). | Auto-360 in reverse in <1 s; DVR records. |
| **5 — Charging intelligence** | Weeks 6–8 | AFDC/OCM cache, Google availability (optional), scoring, ABRP telemetry, wall-charger data in HA. | Top-3 suggestions match Jeff's own choice ≥ 80% over a month. |
| **6 — Publish** | After 3 months stable | Repo: STL mount, wiring diagram, bridge APK, ESP32 firmware, Hub Docker image, layout/theme examples, a BOM with alternates, and "no-server mode" docs. | A second owner reproduces it from the docs. |

---

## 12. Risks and unknowns

1. **Slate speaker input is undocumented.** If they are BT-only, audio needs a BT transmitter: slight latency, and pairing can be flaky after deep-off. Mitigation: plan B (transmitter) priced in; inspect on delivery.
2. **SoC access.** No confirmed OBD/CAN or public API. Charging suggestions degrade to estimated SoC until Slate publishes something or CAN reverse-engineering succeeds (listen-only, warranty-safe).
3. **Head-unit brightness in Phoenix sun** (and possible LCD blackout above about 80 °C cab). Mitigation: shade, angle, theme. Worst case, a brighter screen swap later.
4. **Cheap-unit software quality:** vendor OTA, Autokit/dongle firmware regressions, Android 10 age (Chrome and Waze support windows). Pin versions; Carlinkit compatibility is seller-claimed, not certified.
5. **Mount and fit:** Tablet Mount interface, load rating, DIN space all [UNK]. Off-road vibration on a ~1 kg screen. The printed adapter is PC-CF/PA-CF (ASA minimum, never PLA) and gets heat-creep tested (§3a).
6. **ACC source and parasitic drain** on Slate's 12V system [UNK]. Deep-off timer required.
7. **Five Switch / Accessory Console:** may need the separate Console upgrade; circuit ratings unknown.
8. **Hands Free Controller protocol** unknown. It may only talk to Slate's app.
9. **Spotify policy** could tighten further. Dev-mode per-owner apps may be restricted; now-playing then falls back to MediaSession.
10. **Legal / safety:** video/browser while driving. Speed-lockout enabled by default in published builds.

---

## 13. Sources

- Slate store, The Five Switch | Upgrade Version (search-result summary of listing): https://www.slate.auto/en/store/ACCIT008-AC?fromCategoryId=accessories_interior&fromSubcategoryId=accessories_interior_tech
- Slate charging page (NACS, home charging): https://www.slate.auto/en/charging
- Engadget, "The Slate truck is affordable because you have to bring your own tech" (speaker prices, center-required claim, BT steering button programmable for lights, tablet mount sold separately, 4" reverse-camera LCD, $275 telematics): https://www.engadget.com/2244162/the-slate-truck-is-affordable-because-you-have-to-bring-your-own-tech/
- slatemod.com audio guide (speaker amp/input undocumented; Hands Free Controller "coming soon"; T-rails as mount backbone): https://slatemod.com/mods/audio/
- slatemod.com lighting (Five Switch not documented to drive lights): https://slatemod.com/mods/lighting/
- Slate Forums, "Speakers are standard" (Slate correction: no factory audio): https://www.slateforums.com/forum/threads/speakers-are-standard.13104/
- Slate Forums, "Speaker and Infotainment Connectivity" (speakers appear BT): https://www.slateforums.com/forum/threads/speaker-and-infotainment-connectivity.12692
- Slate Forums, "Slate Bluetooth Dash Audio Speakers – Thoughts?" (listing text: L+R independent of center): https://www.slateforums.com/forum/threads/slate-bluetooth-dash-audio-speakers-thoughts.15205/page-2
- Slate Forums, Double-DIN housing thread (DIN fit unconfirmed): https://www.slateforums.com/forum/threads/double-din-radio-housing-for-center-dash-and-dash-speaker-blanks.12686/page-3
- Slate Forums, "Controller Area Network?" (ZEV OBD exemption; CAN claim): https://www.slateforums.com/forum/goto/post?id=221233
- Ranger6G/Slate forum, AUX switch array: https://www.ranger6g.com/forum/threads/12v-accessory-bus-bar-aux-switch-array.19141
- Slate specs (65/63 kWh LFP, ~205 mi est., NACS, 120 kW peak): https://en.wikipedia.org/wiki/Slate_Truck ; https://motorweek.org/this-just-in/slate-truck-price-revealed-battery-uprated/ ; https://theevreport.com/slate-truck-24950-price-and-specs
- Slate Truck / tech coverage: https://techmymoney.com/2026/09/01/slate-truck-skips-built-in-infotainment-for-your-phone/
- Carlinkit Autokit FAQ (Android screens/tablets): https://carlinkitcarplay.com/pages/faq-en-autokit-for-aftermarket-android-screen-cars-version1-0
- Carlinkit blog, CarPlay on Android head unit/tablet: https://carlinkitcarplay.com/blogs/for-models-with-android-head-unit/how-to-use-carplay-on-android-car-stereo-and-android-tablet
- Autokit Trustpilot (firmware regressions/fixes): https://uk.trustpilot.com/review/autokitcarplay.com
- TEYES CC3 2K specs (2000×1200 QLED, 10.36", 4×50 W amp): https://e-katalog.kz/TEYES-CC3-2K-4PLUS32GB-UNIVERSAL-10INCH.htm ; 360 variant: https://www.price.ro/preturi-teyes-cc3-2k-360-toyota-camry-7-usa-2014-2017-6-128gb-10.36-qled-4551390
- Galaxy Tab Active5 Pro (600 nits, hot-swap, No Battery Mode, price): https://www.notebookcheck.net/Samsung-Galaxy-Tab-Active-5-Pro-Rugged-tablet-sports-larger-battery-and-brighter-display.999130.0.html ; https://portal.shi.com/product/50288765/Samsung-Galaxy-Tab-Active5-Pro
- No Battery Mode requires USB-C PD, limits brightness/CPU: https://www.techradar.com/pro/samsung-quietly-launches-galaxy-rugged-tablet-with-a-unique-feature-it-can-run-android-without-a-battery-albeit-for-just-a-short-time-and-connected-to-a-power-source ; RAM POGO dock note: https://rammount.com/products/ram-gds-dock-sam54ncpu
- ATOTO 10" units (~550 nits): https://www.atotodirect.com/products/x10g110e-10inch-single-din-car-stereo
- 360 camera kits and Android compatibility: https://tadibrothers.com/products/360-degree-truck-camera-system-in-3d-for-surround-view-with-dvr-4-cameras ; https://audiotechdirect.com/atd-cam360-full-360-camera-kit-birdseye-panaromic-view-for-android-s10-s9-head-unit-range/ ; https://epi.dometic.com/en/professional/special-vehicle-and-truck-solutions/camera-systems/360-degree-systems/dometic-perfectview-cam360ahd-235720
- Waze EV stations on CarPlay/Android Auto: https://www.phonearena.com/news/waze-ev-charging-stations-android-auto-carplay-cars_id147488 ; https://9to5mac.com/2024/04/08/these-are-the-best-carplay-apps-for-ev-owners/
- NREL AFDC API fields (via altfuelr docs): https://ftp.fau.de/cran/web/packages/altfuelr/refman/altfuelr.html ; official docs: https://developer.nrel.gov/docs/transportation/alt-fuel-stations-v1/
- Google Places EV ConnectorAggregation (availableCount etc.): https://docs.cloud.google.com/nodejs/docs/reference/places/latest/places/protos.google.maps.places.v1.evchargeoptions.iconnectoraggregation
- ABRP / Iternio Telemetry API: https://iternio.com/api ; https://community.home-assistant.io/t/build-rest-command-to-send-data-to-abetterrouteplanner-com/307380
- Spotify extended-access change (May 2025): https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access ; https://dev.to/leemartin/the-state-of-spotify-web-api-report-2025-4gh3 ; https://github.com/spotify/spotify-web-api-ts-sdk/issues/159
- HA Companion app sensors/location: https://companion.home-assistant.io/docs/core/sensors
- Open Charge Map, Podcast Index, Traccar, Audiobookshelf, Fully Kiosk, ESPHome, Tailscale: well-known projects; specific API details cited from general knowledge **[U]** — https://openchargemap.org/site/develop/api , https://podcastindex.org , https://www.traccar.org , https://www.audiobookshelf.org , https://www.fully-kiosk.com , https://esphome.io
