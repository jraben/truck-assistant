# Slate Dash: Raspberry Pi 5 + Carlinkit + 10" touchscreen

*A plan for one path only. Prepared 2026-11-05 for Jeff Raben (Phoenix, AZ). Marks used below: **[V]** = checked against a source listed at the end; **[U]** = unverified, or my inference; **[?]** = genuinely unknown until the truck arrives.*

---

## 1. Summary

A Raspberry Pi 5 sits in a ventilated box under the dash, out of the sun. It runs one **Electron** app full-screen on a **10.1" 1000-nit touchscreen**, and the screen hangs on Slate's Tablet Mount. That one app does four jobs:

- **CarPlay.** The phone runs CarPlay wirelessly into a **Carlinkit CPC200-CCPA** dongle. `node-carplay` (the library under `react-carplay`) decodes the dongle's H.264 video and draws it as one pane of the dashboard. **Waze runs inside CarPlay.**
- **The dashboard itself.** This is the existing prototype (Drive, CarPlay, Control, Truck, Cams, Plan) rebuilt as React views, with widgets and themes driven by a JSON layout file.
- **A web browser,** as an Electron `WebContentsView`. It is locked out while the truck is moving.
- **Truck I/O.** A **CarPiHAT PRO 5** handles ignition-sensed power, safe shutdown, opto-isolated inputs (reverse signal, switch states), a CAN port for read-only sniffing, and a Burr-Brown DAC whose line-out drives an amp into Slate's integrated speakers.

Supporting pieces:

- **Cameras.** A 360° "bird view" ECU stitches four cameras and outputs **one** AHD/CVBS feed. A UVC capture stick turns that into a USB webcam for the Pi. The reverse signal on an opto input switches the screen to the camera.
- **Charging.** Station data comes from **NREL AFDC** and **Open Charge Map**, with amenities from **OpenStreetMap/Overpass**. A scoring service runs on the truck, with an optional cache in WOPR.
- **State of charge.** No Slate API exists, so SoC comes in three ways: (a) a manual/estimated model, (b) the home charger's session energy via HA, and (c) passive CAN, if Slate's bus turns out to be readable.
- **Home link.** A local MQTT broker on the Pi bridges to Jeff's home broker whenever there is a link (garage Wi-Fi or a phone/LTE hotspot). That makes the truck an HA device, and trip logs sync home the same way.

**Cost (parts only, Slate accessories excluded):**

| Build | Cost |
|---|---|
| Base | ~$700 |
| Base + budget 360° cameras | ~$1,050–1,200 |
| Base + Brandmotion SurroundVUE 360 | ~$2,150 |

Details are in §3.

---

## 2. Architecture

```
                         ┌──────────── iPhone (CarPlay: Waze, Music, Podcasts, Phone) ─────────┐
                         │  wireless CarPlay (Wi-Fi + BT)          optional hotspot (USB/BT PAN)│
                         ▼                                                                       │
 ┌───────────────┐  USB  ┌────────────────────────── Raspberry Pi 5 (8 GB) ───────────────────┐  │
 │ Carlinkit     ├──────►│  Electron shell (kiosk, Wayland/cage)                              │◄─┘
 │ CPC200-CCPA   │       │   ├─ Dashboard renderer (React): Drive · CarPlay · Control · Truck │
 └───────────────┘       │   │      · Cams · Plan · Media · Trips · Settings                  │
 ┌───────────────┐  USB  │   ├─ CarPlay pane  ← node-carplay (H.264 → WebCodecs, audio, mic)   │
 │ AHD→UVC stick ├──────►│   ├─ Cams pane     ← V4L2 /dev/video* (getUserMedia)               │
 └──────▲────────┘       │   └─ Browser pane  ← WebContentsView (speed-locked)                │
        │ AHD/CVBS       │  Local services (systemd, Node):                                   │
 ┌──────┴────────┐       │   truckd (GPIO/CAN/relays) · charged (station scoring + cache)     │
 │ 360° ECU +    │       │   tripd (GPS log → SQLite) · mosquitto (bridge) · syncd           │
 │ 4 fisheye cams│       │   Spotify Connect (librespot) · PipeWire audio graph               │
 └──────▲────────┘       └──┬────────┬────────┬──────────┬────────────┬──────────────┬────────┘
        │ reverse trigger   │HDMI    │USB     │ GPIO HAT │ BT         │ USB          │ Wi-Fi
        │                   ▼        ▼        ▼          ▼            ▼              ▼
        │           10.1" 1000-nit  USB GPS  CarPiHAT PRO 5          Hands-Free BT   home Wi-Fi /
        │           touchscreen     (u-blox  ├ ignition sense/       controller      hotspot →
        │           on Slate Tablet  M8/M10) │  safe shutdown (5 A)  (HID/AVRCP)     Tailscale →
        │           Mount                    ├ opto inputs ◄── reverse lamp, Five   WOPR / HA /
        │                                    │   Switch outputs (mirror)             NAS
        └──────────── reverse lamp 12V ──────┤ CAN (read-only sniff, OBD/IP bus [?])
                                             ├ 12V outputs / relay board → bed light (opt.)
                                             └ DAC line-out → 4-ch Class-D amp → Slate L/R + Center speakers [?]
 12V: constant + ignition feed (fused) → CarPiHAT → Pi 5 V/5 A;  separate 12V→12V/5V buck for screen
```

**Data flow home:**

```
Pi mosquitto ──bridge (queued, persistent)──► home Mosquitto ──► HA (MQTT discovery: device "Slate")
tripd SQLite ──rsync/HTTPS when online──► NAS (Synology) ──► WOPR (/trips page, primer)
Mgmt portal (NAS-hosted, or the Pi's own web UI) ──signed config JSON──► Pi pulls on connect
```

---

## 3. Parts list

Prices are approximate US street prices as of November 2026.

### Base build

