# The watch (tier 1, always on)

The part of Slate Cockpit that stays awake when the truck is parked and the Pi
is off: where the truck is, its 12V battery, cabin temperature, vibration,
"it moved", relay commands from your phone, and **waking the Pi** for live
cameras. Design and the alert list: `docs/remote.md`.

| File | What |
|---|---|
| `platformio.ini` | Build (PlatformIO, Arduino-ESP32 2.0.17), libraries pinned |
| `src/main.cpp` | The firmware |
| `include/config.h` | Pins, check-in interval, alert thresholds |
| `include/secrets.example.h` | Copy to `include/secrets.h` (gitignored): APN, broker, ntfy |

**Status:** builds with PlatformIO 6.1.16 / espressif32 6.9.0 (TinyGSM 0.12.0,
XPowersLib 0.2.6): RAM 6.3 %, flash 26.8 %. **Not run on hardware yet.** The
SIM7080G AT sequences (GNSS, the built-in MQTT `AT+SM*` and HTTP `AT+SH*`
clients, TLS contexts) follow SIMCom's SIM7080 AT manual and LilyGO's examples;
check each on the bench with `pio device monitor` before trusting it.

## Why a separate board, and why not ESPHome

1. **ESPHome can't drive the SIM7080G.** ESPHome 2026.10.2 (checked in its
   component list) has `sim800l` (2G, SMS only, and 2G is gone in the US) and
   no cellular-data or `modem` component. There is an out-of-tree `modem`
   component built on esp_modem (PPP over a SIM7600/SIM800-class modem), but it
   is not part of ESPHome, doesn't list the SIM7080G, and would put a PPP stack
   and TLS on the ESP. So tier 1 is an Arduino/PlatformIO sketch using TinyGSM
   and the modem's own MQTT/HTTP clients (TLS runs on the modem).
2. **A deep-sleeping MCU can't hold relays.** The truck box's job is to keep
   the bed fridge on and enforce the low-voltage and compressor interlocks;
   deep sleep resets its GPIOs and its logic. The watch's job is the opposite:
   off >99 % of the time.
3. **Power and noise.** The modem pulls ~2 A peaks while transmitting; keeping
   that off the relay board's 5 V rail avoids brown-outs when a relay coil and
   a transmit burst coincide.

So: **two boards, three wires** (GND, TX, RX) between them. The truck box
answers `S?` with its relays, ignition, 12V and cabin temperature, takes
`R3=1` / `R3=0` through the same safety gate as every ON command, and turns
its Wi-Fi off after 15 minutes parked (`W1` from the watch turns it back on
when the Pi is woken). See `firmware/truckbox/packages/watch_link.yaml`.

## Board: LilyGO T-SIM7080G-S3

ESP32-S3 (16 MB flash, 8 MB PSRAM) + SIMCom SIM7080G (LTE-M / NB-IoT + GNSS) +
AXP2101 power manager + an 18650 holder (the cell keeps the watch alive and
reporting if the 12V is cut or flat). About $40–45. Pins the board fixes are at
the top of `include/config.h`; ours are on its header, **check them against
your board's pin card** before wiring.

## Wiring

```
12V battery + ── 1A fuse ──┬── low-Iq buck 12V→5V (e.g. Pololu D24V5F5) ── board 5V (VBUS) / GND
                           └── 47k ──┬── GPIO1 (ADC), 100 nF to GND      12V sense, ratio 5.7
                                     └── 10k ── GND
GPIO2  ── 1k ── PC817 LED → GND;  PC817 transistor across the power board's IGN input
          (OR'd with the real ignition through a diode, so either one keeps the Pi on)
GPIO13 ── SW-18010P spring vibration switch ── GND      (internal pull-up, no idle current)
GPIO17 (RX) ── truck box GPIO5 (TX)
GPIO18 (TX) ── truck box GPIO39 (RX, with 10k pull-up to 3V3 on the truck box side)
GND ─────────── truck box GND
LTE + GNSS antennas: the board's two u.FL connectors (GNSS antenna with a view of the sky)
```

The wake line drives the **car power board's ignition-sense input**: a Pi car
supply such as the Mausberry "Car Supply/Switch", the Pi-Car SHIM class, or a
generic "ignition delayed power off" module. When IGN goes high it powers the
Pi; when it drops, it signals the Pi to shut down (the brain already has, after
a remote wake) and cuts 5V after its delay.

