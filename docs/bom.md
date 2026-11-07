# Bill of materials

Every hardware part named in the plans, in one list. Sources:
`docs/plans/plan-pi5.md` (main screen), `docs/plans/plan-pi-esp32.md`
(second screen), `docs/remote.md` (LTE), `docs/drive-v2.md` (RTL-SDR),
`docs/connectivity.md` and `deploy/pi/README.md` (USB Wi-Fi, Carlinkit),
`firmware/truckbox/README.md` (truck box), `print/` (printed parts) and
`docs/roadmap.md`. `plan-android.md` was not chosen and adds nothing here.

**All prices are estimates as of 2026-11-05**, in USD, for one unit.
Street prices move. Pi prices went up three times in 2025–26 because of the
RAM shortage, and AliExpress prices change by the week. Links go to the
**maker's** page, not a shop. Where the maker's product page couldn't be
confirmed, the link goes to the maker's main site and the row says
"(main site)". Commodity parts with no single maker have no link.

Column **Kit** says which total the part is counted in:
- **B**: bench kit, and so the full build too.
- **F**: full build only.
- **opt**: in neither total, shown as an add-on.

---

## 1. Brain (under the dash)

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| Raspberry Pi 5, 8 GB (4 GB also works) | Brain: brain service, Chromium kiosk, CarPlay decode, cameras | 130 (8 GB; quotes run 130–175) / 85–110 (4 GB) | Required | B | [raspberrypi.com](https://www.raspberrypi.com/products/raspberry-pi-5/) |
| *alt:* Raspberry Pi 4 Model B, 4 GB | Same job. Has hardware H.264 decode, which the Pi 5 lacks (HEVC only). Draws less and needs less supply. | 75 | Alternative | — | [raspberrypi.com](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/) |
| Pi 5 Active Cooler | Phoenix heat | 5 | Required (Pi 5) | B | [raspberrypi.com](https://www.raspberrypi.com/products/active-cooler/) |
| CarPiHAT PRO 5 (TJD) | 12V→5V 5A car-grade supply, ignition-sense safe shutdown, <1 mA off draw, CAN transceiver, opto inputs, DAC | 145 (£110) | Required | B | [The Pi Hut](https://thepihut.com/products/carpihat-pro-5-car-interface-dac-for-raspberry-pi-5) (TJD sells through it; no TJD site confirmed) |
| *alt:* CarPiHAT (Pi 4 version) | Same, for a Pi 4 | ~90 (US price unverified) | Alternative | — | [The Pi Hut](https://thepihut.com/products/carpihat-car-interface-hat-for-raspberry-pi) |
| *budget alt:* Pololu D36V28F5 buck + ignition opto + DIY latch | DIY power with no CAN and no clean shutdown circuit | ~30 | Alternative | — | [pololu.com](https://www.pololu.com/product/3782) |
| High-endurance / industrial microSD, 64 GB | Boot, read-only root | 20 | Required | B | [sandisk.com](https://www.sandisk.com/) (main site) |
| USB 3 SSD, 256–500 GB (Samsung T7 size; the enclosure bay is sized for it) | Trip DB, media, dashcam loop, logs | 40 | Required | B | [semiconductor.samsung.com](https://semiconductor.samsung.com/) (main site) |
| Powered USB 3 hub (12V or 5V fed) | The Carlinkit needs ~1 A. Don't share a bus-powered hub with it. | 20 | Required in the truck. Recommended on the bench. | B | — |
| 12V 5A bench supply (barrel or bare leads) | Feeds the CarPiHAT on a desk. Not needed in the truck. | 20 | Bench only | B | — |

**Pi 4 vs Pi 5 is settled on the bench.** Choosing the Pi 4 path saves about
$110 (board −$55, HAT −$55).

## 2. Main screen and CarPlay

**Changed 2026-11-06: the main screen is the Samsung Galaxy Tab S7 FE Jeff
already owns** (`deploy/android/README.md`). With it, the screen rows below
marked *bar screen* drop out (about $200), and the tablet needs:

| Part | Role | Est. $ | Need | Notes |
|---|---|---|---|---|
| Samsung Galaxy Tab S7 FE (SM-T738U) | Main screen, in Slate's Tablet Mount | owned | Required | Check it fits the mount (about 285 × 185 mm) |
| USB-C hub with PD pass-through (USB-C power in, at least one USB-A data port) | Charges the tablet and carries the CarPlay dongle at the same time | 20–30 | Required | Pass-through must be 45 W or more |
| 45 W USB-C PD car charger (12V) | Powers the hub from an ignition-switched 12V feed | 15–25 | Required (truck) | |
| 45 W USB-C PD wall charger | Same, on the desk | owned or 15–25 | Desk test | |
| Tasker (Play Store) | Wakes the tablet with the truck; brings the cockpit back when you drive | 3.50 | Required | |

The Pi still runs the brain; a **Pi 4** is enough now that it drives no screen.

*Bar-screen build (alternative):*

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| Waveshare 12.3" 1920×720 HDMI capacitive (IPS, in-cell 10-point, toughened glass) | Main bar screen, 301.2 × 123.35 × 12.4 mm. **The 600-nit rating is unverified** (one listing says 300). It gets a printed hood. | 165 (range 150–180, not confirmed) | Required | B | [waveshare.com wiki](https://www.waveshare.com/wiki/12.3inch_1920x720_LCD) (store page not confirmed) |
| 12V→5V 3A buck for the panel (Pololu D36V28F5 or similar) | The panel wants 5V 3A. Keep it off the Pi's rail. | 16 | Required | B | [pololu.com](https://www.pololu.com/product/3782) |
| Right-angle cables: HDMI 90°, 2× USB-C 90° (touch, power) | The connectors sit about 26 mm from the panel end, so straight plugs won't fit in the insert | 20 | Required | B | — |
| Carlinkit CPC200-CCPA (Autokit) | Wireless CarPlay to USB. Driven over WebUSB by `ui/src/carplay/`. **Don't let it update its firmware.** | 45 (range 40–65) | Required for CarPlay | B | [carlinkit.com](https://www.carlinkit.com/) (main site) |
| USB microphone (lavalier or small array) | Siri and calls through CarPlay, WOPR voice | 15 | Optional (voice) | F | — |
| 4-ch Class-D amp (~50 W×4) | **Only if Slate's speakers turn out to be passive** | 100–180 | Unknown until delivery | opt | — |

## 3. Location, network, radio

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| USB GPS puck, u-blox 7/8/M10 class (VK-162 type), magnetic base | gpsd: location, speed, trips | 20 | Required | B | [u-blox.com](https://www.u-blox.com/en/product/neo-m8-series) (chip maker; pucks are third-party) |
| USB Wi-Fi adapter with an in-kernel driver: MT7612U / MT7610U / MT7601U or RTL8821CU / RTL8811CU class | `wlan1` client to the hotspot or home Wi-Fi. The built-in radio stays the `slate-truck` AP. | 20 | Required | B | e.g. [alfa.com.tw](https://www.alfa.com.tw/) (main site; MT7612U adapters) |
| RTL-SDR Blog V4 + a car FM/AM antenna | AM/FM over the air with no data (Track B, `rtl_fm`) | 40 (dongle 30 + antenna) | Optional (AM/FM) | F | [rtl-sdr.com](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) (counterfeits are common; buy from its store list) |

## 4. Truck box (ESP32, 12V side)

Per `firmware/truckbox/README.md`, which has the pin table and wiring.

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| "ESP32 Relay Board x8" (ESP32-WROOM-32E, direct-GPIO relays; **not** the LCTech/Modbus 74HC595 board) | Relays, sense inputs, sensors, MQTT | 20 | Required | B | [ESPHome devices](https://devices.esphome.io/devices/esp32e-relay-x8) (generic board, no single maker) |
| 8-ch PC817 opto module, 12V in / 3.3V out | Read-only sense: Five Switch ×5, ignition, reverse | 8 | Required | B | — |
| Pololu D36V28F5 5V 2.8A buck | Clean 5V that survives 12V transients | 16 | Required | B | [pololu.com](https://www.pololu.com/product/3782) |
| SMBJ24A TVS + SS54 Schottky (or a P-FET) | Transient and reverse-battery protection | 2 | Required | B | — |
| SHT31 breakout (GY-SHT31-D) **or** BME280 (not BMP280) | Cabin temperature and humidity | 6 | Required | B | [sensirion.com](https://sensirion.com/) (main site) / [bosch-sensortec.com](https://www.bosch-sensortec.com/products/environmental-sensors/humidity-sensors-bme280/) |
| MPU-6050 breakout (GY-521) | Pitch and roll for the tilt view | 4 | Required | B | [invensense.tdk.com](https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/) |
| 47k + 10k 1% resistors, 100 nF, BAT54S | 12V battery voltage divider | 1 | Required | B | — |
| Ambient light sensor, BH1750 or VEML7700 breakout (I²C) | Auto brightness and night dim (Track A). Not yet in `truckbox.yaml`. | 5 | Optional (auto brightness) | B | [rohm.com](https://www.rohm.com/) / [vishay.com](https://www.vishay.com/) (main sites) |
| 3.3V USB-serial adapter (CP2102 / CH340) | First flash. The board has no USB. | 6 | Required once | B | — |
| BLE TPMS external valve-cap set of 4 (ZEEPIN / TP630 type) | Tire pressure. **The decoder is unverified on real sensors.** | 35 (25–45) | Optional (TPMS) | F | — |

Wiring parts for the truck box (fuse taps, 40A relays, terminals) are in group 7.

## 5. Cameras (Track C)

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| Rear camera, AHD 1080p (CVBS/AHD switchable) | Reverse view, triggered on reverse | 30 | Optional (cams) | F | — |
| Hitch, bed and front cameras: AHD, 3× | Hitch alignment, bed watch, front/parking | 90 (3 × 30) | Optional (cams) | F | — |
| AHD→UVC USB capture stick, 4× | Each AHD camera shows up as a UVC device for go2rtc | 120 (4 × 30) | Optional (cams) | F | — |
| *alt per camera:* USB UVC camera with native MJPEG (ELP type, 170°) | Skips the capture stick. About $45 each. | 45 | Alternative | — | [elpcctv.com](https://www.elpcctv.com/) (main site) |
| Second powered USB hub for the cameras | USB power and bandwidth | 25 | Optional (cams) | F | — |
| Budget 360° "bird view" kit: 4 fisheye AHD cams + stitching ECU with AV/AHD out | One stitched feed. Confirm the output format before buying. | 150–500 (use 250) | Optional (360°) | opt | — |
| USB AV/CVBS capture stick (UVC) | 360 ECU output to the Pi | 15 | With the 360 kit | opt | — |
| *premium:* Brandmotion SurroundVUE 360 (BM99SR) | Better calibration. Confirm it has a video out first. | 1,280–1,410 | Optional | opt | [brandmotion.com](https://brandmotion.com/) (main site) |

## 6. Remote and LTE (`docs/remote.md`)

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| LilyGO T-SIM7080G-S3 (ESP32-S3 + SIM7080G Cat-M/NB-IoT + GNSS) | Tier 1 always-on watch, <0.5 W: location, alerts, wake the Pi | 30 | Optional (remote) | F | [lilygo.cc](https://lilygo.cc/products/t-sim7080-s3) |
| LTE + GNSS antennas, small enclosure bits for tier 1 | Antennas often come with the board; check the listing | 15 | Optional (remote) | F | — |
| Cat-M IoT SIM: 1NCE prepaid (500 MB / 10 years) or Hologram pay-as-you-go | Tier 1 data | 15 one-off (1NCE) | Optional (remote) | F | [1nce.com](https://1nce.com/) / [hologram.io](https://www.hologram.io/) (main sites) |
| USB LTE Cat-4 modem (Quectel EC25 / EG25 in USB form) | Tier 2 on-demand: live cams, the full cockpit, updates | 75 (60–90) | Optional (remote) | F | [quectel.com](https://www.quectel.com/) (main site; USB sticks are third-party builds) |
| Data SIM plan for tier 2 | Recurring | 10–25 / month | Optional | — | — |

## 7. Second screen (ESP32-P4, optional)

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| Guition JC8012P4A1 10.1" ESP32-P4 + C6, 800×1280 IPS cap-touch (bare board) | Gauges and switches, LVGL, instant-on. Joined to the Pi over USB-NCM. | 45 (AliExpress; other listings run 50–120) | Optional (2nd screen) | F | No Guition product page found; spec reference: [espcontrol JC8012P4A1](https://jtenniswood.github.io/espcontrol/screens/jc8012p4a1) (community) |
| *alt:* Waveshare ESP32-P4-WIFI6-Touch-LCD-10.1 (enclosed; **buy the no-battery SKU**) | Same, with no printing needed. Rated 0–60 °C. | 80–90 | Alternative (+$40) | — | [waveshare.com](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-7-8-10.1.htm) |
| 12V→5V buck for the P4 (Pololu D36V28F5 or similar) | Its own supply | 16 | With the 2nd screen | F | [pololu.com](https://www.pololu.com/product/3782) |

## 8. Wiring and protection

| Part | Role | Est. $ | Need | Kit | Maker link |
|---|---|---|---|---|---|
| Add-a-circuit fuse taps + inline ATO/ATC holders; fuses 1/2/3/5/10/20/30 A | One fuse per tap or run. 1A sense, 2A coils, 3A truck box. | 15 | Required (install) | F | — |
| 6-circuit blade fuse block with negative bus | One fused distribution point for the Pi, screen, hubs and cams | 30 | Required (install) | F | e.g. [bluesea.com](https://www.bluesea.com/) (main site) |
| 2× 12V 40A automotive relays with suppression diode, plus sockets | Compressor and inverter loads, coil driven by the board relays | 15 | Optional (high-current loads) | F | e.g. [bosch-mobility.com](https://www.bosch-mobility.com/) (main site) |
| WAGO 221 levers or screw terminals, 18/14 AWG TXL wire, loom | Truck box install | 20 | Required (install) | F | [wago.com](https://www.wago.com/) (main site) |
| Deutsch DT connectors, extra 18 AWG TXL, loom, PG7 glands, zip ties | Pi, screen and camera runs; serviceable joints | 40 | Required (install) | F | — |

## 9. Printed parts (`print/`)

All cab and exterior parts are **ASA**. No PLA anywhere, and no PETG on the
dash. PETG or PETG-CF is fine only out of the sun (under the dash or seat).

| Part | Role | Est. $ | Need | Kit | Notes |
|---|---|---|---|---|---|
| Dash bar insert + sun hood (`dash-bar-insert/`) | Holds the 12.3" panel in the 352 × 133 mm opening | in filament | Required (truck) | F | Opening, depth and retention not measured yet. Print `fit_test` first. |
| Brain enclosure (`brain-enclosure/`) | Vented box for the Pi + CarPiHAT + USB SSD | in filament | Required (truck) | F | Dash rail unmeasured |
| Camera brackets ×4 (`cam-bracket/`) | Tilt-locking mounts, VHB or M4 | in filament | With the cams | F | |
| Hitch camera mount (`hitch-cam-mount/`) | Clamps on the 2" receiver | in filament | With the hitch cam | F | May need a longer hitch pin |
| P4 shell, truck box enclosure | Second screen shell; under-seat box | in filament | Optional | F | Not modelled yet |
| ASA filament, ~2 × 1 kg spools | All of the above (~1.3 kg) | 50 | — | F | e.g. [polymaker.com](https://polymaker.com/) (main site) |
| Print hardware: M2.5/M3 heat-set inserts, M3/M4/M5 screws and nuts, 3× PG7 glands, 40 mm 5V fan, VHB 5952, EVA foam, velcro strap | Per each part's README | 35 | — | F | |

---

## Totals (estimates as of 2026-11-05)

### Bench kit

What's needed to run the software on a desk with real hardware.

| Group | Items | Subtotal |
|---|---|---|
| Brain | Pi 5 8 GB 130 + cooler 5 + CarPiHAT PRO 5 145 + microSD 20 + SSD 40 + powered hub 20 + bench PSU 20 | 380 |
| Screen + CarPlay | panel 165 + buck 16 + right-angle cables 20 + Carlinkit 45 | 246 |
| GPS + Wi-Fi | GPS 20 + USB Wi-Fi 20 | 40 |
| Truck box + sensors | board 20 + opto 8 + buck 16 + TVS/diode 2 + SHT31 6 + MPU-6050 4 + divider 1 + light sensor 5 + USB-serial 6 | 68 |
| **Bench kit** | 380 + 246 + 40 + 68 | **≈ $734** |

On the Pi 4 path the bench kit is about $624.

### Full build

Everything in the truck, except the 360° kit and the amp.

| Group | Subtotal |
|---|---|
| Bench kit, minus the bench PSU (734 − 20) | 714 |
| USB mic | 15 |
| RTL-SDR + antenna | 40 |
| TPMS set | 35 |
| Cameras: 4 AHD cams 120 + 4 AHD→UVC sticks 120 + hub 25 | 265 |
| LTE tier 1: T-SIM7080G-S3 30 + antennas/bits 15 + 1NCE SIM 15 | 60 |
| LTE tier 2: USB Cat-4 modem | 75 |
| P4 second screen: Guition 45 + buck 16 | 61 |
| Wiring: taps/fuses 15 + fuse block 30 + 40A relays 15 + WAGO/wire 20 + connectors/loom 40 | 120 |
| Printed parts: filament 50 + hardware 35 | 85 |
| **Full build** | **≈ $1,470** |

Add-ons not in either total:
- **Budget 360° kit + AV capture stick:** about +$265.
- **Waveshare P4 instead of Guition:** +$40.
- **Amp, if the speakers are passive:** +$100–180.
- **Tier 2 data plan:** $10–25/month.

---

## Not decided / waiting on the truck

Delivery window is Q2 2027.
- **CAN interface.** The CarPiHAT has a transceiver, but whether the Slate
  exposes a usable bus, where, and with what DBC is unknown. No CAN parts are
  costed beyond the HAT.
- **Dash depth** behind the 12.3" opening, and how the factory panel is held.
  This gates the insert print and possibly the panel choice.
- **Five Switch wiring.** It may be a networked panel (CAN/LIN), not five
  12V wires. If so, the opto sense inputs can't read it.
- **Speakers.** Bluetooth, passive or line-in decides the amp line.
- **Reverse and ignition sense wires.** Not identified yet.
- **12V battery top-up while parked.** This decides how long tier 2 and the
  truck box can stay up.
- **Pi 4 vs Pi 5.** Settled on the bench.
- **Panel brightness.** The 600-nit claim needs checking in Phoenix sun.

---

Truck Assistant is an independent DIY project. It is **not affiliated with,
endorsed by or supported by Slate Auto**. Product names belong to their
owners. Links point to makers' pages for reference only. They are not
endorsements, and none is an affiliate link.
