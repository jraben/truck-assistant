# Truck box firmware (ESP32, ESPHome)

The truck box is the part of Slate Cockpit that touches 12V wiring: six relays
for circuits we add, five read-only sense inputs for the Five Switch circuits,
ignition and reverse sense, cabin temperature and humidity, 12V battery
voltage, a tilt sensor and BLE tire sensors. It publishes everything over MQTT
to the Pi's Mosquitto broker, using the topics in `docs/contract.md`.

| File | What |
|---|---|
| `truckbox.yaml` | The device. Every pin and safety default is a `substitution` at the top. |
| `packages/env_sht31.yaml` / `env_bme280.yaml` | Cabin climate sensor; include one. |
| `packages/tpms_ble.yaml` + `tpms_decode.h` | BLE TPMS scanner and decoder (unverified, see TPMS). |
| `secrets.example.yaml` | Copy to `secrets.yaml` (gitignored) and fill in. |

**Status:** `esphome config` validates and `esphome compile` builds with
ESPHome 2026.10.2 (esp-idf 5.5.6): RAM 61.0 %, flash 72.7 % with TPMS included.
Nothing has been flashed to hardware or tested in a truck yet.

**Building on Windows:**
- Run ESPHome from PowerShell or cmd, not Git Bash. ESP-IDF refuses MSYS/MinGW
  shells ("MSys/Mingw is not supported").
- Keep the config folder on a path without spaces, because ESP-IDF's tooling
  breaks on them.
- The ESPHome dashboard in Home Assistant has neither problem.

---

## Board