## What it publishes (MQTT, under `MQTT_PREFIX`, default `slate/watch`)

| Topic | When | Payload |
|---|---|---|
| `slate/watch/status` | every check-in, will = `offline` | `online` (retained) |
| `slate/watch/state` | every check-in, every minute while holding the Pi | `{"ts","fix","lat","lon","gps_at","v12","cabin_f","vib","moved","ign","relays","parked","pi","rssi","batt_mv","interval_s","fw"}` (retained) |
| `slate/watch/alert` | when one fires | `{"kind","title","message","ts"}`; kinds as in the brain: `theft`, `low12v`, `cabinHot`, `motionParked` |
| `slate/watch/command` | you / HA / the brain send it (QoS 1) | `{"pi":"wake"}`, `{"pi":"sleep"}`, `{"relay":"relay_1","on":true}`, `{"interval_s":300}` |
| `homeassistant/…/slate_watch/…/config` | first check-in, then daily | HA discovery: a **Slate Watch** device with location, 12V, cabin, LTE signal, backup cell, moved, Pi awake, and **Wake Pi** / **Sleep Pi** buttons |

The session is persistent (`CLEANSS 0`, QoS 1): a command sent while the
watch sleeps is delivered at its next check-in. So **Wake Pi takes up to one
check-in interval** (10 min by default) plus the Pi's boot (~30–60 s).
Shorten it with `{"interval_s":120}` when you expect to want the cameras, at
the cost below.

## Power

Estimates, not measurements (measure on the bench with the board on a USB
power meter, then the 12V side with a clamp meter).

| State | Draw | Notes |
|---|---|---|
| Deep sleep | ~0.05 mA at 3.8 V | ESP32-S3 ~10 µA, AXP2101 ~30–40 µA, modem unpowered (DC3 off) |
| 12V divider | 0.22 mA at 12.6 V (2.8 mW) | 57 kΩ across the battery, always; a P-FET switch would remove it |
| Buck quiescent | ~0.1 mA at 12 V | low-Iq part; the truck box's D36V28F5 is not low-Iq |
| One check-in | ~1.1 mAh at 3.8 V (~4 mWh) | ~40 s awake: GNSS hot fix 5–30 s at ~30 mA, LTE-M attach + TLS + publish 10–25 s at ~80 mA average (peaks ~0.5 A), ESP ~40 mA throughout |

| Check-in every | Average from the 12V battery | Per day |
|---|---|---|
| 30 min | ~0.9 mA (~11 mW) | ~22 mAh |
| **10 min (default)** | ~2.7 mA (~32 mW) | ~65 mAh |
| 2 min | ~12 mA (~0.14 W) | ~0.29 Ah |

A 12V lead-acid battery of ~45 Ah loses ~0.07 Ah a day to the watch at the
default, which is small next to the truck box (~1.2 W ≈ 2.4 Ah/day with Wi-Fi
on, ~0.3 W ≈ 0.6 Ah/day once its parked Wi-Fi off kicks in) and the Pi (5–8 W
while awake). LTE-M PSM (`AT+CPSMS`) instead of powering the modem off would
cut the attach cost; not used yet because a cold attach is the reliable path.

## Build and flash

```sh
cp include/secrets.example.h include/secrets.h   # then fill it in
pio run                      # build
pio run -t upload            # USB-C, hold BOOT while plugging in the first time
pio device monitor           # logs at 115200
```

On Windows keep PlatformIO's core dir and the project on a short path without
spaces (`PLATFORMIO_CORE_DIR=C:\pio`), or the toolchain fails with
"CreateProcess: No such file or directory".

## Bench checklist

1. Serial log shows the modem answering, a GNSS fix (outdoors), LTE-M attach, `+SMCONN` OK.
2. `mosquitto_sub -h <broker> -u … -P … -t 'slate/watch/#' -v` shows `status online` and a `state`.
3. HA shows the Slate Watch device (if the broker is HA's or bridged to it).
4. Press **Wake Pi** in HA; at the next check-in GPIO2 goes high and stays high through sleep.
5. Tap the vibration switch: an immediate check-in; three taps between reports raise `motionParked`.
6. Move the board > 200 m with `S?` answering `ign=0`: a `theft` alert.
7. Measure the sleep current.