| # | Part | Why | ~Price |
|---|---|---|---|
| 1 | Raspberry Pi 5, 8 GB | Compute, dual HDMI, PCIe, RTC | $95 [U: Pi prices rose in 2025–26; check] |
| 2 | Official Pi 5 Active Cooler + aluminium heatsink case top | Phoenix heat | $5 + $20 |
| 3 | **CarPiHAT PRO 5** | 12V→5V 5A, ignition-sensed safe shutdown, <1 mA off draw, CAN, opto inputs, Burr-Brown DAC | ~$140 (£110 at The Pi Hut) [V] |
| 4 | **Carlinkit CPC200-CCPA** | Wireless CarPlay/AA; the dongle `react-carplay` / `node-carplay` supports | ~$40–55 (€35–50 in EU listings) [V] |
| 5 | **10.1" 1280×800 900–1000-nit PCAP HDMI display** (Orient Display RPi TFT, or equivalent) | Readable in Arizona sun | ~$180–250 [V for 10.1"; 11.6/13.3" at 1000 nit not found] |
| 6 | Industrial / high-endurance microSD 64 GB (e.g. SanDisk Industrial or Samsung PRO Endurance) | Boot medium, read-only root | $15–25 |
| 7 | USB 3 SSD 256 GB (small, heat-tolerant) | Trip DB, media cache, logs | $35 |
| 8 | USB GPS: u-blox M8/M10 puck with magnetic base | Location, speed, trip logs | $20–35 |
| 9 | USB mic (lavalier or small array) | Siri / calls through CarPlay | $15 |
| 10 | Compact 4-channel Class-D car amp (~50 W×4) | Drives Slate's passive speakers, *if* they are passive [?] | $100–180 |
| 11 | 12V buck for the screen, fuse taps, Add-a-Circuit, Deutsch/WAGO connectors, 18 AWG wire, loom | Clean, serviceable wiring | $50 |
| 12 | Vented ABS/aluminium enclosure under the dash/seat, plus a 40 mm 12V fan | Keeps the Pi out of the sun | $25 |
| | **Base total** | | **≈ $700** (≈ $560 if the speakers turn out to be Bluetooth and need no amp) |

**Optional:**

- 4G LTE USB modem or a GL.iNet travel router, ~$60–90 plus $10–25/month for a data SIM. This gives the truck its own internet so it does not depend on the phone hotspot.
- Small relay board (4–8 ch, 12V automotive), $20, to drive the bed light or aux loads from the screen.

### Camera add-ons

| Tier | Parts | ~Price | Notes |
|---|---|---|---|
| A. Rear + hitch | AHD 1080p rear cam (CVBS/AHD switchable) + second hitch-angle cam + 2× AHD→UVC USB sticks | $20–40 per cam + $25–40 per stick ≈ **$120** | Easiest. The rear cam triggers on reverse. [V: AHD/UVC sticks exist; Linux works because they are UVC class] |
| B. Budget 360° | Universal "360 bird view" kit: 4 fisheye AHD cams + stitching ECU with AHD/CVBS out and a reverse/turn trigger, + 1 AHD→UVC stick | **$300–500** [U: AliExpress/Amazon kits made for Android head units; confirm the output format before buying] | Recommended. The ECU does the stitching, so the Pi just shows one video feed. |
| C. Premium 360° | **Brandmotion SurroundVUE 360 (BM99SR)**, 4 AHD cams, includes its own monitor | **$1,280–1,410** [V] | Better calibration and support. Confirm the ECU has a video *out* to feed the capture stick [U]. |

| Build | Total |
|---|---|
| Base + Tier A | ≈ $820 |
| **Base + Tier B (recommended)** | **≈ $1,050–1,200** |
| Base + Tier C | ≈ $2,150 |

Slate accessories Jeff already ordered are **not** included in these totals: Five Switch $39.99, Bed Light Kit $139.95, L+R speakers $149.99, Center speaker $249.99, Tablet Mount and Hands-Free controller (both TBD), charger $479.

---

## 4. How each want is met

### Want 1: Charge info and where-to-charge suggestions

**How SoC gets in** (in order of reliability):

1. **Energy model plus manual anchor (works day one).**
   - Jeff sets SoC with a big slider at key-on, or the system carries it forward from the last known value.
   - `tripd` subtracts energy as he drives: distance from GPS × a Wh/mi figure learned per trip, adjusted for speed and outside temperature.
   - Pack size is configurable. Current reporting says Slate moved to a **65 kWh LFP pack (~205 mi)**; earlier specs were 52.7/84.3 kWh [V, secondary sources].