**Generic "ESP32 Relay Board x8"** (ESP32-WROOM-32E, eight 5V relays, 7–30 V
or 5 V input, about $18–25). It is the one listed in the ESPHome device
database as [ESP32 Relay Board x8](https://devices.esphome.io/devices/esp32e-relay-x8),
which gives the pinout below.

Why this board:
- It's cheap, sold by many vendors and already documented for ESPHome.
- Every relay sits on its own GPIO, so a stuck output affects one relay.
- It has enough spare pins for 7 opto inputs, I2C and an ADC1 pin. The 6-relay
  LilyGO T-Relay-S3 runs out of free pins once seven inputs are added.
- Eight relays let us skip the two on awkward pins:
  - K6 is on GPIO14, which outputs a PWM signal during boot and could click a relay.
  - K7 is on GPIO12, a strapping pin that can stop the ESP from booting if it's pulled high.

  **So the firmware's `relay_6` is board relay K8 (GPIO13).** Label the
  terminals.

**Look-alike to avoid:** the "LCTech ESP32 Relay x8 **Modbus**" board drives its
relays through a 74HC595 shift register. It won't work with this YAML. Check
for "LCTech" or "Modbus" on the silkscreen.

**Another board:** change only the substitutions block. Relays need output-capable
pins. Opto inputs need pins with internal pull-ups, or an external 10k to 3V3.
The battery ADC must be on ADC1 (GPIO32–39 on a classic ESP32), because ADC2
can't be read while Wi-Fi is on. Set `relay_inverted: "true"` for boards whose
relays energise on LOW.

The board has **no USB port**. First flash goes through its 6-pin header with a
3.3V USB-serial adapter, and later updates go over Wi-Fi.

---

## Parts list

Prices are approximate (Nov 2026). Links are searches, not endorsed listings.

| # | Part | Why | ~USD | Where |
|---|---|---|---|---|
| 1 | ESP32 Relay Board x8 (ESP32-WROOM-32E, direct-GPIO, *not* Modbus/LCTech) | The truck box | 20 | [Amazon](https://www.amazon.com/s?k=ESP32+8+channel+relay+board+ESP32-WROOM) / [AliExpress](https://www.aliexpress.us/w/wholesale-esp32-relay-x8.html) |
| 2 | 8-channel PC817 optocoupler module, 12V input / 3.3V output (or 2× 4-channel) | 12V sense isolation, 7 used | 8 | [Amazon](https://www.amazon.com/s?k=PC817+8+channel+optocoupler+module+12V+3.3V) |
| 3 | Pololu D36V28F5 5V 2.8A buck (4.5–50 V in) | Clean 5V that survives 12V transients | 16 | [Pololu](https://www.pololu.com/product/3782) |
| 4 | SMBJ24A TVS diode (24V standoff, ~39V clamp), plus a 1N5822 / SS54 Schottky or a P-FET for reverse polarity | Transient + reverse-battery protection | 2 | [DigiKey](https://www.digikey.com/en/products/result?keywords=SMBJ24A) |
| 5 | SHT31 breakout (GY-SHT31-D), **or** BME280 (not BMP280) | Cabin temp/humidity | 6 | [Amazon](https://www.amazon.com/s?k=SHT31+breakout) |
| 6 | MPU-6050 breakout (GY-521) | Pitch/roll | 4 | [Amazon](https://www.amazon.com/s?k=GY-521+MPU6050) |
| 7 | 47kΩ + 10kΩ 1% resistors, 100 nF ceramic, BAT54S dual Schottky | 12V battery divider | 1 | any |
| 8 | Add-a-circuit fuse taps + inline ATO/ATC holders; fuses 1A, 3A, 5A, 10A, 20A, 30A | One fuse per run | 15 | auto parts store |
| 9 | 2× 12V 40A automotive relays (Bosch-style, with suppression diode) + sockets | Compressor and inverter loads | 15 | auto parts store |
| 10 | BLE TPMS external-cap set of 4 ("TPMS BLE", ZEEPIN/TP630 type, app "TPMS II" or similar) | Optional TPMS | 25–45 | [AliExpress](https://www.aliexpress.us/w/wholesale-ble-tpms-external-sensor.html) |
| 11 | 3.3V USB-serial adapter (CP2102 / CH340, with 3.3V logic) | First flash | 6 | [Amazon](https://www.amazon.com/s?k=CP2102+USB+TTL+3.3V) |
| 12 | Enclosure (printed ASA, see `print/`), WAGO 221 levers or screw terminals, 18/14 AWG TXL wire, loom | Install | 20 | — |

Total is about **$140** with TPMS, or about $100 without.

---

## Wiring

**Read-only on the truck.** Sense inputs only *listen* to Slate's circuits, through an
opto-isolator, with a fuse at the tap. Relays only switch circuits we add.
Nothing in this build back-feeds Slate's own wiring.

### Power

```
12V battery (+) ── 3A fuse ──┬── Schottky/P-FET (reverse) ──┬── Pololu D36V28F5 VIN ── 5V ──▶ board 5V terminal
                             │                              └── SMBJ24A to GND (cathode to +)
12V battery (−) / chassis ───┴──────────────────────────────────── buck GND ── board GND
```

- **Feed the board's 5V input from your own buck**, not the board's 7–30 V input.
  The board's regulator isn't specified for automotive transients.
- Budget: 6 relay coils at about 70 mA each, plus the ESP32 at up to 250 mA,
  is about 0.7 A. The 2.8 A buck has headroom.
- **Parasitic draw:** about 1–1.5 W around the clock (the ESP32 keeps Wi-Fi on).
  That's roughly 3 Ah a day from the 12V battery. Whether the Slate tops up its
  12V battery from the pack while parked is **unknown**. Until that's known, see
  open question 4.

### Pin table (defaults in `truckbox.yaml`)

| Function | ESP32 pin | Board label | Via | Notes |
|---|---|---|---|---|
| relay_1 | GPIO32 | K1 | onboard relay | default name "Bed lights" |
| relay_2 | GPIO33 | K2 | onboard relay | "Light bar" |
| relay_3 | GPIO25 | K3 | onboard relay | "Rock lights" |
| relay_4 | GPIO26 | K4 | onboard → **40A auto relay coil** | "Air compressor", with the interlock |
| relay_5 | GPIO27 | K5 | onboard relay | "Bed fridge" |
| relay_6 | GPIO13 | **K8** | onboard → **40A auto relay coil** | "Inverter" (or its remote-on wire) |
| (unused) | GPIO14 / GPIO12 | K6 / K7 | — | pulses at boot / strapping pin |
| five_switch_1..5 | GPIO4, 16, 17, 18, 19 | header | PC817 ch 1–5 | internal pull-up, active-low |
| ignition | GPIO34 | header | PC817 ch 6 | input-only: **module needs its own pull-up** (or add 10k to 3V3) |
| reverse | GPIO35 | header | PC817 ch 7 | input-only, same as ignition |
| I2C SDA / SCL | GPIO21 / GPIO22 | header | SHT31 0x44, MPU-6050 0x68 | 3V3 power; keep the leads under 30 cm |
| 12V battery sense | GPIO36 (VP) | header | 47k/10k divider | ADC1 |
| status LED | GPIO23 | onboard | — | blinks on errors |

### Relay outputs: coil vs load

- **Board relay contacts** are labelled 10 A, but the PCB traces and screw
  terminals are the real limit. Run **≤5 A loads directly**:
  - Wiring: COM to a fused 12V feed, NO to the load. Never use NC: a relay that
    fails or loses power must leave the load off.
  - Fuse each load at the tap for its wire gauge (a 3A LED bed strip gets a 5A fuse).
- **Above 5 A** (compressor 20–30 A, inverter, fridge inrush): the board relay
  switches only the **coil** of a 40A automotive relay.
  - Coil feed: 2A fuse → board COM → NO → coil 86 → coil 85 → ground.
  - Load: battery → 30A fuse (sized to the wire) → 30 → 87 → load.
  - Use a relay with a built-in suppression diode, or add a 1N4007 across the coil.
- **Inverters:** prefer switching the inverter's own remote-on terminal. Never
  open a relay in the inverter's 100A+ DC feed.

### Opto inputs (PC817, active-low)

- Module **input side**: the truck's 12V wire through a **1A fuse** at the tap,
  then IN+. IN− goes to truck ground.
- Module **output side**: VCC to ESP **3V3** (not 5V, because the GPIOs are not 5V
  tolerant), GND to ESP GND, OUTx to the GPIO.
- When 12V is present the opto pulls the GPIO LOW, which the YAML reads as ON.
- **Check the module's input resistor for 12V.** Most "3.6–30 V" modules use
  about 3 kΩ. A "3.3 V" module at 12V will cook its LED.
- **Debounce:** 50 ms on the five switches. Ignition holds 2 s before it reads
  OFF (rides through dips), and reverse holds 300 ms (LED lamps, bulb-check
  pulses).

### 12V battery divider

- **Circuit:** battery + → 1A fuse → 47kΩ → node → 10kΩ → GND. The node goes
  to GPIO36, with a 100 nF cap from node to GND.
- **Clamp:** a BAT54S from the node to 3V3 and GND clamps spikes. The 47k
  already limits a 40V transient to under 1 mA.
- **Range:** ratio (47 + 10) / 10 = **5.7**, so 16 V reads as 2.81 V at the pin.
  That's inside the ESP32's 12 dB attenuation range, which tops out near 3.1 V.
- **Draw:** about 0.2 mA continuous.

### Fuse summary

| Run | Fuse |
|---|---|
| Truck box power | 3A |
| Each sense tap (five switch, ignition, reverse) | 1A |
| Battery divider | 1A |
| Each direct relay load | sized to load and wire, ≤5A |
| Automotive relay coil feeds | 2A |
| Compressor / inverter load side | per the device manual and wire gauge (typically 30A) |

---

## Safety behaviour

All of it runs on the ESP, so it works with the Pi off.

- **Relays boot OFF, every time.** Both the GPIO and the switch layer are
  `ALWAYS_OFF`, and nothing is restored from flash.
  - Losing Wi-Fi or the broker **never reboots the board** (`reboot_timeout: 0s`).
    The Pi and its access point are off whenever the truck is parked, and a
    reboot would drop the bed fridge.
- **Low-voltage cutoff:**
  - Below `Low Voltage Cutoff` (default **11.8 V**) for 30 s, every relay drops.
  - `Low Voltage Lockout` turns ON and ON commands are refused.
  - The lockout clears after 60 s above `Low Voltage Restore` (12.4 V).
  - A missing reading (NaN) never triggers it: unknown isn't low.
  - 11.8 V is an at-rest figure for a lead-acid battery. Under a compressor
    start, voltage sags briefly, which the 30 s delay rides through.
- **Parked shutoff:**
  - With ignition off for `Parked Shutoff Minutes` (default 30, 0 disables),
    every relay drops.
  - Turning a relay on while parked restarts the clock.
  - `parked_keep_mask` exempts relays: 16 keeps relay_5, the fridge. The
    low-voltage cutoff still covers exempt relays.
- **Compressor interlock** (`compressor_relay`, default relay_4):
  - It runs only with ignition ON (`compressor_needs_ignition`).
  - It stops after `Compressor Max Minutes` (10).
  - It then refuses to restart for `Compressor Cooldown Minutes` (5).
  - Turning the ignition off stops it.
  - Most 12V compressors are rated 25–50 % duty, so match these to yours.

The thresholds are Number entities. Change them from HA or the brain over MQTT,
and they persist in flash. Defaults are the substitutions.

---

## Flashing

1. **Install ESPHome:**
   - Home Assistant: the ESPHome Device Builder add-on.
   - Desktop: `pip install esphome` in a venv.
2. **Copy files:** put `truckbox.yaml`, `packages/` and `tpms_decode.h` into the
   ESPHome config folder (`/config/esphome/` on HA).
3. **Secrets:** copy `secrets.example.yaml` to `secrets.yaml` and fill it in.
   - On HA, the dashboard keeps one shared `secrets.yaml`, so add the keys there.
   - `mqtt_broker` is the Pi's address on its own access point.
4. **First flash (no USB on the board):** wire a 3.3V USB-serial adapter to the
   board's header: TX→RX, RX→TX, GND, 5V.
   - Hold **IO0**, tap reset (or power-cycle), release IO0.
   - Run `esphome run truckbox.yaml`, or use Install → Plug into this computer.
5. **Later flashes** go over Wi-Fi (OTA, password `ota_password`).
   - The ESP must be on the same network as the machine flashing it.
   - That means the Pi's AP, or the fallback hotspot "Slate Truckbox Setup".
6. **Check:** `mosquitto_sub -h <pi> -t 'slate/truckbox/#' -v` should show
   `slate/truckbox/status online` and the topics in `docs/contract.md`.
   - The Pi's Mosquitto bridge carries the HA discovery messages
     (`homeassistant/…`) to the home broker. Bridge `homeassistant/#` as well
     as `slate/#`, or HA won't auto-create the entities.

The native HA `api:` block is commented out on purpose. The truck box talks
MQTT, and enabling both makes HA see the device twice.

---

## Calibration

**12V voltage:**
1. Let the truck sit 10 minutes. Measure the battery terminals with a
   multimeter, for example 12.62 V.
2. Read `Aux Battery V` at the same time, for example 12.41 V.
3. Set `Battery V Trim` to meter ÷ reading, for example 12.62 / 12.41 = **1.017**.
4. Check again at a second point (ignition on, DC-DC charging, about 13.5–14.4 V).
   - If the second point is off by more than 0.1 V, the ESP32 ADC's
     non-linearity is showing.
   - Fix it by replacing the `multiply` filter in `truckbox.yaml` with a
     `calibrate_linear` of your two measured points.

**Tilt:**
1. **Axes.** Mount the MPU-6050 flat and firmly, away from the relays. Set
   `imu_fwd` / `imu_left` / `imu_up` and their `*_sign` substitutions to match
   the board's orientation. The silkscreen arrows mark X and Y; Z is up out of
   the chip.
2. **Signs.** Nose up should read **positive pitch**, and right side down
   should read **positive roll**. If one is backwards, flip that axis's sign.
3. **Zero.** Park on ground you know is level (check with a spirit level on
   the bed rail) and press **Zero Tilt**. The offsets are stored in flash.
   **Clear Tilt Zero** undoes it.

Smoothing comes from an exponential moving average at α = 0.1 on a 10 Hz
sample, which settles in about 2 s, and the result publishes every 500 ms.
Bumps and braking still move the reading, because an accelerometer can't tell
tilt from acceleration. Read it parked or crawling, not at speed.

---

## TPMS

**Decoding is unverified on real hardware.**

**Targeted sensors:** the cheap external valve-cap BLE sensors sold as "TPMS
BLE", ZEEPIN, TP630, or with names like `TPMS1_10CAEA`. They broadcast
unencrypted manufacturer data and can't be paired.

**Layout used** (company id `0x0100`, 16 data bytes) is the one in the
[Theengs decoder](https://decoder.theengs.io/devices/TPMS.html) (`TPMS_json.h`):

| Bytes | Field |
|---|---|
| `x[0]` | sensor number, 0x80 + position |
| `x[1..5]` | MAC tail |
| `x[6..9]` | pressure, uint32 little-endian, in Pa |
| `x[10..13]` | temperature, int32 little-endian, in 0.01 °C |
| `x[14]` | battery % |
| `x[15]` | alarm |

**What's uncertain:**
- **Gauge or absolute:** the decoders treat the pressure as gauge. That isn't
  confirmed for every batch.
- **Format changes:** sellers reuse the same names for sensors with different
  formats.
  - The "DJTPMS" family rotates its manufacturer id and uses a 12-byte
    big-endian payload.
  - Others send a 7-byte frame in 0.1 psi.
  - The [`tpms_ble`](https://github.com/bkbilly/tpms_ble) HA integration
    supports eight variants, A–H.
  - **A sensor in a different format simply never matches, and its tire reads
    unknown.** It never produces a wrong number.

**Safeguards:**
- Frames outside 0–150 psi or −50–150 °C are dropped.
- A tire not heard from for `tpms_stale_minutes` (15) publishes NaN, never its
  last value.
- The logger prints every matching sensor it hears (`[tpms] seen sensor #…`).

**Setup:**
1. Watch the logs (`esphome logs truckbox.yaml`) and fit one sensor at a time
   to find each MAC.
2. Copy the MACs into `tpms_mac_fl/fr/rl/rr`.
3. Compare against a gauge before trusting the numbers.

**Turning it off:**
- `tpms_enabled: "false"` keeps the scan and log but publishes nothing.
- Commenting out the `tpms:` package removes Bluetooth altogether, which frees
  about 100 KB of RAM.

If yours don't decode, capture a raw advertisement with nRF Connect and compare
it to the table above.

---

## What's unknown about the Slate wiring

No delivered truck has been probed. All of this is from `docs/forum-findings.md`.

1. **The Five Switch may not be five 12V wires.**
   - The configurator code names Diode Dynamics as the maker, with type
     "multibutton". The forum speculates it's a networked panel on a data bus
     (CAN/LIN-style) feeding a controller, rather than five switches that each
     put out switched 12V.
   - **If so, the opto sense inputs can't read the switches.** Sensing then
     needs a different approach:
     - opto-sense the *load-side* outputs of whatever module drives each
       circuit, if they're plain 12V; or
     - listen to the bus (a CAN transceiver in listen-only mode, once anyone
       has a DBC); or
     - drop five-switch mirroring.
   - **Check with a meter on a delivered truck before wiring any tap.** The
     `five_switch_*` entities stay in the firmware either way; unconnected,
     they read OFF.
2. **Reverse signal:** no reverse wire has been identified.
   - Candidates are the reverse-lamp feed and the tailgate camera's power.
   - If the lamps are PWM-dimmed or pulsed, the 300 ms off-delay may need tuning.
3. **Ignition sense:** the dash 12V socket is believed to be ignition-switched,
   and a switched 12V there would serve. This is unconfirmed.
4. **12V battery behaviour while parked:** we don't know whether the truck
   recharges its lead-acid 12V battery from the pack when parked.
   - If it doesn't, the truck box's ~3 Ah a day matters over a long park.
   - Options: power the box from ignition plus a keep-alive, or add deep sleep.
     Neither is built.
5. **Fuse box, current limits, Slate Access Point connectors:** not
   documented. Tap only circuits you've measured.
6. **Cab heat:** a parked Phoenix cab can pass 70 °C.
   - The ESP32 module is rated to 85 °C. The relay board's relays and
     capacitors are commodity parts, and their ratings are unknown.
   - Mount the box low and out of the sun (under a seat), not on the dash.
   - Conformal-coat the board against condensation.