2. **Home charger session energy.** If the "Classic Level 2 Wall Charger" ($479) is the **Emporia Classic NACS 48A** that Treehouse (Slate's install partner) lists at exactly $479 [U: inferred, not confirmed by Slate], HA can read its session kWh through the community Emporia EV Charger HACS integration (cloud) [V exists; model coverage U]. The kWh added, times charging efficiency, re-anchors SoC after every home charge.
3. **Passive CAN read [?].**
   - The CarPiHAT's CAN port goes on the OBD-II connector, if Slate has one. Use `candump` with **listen-only mode** (`ip link set can0 type can bitrate 500000 listen-only on`).
   - Look for a frame that tracks SoC (it rises while charging and falls while driving).
   - Nothing is ever transmitted. If the bus is gated, or there is no OBD port, fall back to 1 and 2.
4. **Slate's own app.** It shows charge status and battery health, and works only near the truck [V]. There is no API, so it is not a source. Re-check when it ships late 2026.

**Station data:**

- **NREL AFDC Alt Fuel Stations API** (`developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json`, free key) [V]. Filter `fuel_type=ELEC`, `ev_connector_type=J3400,TESLA,J1772COMBO`, then use `ev_network`, `ev_dc_fast_num`, `ev_pricing`, `access_days_time` and `date_last_confirmed`. The data is DOE-maintained and updated daily.
- **Open Charge Map API v3** (`api.openchargemap.io/v3/poi`, free key; attribution required on screen) [V]. Gives per-connector **kW**, `UsageCost` text and operator. It also fills gaps AFDC misses.
- **Amenities:** the **OpenStreetMap Overpass API**, counting restrooms, food, coffee, groceries and shade within 300 m of a charger. It is free, and the Pi can cache Arizona/Southwest extracts offline.
- **PlugShare:** no public API; data is licensed commercially [U]. The plan uses a **deep link** to open a station in the PlugShare app on the phone for check-ins and reviews, and does not scrape it.
- **Tesla Superchargers:** the truck is NACS, so Superchargers are accessible [V]. Locations come from AFDC/OCM (`ev_network=Tesla`). Live pricing and stall availability have no public API [U]. Show "open in Tesla app" instead.

**Suggestions (`charged` service):**

- Score each station 0–100 with weights set in the management portal:
  - network preference (e.g. Tesla > Electrify America > others)
  - speed matched to the truck's ~120 kW DC peak [V]: a 350 kW stall earns nothing over a 150 kW one
  - price (`ev_pricing` / `UsageCost` text parsed to $/kWh where possible)
  - amenities
  - detour minutes (OSRM, or straight-line distance)
  - reliability (`date_last_confirmed`, OCM status)
  - **heat**: covered or shaded parking from OSM `covered=yes` gets a bonus in summer
- Output on the **Plan** view:
  - "Charge at X, arrive with ~22%, 18 min to 80%"
  - the top 3 alternatives
  - stats: kWh and $ per month, home vs public split, average $/kWh, cost per mile
- **Waze hand-off:** tapping "Go" sends a `https://waze.com/ul?ll=LAT,LON&navigate=yes` link to the phone as an HA companion-app push with a URL action. One tap on the phone opens Waze, and the route appears in the CarPlay pane. The dashboard cannot launch phone apps directly through the dongle [U, CarPlay host limitation].

### Want 2: Waze

- Waze runs **on the phone, inside CarPlay**, and is shown in the CarPlay pane full-screen, or split with a widget rail in "Drive" layout.
- Turn-by-turn audio comes through the dongle → PipeWire → amp. Waze ducks music natively.
- Known issue: some users report Waze crash/reboot loops on CarPlay dongles when a music app starts at the same moment [V, forum anecdotes]. Mitigations:
  - keep the dongle firmware current
  - don't auto-launch Waze and music together
  - test before relying on it
- There is no Waze API for live ETA. The dashboard shows its own GPS speed and heading beside the CarPlay pane.

### Want 3: Media dashboard

**Sources:**

- **CarPlay audio** (Apple Music, Spotify, Pandora, podcasts, Audible) arrives over USB from the dongle. `node-carplay` exposes the media-metadata messages the dongle sends (title, artist, album art) [U: verify the message coverage in node-carplay source]. These feed a native "Now Playing" card even when the CarPlay pane is hidden.
- **Spotify Connect receiver** on the Pi (`librespot`/raspotify). The truck appears as a "Slate" speaker; Premium is required.
- **Plexamp / Plex** and the **KJEF** stream from Jeff's NAS/NOMAD over Tailscale when online, and **local files** on the SSD (synced at home) when offline.
- **Audiobookshelf** (self-hosted) for audiobooks with resume position.

**Controls:**

- On screen: play/pause, skip, a source switcher, volume and ducking.
- A **speaker-zone slider** for L/R vs Center, using PipeWire filter-chain channel mixing.
- The Bluetooth hands-free controller's buttons are mapped into the same actions.

**To the speakers:** see §5. DAC line-out → amp → Slate L/R + Center, or Pi Bluetooth A2DP out if Slate's speakers are Bluetooth.

### Want 4: Clean, customizable look

- One `layout.json` per profile: a grid of widget slots per view, the widget ids, and a theme token set (colours, font scale, radius, day/night).
- An on-screen **Edit mode** (drag, resize, add/remove), the same pattern as the WOPR V3 dashboard's movable boxes.
- Themes: Night (OLED-black), Day (high contrast for 1000-nit sun), and an "Electric Blue" WOPR theme. Automatic day/night switching from GPS sunrise/sunset.
- Touch targets ≥ 64 px, at most 3 widgets visible while moving, and CarPlay always one tap away.
- Layouts are editable from the management portal (Want 8) and pushed to the truck.

### Want 5: Inexpensive yet reliable

| Risk | Mitigation |
|---|---|
| **Boot time** (cold boot to dashboard ~15–25 s [U]) | Lean Raspberry Pi OS Lite + cage + Electron. Disable unused services, splash screen from initramfs. **Delayed shutdown:** CarPiHAT keeps the Pi up 20–30 min after ignition-off (configurable), so short stops resume instantly. CarPlay reconnect adds ~5–10 s after boot [U]. |
| **Power loss / corruption** | CarPiHAT's ignition sense + hold-up gives a clean shutdown. **Read-only root (overlayfs)**; writable data only on the SSD with ext4 `data=journal` or SQLite WAL. Industrial microSD. |
| **Heat** | See §6. The Pi is never on the dash. A temperature gate refuses to boot hot and runs the fan first. |
| **Vibration** | Board standoffs with nylock nuts, locking connectors, strain relief, USB cables zip-tied with service loops, conformal coat optional. Screen on the Slate mount with foam isolation. |
| **Single-supplier risk** | Carlinkit CCPA is a commodity (~$40); keep a spare. A Pi 5 is replaceable in minutes with a pre-imaged SD card. |
| **Software drift** | Pin `node-carplay` versions. Repo activity on `react-carplay` is unclear (no dated releases visible) [U]. Vendor the library and pin it so the build does not break on a dongle firmware change. |

### Want 6: Cameras and 360° view

- **Recommended: Tier B budget 360° kit.**
  - Four 170–190° fisheye AHD cams: front grille/bumper, rear (tailgate or hitch area), and under each mirror. Slate's mirrors are basic, so use small bracket mounts on the door-front panels [?].
  - The stitching ECU produces the bird's-eye-plus-side split image and has **reverse** and **turn** trigger inputs.
  - ECU AHD/CVBS out → AHD→UVC USB stick → Pi `/dev/video0` → **Cams** view (`getUserMedia`, <150 ms latency [U]).
- **Auto rear cam on reverse.** Tap the reverse lamp feed (12V when in R) into:
  - (a) the 360 ECU's reverse trigger, so it switches to the rear+bird view, and
  - (b) a CarPiHAT opto input. `truckd` sees it and the Electron app brings Cams to the front over everything, including CarPlay, with guide lines as an overlay. It returns to the last view 3 s after leaving R.
  - **Caveat:** during the ~20 s cold boot there is no picture. Delayed shutdown makes this rare. A dedicated rear-cam monitor is the only true cold-boot answer; not in this path's base.
- **Hitch:** the 360 rear cam, or a dedicated **hitch cam** (Tier A cam angled down at the ball) on a separate UVC stick, selectable in Cams for hooking up a trailer.
- **Premium:** Brandmotion SurroundVUE 360 BM99SR (~$1,408) [V] if the budget kit's calibration is poor; verify video-out first [U].
- **USB bandwidth:** two UVC AHD sticks plus the dongle fit on the Pi 5's two USB 3 ports (use a powered hub if adding more). Never route four separate 1080p cams into the Pi; stitching on the Pi is CPU-heavy and fragile. The ECU approach exists to avoid that.

### Want 7: Web browser

- An Electron **`WebContentsView`** in the Browser tab: a real Chromium tab with an address bar, bookmarks (from the portal) and an on-screen keyboard (`squeekboard` or a built-in React keyboard).
- It ignores `X-Frame-Options`, so sites that refuse iframes still load.
- **Lockout:** GPS speed > 5 mph hides the browser (shows "Parked only"), except whitelisted pages such as WOPR `/m` voice.
- Widevine for DRM sites: Raspberry Pi OS ships `libwidevinecdm0` for Chromium [U for Electron; may need a castLabs Electron build].

---

## 5. Slate accessory integration

| Accessory | What it is (known) | How it integrates | Unknowns |
|---|---|---|---|
| **The Five Switch, Upgrade Version ($39.99)** | Slate store item under Interior › Tech. Works with the **Accessory Console** upgrade, sold separately. Standard and Upgrade versions exist; install rated Advanced [V via SlateMod / store listing]. Forum images show AUX buttons over the HVAC panel [V forum]. Slate has **not** documented what it drives or how it is wired [V]. | **Mirror first:** tap each switch's output (or its relay coil) into a CarPiHAT opto input (or an 8-ch opto board) so the Control view shows live on/off. **Drive (phase 2):** only if outputs are plain 12V circuits. Wire an automotive relay in parallel per circuit, driven by the relay board, with logic "physical switch OR screen". Never fight a latched switch. If the panel turns out to be LIN/CAN, sniff it read-only and mirror only. | Switch type (latching rocker vs momentary), circuits and amperage, whether it ties into Slate's body controller, what "Upgrade" adds (backlight? more amps?). |
| **Bed Light Kit ($139.95)** | Lighting kit; install rated Advanced; power and switching not documented [V]. | If it lands on a Five Switch channel → mirrored and driven as above. If standalone → relay output from the Pi. Extras: auto-on when a tailgate reed switch opens after dark, auto-off after 10 min, and an HA entity `switch.slate_bed_light`. | Power draw; whether it is switched by Slate's own harness. |
| **Front L+R speakers ($149.99) + Front Center speaker ($249.99)** | Integrated in the instrument panel [V]. Slate says the truck has **no factory audio system** [V, Slate rep via forum]. Forum users believe they are "Bluetooth only" [U]. A claimed 25 W amp in a sound-bar option is unconfirmed [U]. | **Case A, Bluetooth speakers with a built-in amp:** the Pi pairs as an A2DP **source** (PipeWire/BlueZ). CarPlay audio and the media sources go out over Bluetooth. Note BT latency (~150–250 ms) on video; the Waze voice is fine. **Case B, passive speakers with a harness:** CarPiHAT DAC line-out → 4-ch Class-D amp (ch1/2 L/R, ch3/4 bridged or Center) on an ignition-switched feed. Best quality and no pairing step. **Case C, powered speakers with an AUX/line input:** DAC → line in. | **Which case.** Check the speaker harness and the install sheet at delivery: count pins, measure impedance (~4 Ω = passive), look for a BT module. |
| **Hands-Free Bluetooth Controller (TBD)** | Listed "coming soon", no specs [V]. Catalog phrasing suggests steering-wheel Bluetooth controls [V forum]. | **If it is a BT HID/AVRCP remote:** pair to the **Pi** (BlueZ). `truckd` maps keycodes → next/prev/play/volume → node-carplay key commands (incl. a Siri hold) or librespot/PipeWire. **If it is a hands-free kit with its own mic and speaker:** pair it to the **phone** instead, and accept that it will compete with CarPlay for call audio. Do not use it for calls; CarPlay already handles them. | Profile (HID vs AVRCP vs HFP), pairing limits, power (coin cell vs 12V). |
| **Tablet Mount (TBD)** | Unpriced, no size limits published [V]. The truck is designed for a phone or tablet on a dash bracket with charging [V]. | Build the 10.1" display into a **tablet-shaped back-shell** (3D-printed PETG-CF or ASA, which is heat-resistant). Size it to the mount's clamp range, presumably iPad-class ~10–11". Leave a single cable (HDMI + USB touch + 12V/5V) down through the mount's charging-cable path. | Clamp dims, whether it carries power (USB-C PD?), vibration rating. **Do not buy a 13.3" panel until the mount's limit is known.** |
| **Classic L2 Wall Charger ($479)** | Likely the Emporia Classic NACS 48A via Treehouse [U]. | HA (Emporia HACS, cloud) → session kWh / state → MQTT → truck SoC re-anchor and charging stats. Off-peak scheduling (APS/SRP TOU) from HA, shown on the Truck view. | Exact model; whether a local API exists. |
| **2" hitch receiver** | Mechanical. | Hitch cam (Tier A) and a "Towing" layout that raises the energy-model Wh/mi. | None. |
| **Tailgate lock kit, NEXUS tonneau** | Mechanical. | Optional reed switches → opto inputs → "tailgate open / tonneau open" in the Truck view and HA, and a bed-light trigger. | Not wired by Slate [U]. |

**12V sourcing:** Slate's dash has USB and 12V ports, and reportedly **pre-wiring for a double-DIN location** [U, forum, secondhand]. Some outlets may lack constant power [U]. Plan for:

- one fused **constant** feed (Pi hold-up and delayed shutdown) and one **ignition/accessory** sense line, both taken from the fuse box or Accessory Console circuits
- the CarPiHAT draws <1 mA when off [V]
- the 12V supply in an EV is a DC-DC-maintained LV battery [U], so measure parasitic draw on the first install

---

## 6. Reliability and heat (Phoenix)

**What we're up against:**

- The Pi 5 soft-throttles at 80 °C SoC and hard-throttles at 85 °C, and idles around 65 °C on an open bench with no cooling [V].
- Its rated ambient is commonly cited as 0–50 °C [U; confirm in the product brief].
- Parked Phoenix cabins reach 60–75 °C air and 85–95 °C dash surfaces [U, general data].
- Consumer LCD panels are typically rated 0–50 °C operating and -20–60/70 °C storage [U per panel datasheet].

**Rules:**

1. **The Pi is never on the dash.** It lives in a vented box under the dash or seat, in the shaded footwell, near the HVAC ducting if reachable. Only the screen is in the sun.
2. **No running while parked hot.** The delayed-shutdown timer is capped by temperature: if the cabin sensor reads > 45 °C after ignition-off, shut down now. Never leave the system "on" in a sealed parked truck.
3. **Boot gate.** At key-on, `truckd` reads the SoC temperature. If it is > 70 °C, it runs the fan at 100% and shows a "cooling" splash on a dimmed panel until it falls below 65 °C, then starts Electron. Run CPU governor `ondemand`, cap at 2.0 GHz, and make sure the GPU decode path (H.264) is in use so the CPU stays low.
4. **Screen.** Choose a panel with a **wide-temp** spec (storage ≥ 80 °C) if Orient/Beetronics offer one [U]. Sunshade it when parked: fold-down, or a reflective windshield shade, which is free and the biggest single win. Auto-brightness from a light sensor (BH1750 on I²C, $3) keeps panel heat down at night.
5. **Storage.** Read-only root on the industrial microSD. Writes go only to the SSD, which is in the shaded box. SQLite in WAL mode, `fsync` on trip end.
6. **Watchdog.** Use the Pi hardware watchdog plus systemd `Restart=always` on every service. `node-carplay` reconnects automatically on dongle unplug/replug [U]. If the dongle wedges, power-cycle its USB port via `uhubctl`.
7. **Field log.** Temperatures, throttling flags (`vcgencmd get_throttled`), boot time and CarPlay connect time go to MQTT, so HA can graph whether summer is actually survivable. This is a measured answer, not a hoped-for one.

---

## 7. Software stack and customization

| Layer | Choice |
|---|---|
| OS | Raspberry Pi OS Lite 64-bit (Bookworm/Trixie), overlayfs root, `cage` Wayland kiosk compositor |
| Shell | **Electron** (as `react-carplay` uses), one window, React renderer |
| CarPlay | `node-carplay` (vendored, pinned), CPC200-CCPA; H.264 via WebCodecs/hardware decode; configurable resolution (up to 1080p60 claimed) [V] |
| Audio | PipeWire + WirePlumber: CarPlay, librespot, Plexamp/web and Waze prompts into a mixer, then to the DAC (or BT A2DP sink); ducking rules |
| Truck I/O | `truckd` (Node + `onoff`/`libgpiod`, SocketCAN listen-only, relay board over I²C/GPIO) publishes to MQTT |
| Charging | `charged` (Node) for AFDC + OCM + Overpass, scoring, and a SQLite cache along common routes (pre-fetched at home) |
| Trips | `tripd` (gpsd → SQLite/SpatiaLite) — see Want 10 |
| Messaging | Mosquitto (local) with a bridge to home |
| Remote access | Tailscale (the Pi joins Jeff's tailnet; ssh/updates when online) |
| Updates | Signed release tarballs or an A/B image (RAUC [U]); updates only apply on garage Wi-Fi |
| Customization | `layout.json` + `theme.json` + `widgets/` plugin folder (each widget is an ES module with a manifest: data topics it subscribes to, size classes, settings schema). Publishable: other owners add widgets without forking. |

**Reproducibility for other Slate owners:**

- One GitHub repo and a `pi-gen` stage that builds a flashable image.
- A BOM with links, a wiring diagram, 3D-print files for the tablet back-shell and Pi box, and a **first-boot wizard**: Wi-Fi, pack size, speaker case A/B/C, camera tier, HA/MQTT optional.
- Everything Jeff-specific (WOPR, NAS, KJEF) is an **optional plugin**, off by default.

---

## 8. Want 8: Web management portal

**What it does:**

- Edit layouts and themes (a drag-and-drop preview of the truck screen).
- Charging preferences: weights, preferred and blocked networks, amenity priorities.
- Media accounts.
- HA/MQTT settings.
- Camera tier and calibration notes.
- Relay names for the Five Switch channels.
- The trips viewer (Want 10).
- Software updates and logs/health (temps, boot times, throttling).

**Where it runs (two modes, same code):**

1. **On the truck itself (always available).** `truckd` serves the portal at `http://slate.local:8080`.
   - Reach it from a phone on the same hotspot, or from a PC on garage Wi-Fi, or over Tailscale.
   - Every owner gets this with zero hosting, which is the default for the published project.
2. **Self-hosted "home" copy (optional).** A Docker container on a NAS or home server (for Jeff: Synology, next to WOPR, e.g. `slate.example.com` behind the same DSM proxy, or LAN/Tailscale only).
   - Lets him edit while the truck is off.
   - Holds a **desired-state config** that the truck pulls on its next connection.

**Auth:**

- On-truck portal: a **local admin passcode** set in the first-boot wizard (argon2-hashed), plus a **QR pairing code** shown on the truck screen to bind a phone. A session cookie, then HTTPS via Tailscale certs (`tailscale cert`) or a self-signed cert on LAN.
- Home portal: OIDC/passkey login (Authentik/Authelia or simple passkeys). For Jeff, it sits behind WOPR's existing `APP_PASSWORD` gate.
- The truck ↔ home link uses a **device keypair**. The truck pulls `config.json` signed by the portal's key and verifies it before applying, so a portal outage or a man-in-the-middle cannot push config.
- Tokens are kept **encrypted on the truck's SSD** (key in a root-only file on the RO image's sealed partition [U, simple file-key, not TPM — the Pi has none]). Keys are entered in the portal UI, never in config files, matching Jeff's /admin rule.

**Syncing without a modem:**

- **Garage Wi-Fi:** the Pi's Wi-Fi client joins home Wi-Fi when the truck is parked within range. `syncd` then:
  - pulls config and updates
  - pushes trips and logs
  - pre-fetches the charger cache and offline media
  - flushes the queued MQTT bridge
- **Phone hotspot on the road:** wireless CarPlay occupies the iPhone's Wi-Fi for the dongle link, so a Wi-Fi hotspot to the Pi is not reliable alongside it [U; test]. Options:
  - (a) **USB tethering:** plug the phone into the Pi (it charges too); iPhone tethering works on Linux via `ipheth`. This forces wired, not wireless, CarPlay via the dongle [U].
  - (b) **Bluetooth PAN tether:** slow (~1–2 Mbps) but enough for MQTT, charger queries and config.
  - (c) The optional **LTE USB modem** ($60 + plan): simplest and always on.
- Everything is **offline-first**: the screen never waits on the network. Charger results come from cache, and are refreshed when online.

**Streaming services: what has a usable API/OAuth vs CarPlay-only:**

| Service | Usable on the Pi directly? | How |
|---|---|---|
| **Spotify** | **Yes, playback.** Control API is limited. | `librespot` Spotify Connect receiver (Premium; the truck shows as a speaker, controlled from any Spotify app). Web API OAuth for "now playing" and library is possible, but Development Mode apps are now capped at **5 users** and Premium is required for the developer; extended quota needs a registered business with 250k MAU [V]. So a published project gives **each owner their own Client ID** (the portal walks them through it). |
| **Apple Music** | Partly | MusicKit JS needs an Apple Developer token ($99/yr) and Widevine/FairPlay in Electron [U]. Realistically **CarPlay-only**: the native app via the dongle. Now-playing metadata still shows via CarPlay. |
| **YouTube Music** | No official API | **CarPlay-only** (or the browser pane, parked). |
| **Pandora** | No public API | **CarPlay-only.** |
| **Podcasts** | **Yes** | RSS + **Podcast Index API** (free key) in a built-in podcast widget with downloads at home. Apple Podcasts/Overcast via CarPlay too. |
| **Audiobooks** | Audible/Libby: no API → **CarPlay-only**. Self-hosted **Audiobookshelf**: **yes** (REST API + token) | |
| **Plex/Plexamp (Jeff)** | Yes | Plex token over Tailscale; downloads cached at home. |
| **Charging networks** | Mostly no consumer APIs (Tesla, Electrify America, ChargePoint, EVgo) [U] | The portal stores **membership flags only** (which apps or plans you have) to drive scoring and "open in X app" deep links. No credentials are stored. |

---

## 9. Want 9: Home Assistant integration

**Mechanism: MQTT with HA MQTT Discovery.**

- The Pi runs Mosquitto and publishes `homeassistant/<component>/slate/<object>/config` discovery messages. HA then creates a **device "Slate Truck"** with these entities:
  - `sensor.slate_soc` (%), `sensor.slate_range_est`, `sensor.slate_energy_today`
  - `binary_sensor.slate_charging` (from the Emporia session / CAN [?]), `binary_sensor.slate_ignition`, `binary_sensor.slate_reverse`, `binary_sensor.slate_tailgate`
  - `device_tracker.slate` (GPS lat/lon/accuracy; MQTT JSON tracker style [V])
  - `sensor.slate_cabin_temp`, `sensor.slate_pi_temp`, `binary_sensor.slate_throttled`
  - `switch.slate_bed_light`, `switch.slate_aux_1..5` (relay outputs, or mirror-only binary sensors)
  - `camera.slate_cams`: the Pi serves an MJPEG/snapshot of the current UVC feed (only while awake); `image.slate_last_parked` is a snapshot taken at ignition-off.
- **Bridge:** the local Mosquitto `connection home` bridge to Jeff's home broker over Tailscale, with `cleansession false`, `queue_qos0_messages true` and persistence on. Retained state plus queued events are **stored and forwarded** when the link returns. HA sees `availability` = offline while away, and does not show stale "on" states as live (last-will message).
- **Offline behaviour:** the truck works entirely standalone. HA controls show "needs connection" when the bridge is down, never a silent no-op.

**HA controls from the screen (the Control view):**

- The truck subscribes to `slate/cmd/#` responses and calls HA through **HA's REST API** with a **long-lived access token** entered in the portal (stored encrypted), or through MQTT command topics that an HA automation handles. The second is simpler for other owners: no token needed on the truck.
- **Garage door on arrival:** a geofence in `tripd` triggers when within 150 m of home, heading home, and ignition on → publish `slate/event/arriving`. An HA automation opens the garage (with a confirm tap on screen by default). This also works with no internet: when the truck reaches garage Wi-Fi range, the bridge connects over LAN and the event flushes. Fallback: a direct HA call over home Wi-Fi.
- Other tiles: lights, gate code lookup via WOPR `/api/where` (Jeff plugin, LAN/Tailscale only), house alarm state, "pre-cool the house" when 20 min out.
- **Not used: the HA companion-app API (mobile_app webhook).** It assumes an always-online phone-like device. MQTT handles intermittent links better.

---

## 10. Want 10: Route and trip tracking

**GPS hardware:**

- **u-blox M8N/M10 USB puck** with an external magnetic antenna under the windshield cowl or on the roof cap: 10 Hz capable, ~2.5 m CEP [U typical].
- `gpsd` feeds `tripd`. The Pi 5's built-in RTC (add the $5 coin cell) keeps time before a GPS fix.

**Trip logic:**

- Ignition-on starts a trip; ignition-off + 2 min ends it.
- Log 1 Hz points (lat, lon, speed, heading, alt, accuracy), plus `est_energy`, SoC (model/CAN), outside/cabin temp, and towing flag.
- Douglas-Peucker simplification on close.

**Per-trip stats:**

- distance, duration, average/max speed
- **kWh used and Wh/mi** (energy model, or CAN delta when available)
- SoC start/end, cost (home $/kWh by TOU period, or public session cost entered or estimated)
- charging stops (a dwell at a known charger + SoC rise)

**Storage:**

- **SQLite + SpatiaLite** on the USB SSD (`/data/trips.db`): ~50 KB/hour at 1 Hz, so a year is well under 1 GB.
- Read-only root keeps the OS safe. WAL mode plus `fsync` at trip end means a power cut loses at most the last few seconds.

**Sync home:**

- On garage Wi-Fi or tether, `syncd` pushes new trips as **GeoJSON + summary rows** over HTTPS to the home portal (or `rsync` over Tailscale to the NAS), using an idempotent key (trip UUID) so retries never duplicate.
- Jeff's WOPR can read the NAS copy for a `/trips` page and add "last trip / this week's energy" to its primer (optional plugin).

**Map of routes:**

- **On the truck:** MapLibre GL with **offline vector tiles** (Protomaps PMTiles extract for Arizona/Southwest, ~1–2 GB on the SSD). Shows the trip list, a heat-map of routes and a colour-by-efficiency line.
- **At home:** the same MapLibre view in the portal, with online tiles.
- Privacy: trips stay on the truck and Jeff's NAS only. The published project never sends location anywhere by default. "Home" is a configurable privacy zone that is trimmed from shared exports.

---

## 11. Phased build

| Phase | When | Work | Done when |
|---|---|---|---|
| **0. Bench** | Now (pre-delivery) | Pi 5 + CarPiHAT + CCPA + 10.1" panel on the desk. Image builds, Electron shell, CarPlay pane with Waze, media card, layout editor, AFDC/OCM scoring, trips with a USB GPS on a walk/drive in another car. Portal on-truck mode. | CarPlay + Waze stable 1 hour; cold boot < 25 s; charger plan returns sane picks around Phoenix. |
| **1. Heat test** | Pre-delivery, Phoenix summer-like | Pi box + screen in a parked car for a week, temperature logging, boot-gate tuning. | No hard throttle while driving; clean recovery after a hot soak. |
| **2. Install (delivery)** | Late 2026 | Identify the speaker case (A/B/C), Tablet Mount dims, 12V constant/ignition sources, OBD port presence. Wire power, screen, speakers/amp, reverse tap, GPS antenna. | Daily driver: CarPlay audio through Slate speakers; reverse → Cams. |
| **3. Truck I/O** | +2–4 weeks | Five Switch mirror (opto inputs), bed light relay, tailgate reed, passive CAN sniff for SoC. | Control view reflects physical switches; SoC source chosen. |
| **4. Cameras** | +1 month | Tier B 360 kit, calibration, hitch cam. | Bird view on reverse within 300 ms of R (when the Pi is awake). |
| **5. Home** | +1 month | MQTT bridge, HA discovery, garage automation, Emporia re-anchor, NAS trip sync, home portal. | HA device "Slate Truck" live; garage opens on arrival with a confirm tap. |
| **6. Publish** | After a summer of data | pi-gen image, BOM, wiring diagram, print files, wizard, docs, plugin API. | A second Slate owner reproduces it from the README alone. |

---

## 12. Risks and unknowns

1. **Phoenix heat and Pi/LCD survival** (highest risk). These are consumer parts in an 85–95 °C parked dash environment. Mitigation: the Pi off the dash, a shade, a boot gate, wide-temp panel, and measuring through one summer before publishing. If panels fail, step up to an automotive/industrial wide-temp panel (more $).
2. **Slate's audio path is unknown.** Bluetooth vs passive vs line-in changes the parts list (±$150) and the audio quality. The answer arrives only at delivery (harness and install sheet).
3. **CarPlay-via-dongle fragility.** `react-carplay`/`node-carplay` maintenance looks quiet (no dated releases visible) [U], and Carlinkit firmware updates can change the protocol. Waze-on-dongle crash reports exist [V, anecdotal]. Mitigation: pin firmware and library, keep a spare dongle, vendor the code.
4. **No SoC API, and CAN access unknown.** Charging suggestions are only as good as SoC. Until CAN is decoded (if ever), SoC is a model anchored by manual input and the home charger.
5. **Five Switch / Bed Light wiring undocumented.** Driving them from the screen may be impossible without fighting latching switches. Mirror-only is the safe default.
6. **Network while driving.** Wireless CarPlay plus a phone Wi-Fi hotspot to the Pi may not coexist [U]. USB tether, BT PAN or a $60 LTE stick are the answers.
7. **Tablet Mount size and power** are unknown. Don't buy a larger panel until it is measured.
8. **Cold-boot reverse camera gap** (~20 s). Acceptable for a personal build. Note it plainly in the published docs; not FMVSS 111 compliant as a sole rear-visibility system [U, regulatory note].
9. **Service limits:** the Spotify Web API dev-mode 5-user cap means each owner needs their own Client ID. Apple Music, YouTube Music, Pandora and Audible stay CarPlay-only.
10. **Warranty.** Tapping Slate circuits may raise warranty questions [?]. Use Add-a-Circuit fuse taps and connectors, and cut no factory wires.

---

## 13. Sources

**Slate truck and accessories**
- Slate Five Switch store listing: https://www.slate.auto/en/store/ACCIT008-AC (page content not readable via fetch; price and details via SlateMod and the search summary)
- SlateMod audio (speaker prices, Hands-Free controller "coming soon", Tablet Mount unpriced): https://slatemod.com/mods/audio/
- SlateMod lighting (Bed Light Kit $139.95, Five Switch $39.99 with Standard/Upgrade, wiring undocumented): https://slatemod.com/mods/lighting/
- Slate Forums: aux switch array over HVAC: https://www.slateforums.com/forum/threads/12v-accessory-bus-bar-switch-array.13003/
- Slate Forums: "Speakers are standard?" (Slate rep correction: no factory audio): https://www.slateforums.com/forum/threads/speakers-are-standard.13104/
- Slate Forums: speaker/infotainment connectivity ("BT only so far"): https://www.slateforums.com/forum/threads/speaker-and-infotainment-connectivity.12692
- Slate Forums: double-DIN housing / dash speakers: https://www.slateforums.com/forum/threads/double-din-radio-housing-for-center-dash-and-dash-speaker-blanks.12686/page-3
- Slate charging page (Superchargers, app features, Treehouse partner): https://www.slate.auto/en/charging
- TechMyMoney, bring-your-own tablet and dash bracket: https://techmymoney.com/2026/09/01/slate-truck-skips-built-in-infotainment-for-your-phone/
- Technology.org, accessory prices: https://www.technology.org/2026/09/01/slate-truck-bring-your-own-tech-price/
- Specs (65 kWh LFP / 205 mi, NACS, 120 kW, 11 kW OBC): https://driveteslacanada.ca/news/slate-ev-truck-pricing-specs-q4-2026/ , https://evchargingstations.com/chargingnews/2027-slate-truck-more-range/ , https://en.wikipedia.org/wiki/Slate_Truck
- Treehouse, Emporia Classic NACS 48A, $479: https://treehouse.pro/products/ev-charger/emporia-classic-nacs-black-hardwired
- Emporia EV charger HACS integration: https://community.home-assistant.io/t/emporia-ev-charger-control-monitor-your-ev-charger-hacs/1018250
- Dash power notes (forum, secondhand): https://www.slateforums.com/forum/goto/post?id=215740

**Hardware and software**
- react-carplay (CPC200-CCPA/CCPM, up to 1080p60): https://github.com/rhysmorgan134/react-carplay
- Jeff Geerling, Pi 5 + Carlinkit + react-carplay working: https://www.jeffgeerling.com/blog/2024/home-assistant-and-carplay-pi-touch-display-2
- CarPiHAT PRO 5 (5 A, safe shutdown, <1 mA, CAN, DAC): https://thepihut.com/products/carpihat-pro-5-car-interface-dac-for-raspberry-pi-5
- Carlinkit CCPA pricing: https://geizhals.at/carlinkit-ccpa-a3537779.html , https://www.pricerunner.com/pl/290-3205013738/Wireless-Audio-Video-Links/CPC200-CCPA-Compare-Prices
- Orient Display 10.1" 900–1000-nit RPi TFT: https://www.orientdisplay.com/products/10-1-raspberry-pi-tft-with-pcap1280x800-900-nits-vga-hdmi-usb-interface
- Beetronics sunlight-readable monitors: https://www.beetronics.ca/c-touchscreens/sunlight-readable/emark
- Raspberry Pi 5 heating and cooling: https://www.raspberrypi.com/news/heating-and-cooling-raspberry-pi-5/
- Brandmotion SurroundVUE 360 BM99SR: https://www.etrailer.com/CAM/Brandmotion/bm99sr.html ; SurroundVUE listing: https://www.americantrucks.com/f150-surroundvue-360-degree-system-fltw-3601.html
- AHD→USB UVC capture (Linux): https://www.newegg.com/p/2CX-005W-00024 , https://computingforgeeks.com/best-capture-card-linux/
- Waze-on-dongle reports: https://forums.macrumors.com/threads/carplay-adapter-to-convert-to-wireless-carplay.2193978/page-296

**Data and APIs**
- NREL AFDC Alt Fuel Stations API: https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/ ; dataset: https://catalog.data.gov/dataset/alternative-fueling-stations
- Open Charge Map terms (attribution): https://beta.openchargemap.org/about/terms
- Spotify Web API quota changes: https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates , https://techcrunch.com/?p=3090291
- HA MQTT JSON device tracker: https://www.home-assistant.io/integrations/mqtt_json/

**Not verified, flagged in the text:** Pi 5 ambient rating, boot times, PlugShare/Tesla API status, wireless-CarPlay plus hotspot coexistence, node-carplay metadata coverage, Electron Widevine, budget 360-kit output formats, Brandmotion video-out.
