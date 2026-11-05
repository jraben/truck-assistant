# P4 second screen firmware (ESP32-P4, ESPHome + LVGL)

A 10.1" touch screen for the dash that needs nothing but the MQTT broker on the
Pi. It shows speed, charge and range, the six upfit relays (tap one to toggle
it), and alerts. It is the small-screen half of `docs/plans/plan-pi-esp32.md`,
cut down to what works over plain MQTT: no video, no layouts pushed from the
web UI yet.

| File | What |
|---|---|
| `p4-screen.yaml` | The device. Board pins, truck id, rotation and thermal limits are `substitutions` at the top. |
| `cockpit.h` | Parses the brain's State JSON, holds it between messages, builds the alert text. |
| `secrets.example.yaml` | Copy to `secrets.yaml` (gitignored) and fill in. |

**Status:** builds with ESPHome 2026.10.2 (details in [Build status](#build-status)). Nothing has been
flashed to a board yet. The board pins come from community configs, not from a
unit on the bench.

**Building on Windows** (same rules as the truck box):
- Run ESPHome from PowerShell or cmd, not Git Bash. ESP-IDF refuses MSYS/MinGW
  shells.
- Keep the config folder on a path without spaces. Copy this folder somewhere
  like `C:\esp\p4-screen` to build.
- The first compile downloads ESP-IDF, LVGL, esp_hosted and the Roboto
  Condensed font from Google Fonts, so it needs the internet once.

---

## Why ESPHome

ESPHome 2026.10 supports everything this board needs, in YAML:

- `mipi_dsi` has the **JC8012P4A1** panel built in as a model (JD9365 driver,
  800x1280, 2-lane DSI at 1 Gbps, with its init sequence), plus
  `JC8012P4A1-V2` for units shipped with the second panel revision.
- `esp32_hosted` gives the P4 Wi-Fi through the on-board ESP32-C6 over SDIO.
  ESPHome's `wifi:` then works unchanged.
- `esp_ldo` powers the DSI PHY from the P4's own LDO, `gt911` does touch, and
  `lvgl` (LVGL 9) draws the UI.

So this is the same toolchain as the truck box. An ESP-IDF project would only
earn its keep for things ESPHome can't do: the MJPEG camera relay and USB-NCM
to the Pi from the plan.

## Board

**Guition JC8012P4A1** (ESP32-P4 + ESP32-C6, 10.1" 800x1280 IPS, JD9365, GT911
capacitive touch, 16 MB flash, 32 MB PSRAM, about $44). It's the one in the
plan.

Pins used (substitutions in `p4-screen.yaml`):

| Function | Pin | Note |
|---|---|---|
| Backlight PWM | GPIO23 | LEDC, 20 kHz |
| Touch I2C SDA / SCL | GPIO7 / GPIO8 | GT911, 400 kHz |
| C6 SDIO CLK / CMD | GPIO18 / GPIO19 | esp_hosted |
| C6 SDIO D0-D3 | GPIO14-GPIO17 | 4-bit |
| C6 reset | GPIO54 | |
| LCD reset | GPIO27 | set by the `JC8012P4A1` model |
| DSI PHY supply | LDO channel 3, 2.5 V | |

**These pins come from the community configs for this board. They have not
been checked on a unit we own.** On the first boot, check three things in the
log:
1. `chip revision: vX.Y`. Below v3.0, set `p4_engineering_sample: "true"`.
   Early Guition boards shipped with v1.x silicon, and the wrong setting won't
   boot.
2. The panel lights up and the picture is right. If it's garbled or blank,
   try `panel_model: JC8012P4A1-V2`.
3. Wi-Fi comes up. If esp_hosted can't talk to the C6, the C6's firmware may
   be too old for the esp_hosted version ESPHome uses. The C6 can be updated
   over the same link (ESPHome `update:` platform `esp32_hosted`). That isn't
   wired in yet.

**Waveshare ESP32-P4-WIFI6-Touch-LCD-10.1** (enclosed, $80-110) is the
alternative if you aren't printing a shell. ESPHome has its 10.1" JD9365 panel
as `WAVESHARE-P4-NANO-10.1` / `WAVESHARE-10.1-DSI-TOUCH-A`. Its backlight,
touch and C6 pins are **not** the Guition's, so check them against Waveshare's
wiki before you change the substitutions. Only the Guition config is compiled.

## Power from 12V

The board takes **5 V over USB-C**. The P4, the C6 and the backlight at full
brightness draw roughly 1-1.5 A **[UNVERIFIED, measure it]**.

- Use a **12V-to-5V buck rated 3 A**, with a USB-C (or 5 V pigtail) output, on
  an **ignition-switched, fused** feed. A 3 A fuse is plenty. The screen
  should die with the ignition; it holds no state worth keeping.
- Use a buck with a wide input range (8-32 V) and load-dump protection. A
  car-socket USB charger does the job if it's a good one. Don't feed the board
  straight from 12V.
- Keep the 5 V lead short and thick (20 AWG or better). Sagging volts on a long
  USB lead brown out the C6 first, which looks like a Wi-Fi fault.
- Ground at the same point as the Pi's buck to avoid ground loops in audio.

**Heat.** The board is rated 0-60 C. The firmware reads the P4's internal
temperature every 30 s. Above `hot_dim_c` (55 C) it dims the backlight to 20 %,
and above `hot_off_c` (65 C) it turns it off. It goes back to full brightness
below `hot_clear_c` (50 C). The internal sensor reads the chip, not the panel,
so treat it as a rough guide. In a Phoenix summer, take the screen out or shade
it.

## Flashing

1. `cp secrets.example.yaml secrets.yaml` and fill in the same Wi-Fi/MQTT
   values as the truck box. Give the screen its own Mosquitto user
   (`p4screen`) if the broker uses an ACL. It needs **read** on
   `slate/brain/#` and `slate/truckbox/#`, and **write** on
   `slate/truckbox/switch/+/command` and `slate/p4screen/#`.
2. The first flash goes over USB-C (the board's USB-serial/JTAG port):
   `esphome run p4-screen.yaml`, then pick the COM port. If it won't connect,
   hold BOOT, tap RESET, then let go of BOOT.
3. Later updates go over Wi-Fi: `esphome run p4-screen.yaml --device
   slate-p4-screen.local`, or by IP on the Pi's AP.

## Topics

Prefix is the `truck_id` substitution (default `slate`), matching
`docs/contract.md`.

| Direction | Topic | Use |
|---|---|---|
| read | `slate/brain/state` | the State JSON, retained. Source of every number, the relay names and `truckbox`. |
| read | `slate/brain/status` | `offline` raises "BRAIN OFFLINE" and dims the numbers |
| read | `slate/truckbox/switch/relay_N/state` | relay truth direct from the truck box, so buttons react quickly and still work if the brain is down |
| write | `slate/truckbox/switch/relay_N/command` | `ON` / `OFF` on a tap |
| own | `slate/p4screen/status` | `online` / `offline` (birth / last will) |

HA discovery is off for the screen; it's a reader.

## What's on screen

The UI is 1280x800 landscape (`rotation: "90"`; use `"270"` if it's upside
down in the mount).

- **Speed** is in 280 px digits. **SoC %** turns amber below 20 and red below
  10, and has a bar. **Range** is in miles.
- **Null means a dash.** Every number the brain sends as `null` (or leaves
  out) shows as "—", never 0. The bar hides when SoC is unknown.
- **Stale data is dimmed.** If the link is down, the brain says offline, or no
  state has arrived yet, the numbers turn grey. They are the last report, not
  the truth.
- The top right shows **link status and how long ago the last state arrived**.
  The brain publishes on change, so silence by itself isn't treated as a fault.
- **Alerts**, worst first: no link to the Pi; brain offline; truck box offline
  (`state.truckbox == false`); 12V battery below 11.8 V (`aux12v`); any tire
  below 30 psi (`tpms.*.psi`); a relay that didn't respond. If there's nothing
  wrong it shows "ALL CLEAR" in green. A null `aux12v` or tire raises no alert;
  the screen doesn't guess.

## How relays toggle

- Each button shows the relay's name from `state.relays.relay_N.name`
  (contract defaults until the first state arrives). It shows ON (cyan fill),
  OFF (cyan outline) or "—" (unknown).
- A tap publishes the opposite of the **reported** state to
  `slate/truckbox/switch/relay_N/command`. An unknown relay gets `ON`. The
  button then shows `ON...` / `OFF...` in amber until the truck box's state
  moves.
- **The button never assumes the command worked.** The truck box can refuse
  it (low-voltage lockout, compressor cooldown or interlock; see
  `firmware/truckbox/README.md` "Safety behaviour"). If nothing changes within
  5 s, the alert panel says "<name>: no response" for 12 s.
- Taps do nothing while the link is down or `state.truckbox` is false. Commands
  aren't retained, so one sent to an absent truck box would just vanish. Taps
  within 0.7 s are debounced, and only one request per relay is in flight at a
  time.
- The brain's copy of a relay lags the truck box's own topic. For 2.5 s after a
  direct update, the brain's value is ignored so the button doesn't flicker
  back.

## Not done yet

- Layouts and themes pushed from the web UI, now-playing, charger list, the
  camera (all in the plan, none needed for a glance screen).
- USB-NCM to the Pi. Wi-Fi to the Pi's AP is the only link.
- C6 firmware update via `update: platform: esp32_hosted`.
- Night dimming from the brain (e.g. headlights on). Only the thermal limit
  dims the backlight today. There's a `Backlight` light entity, but discovery
  is off.

## Build status

Checked 2026-11-05 with **ESPHome 2026.10.2** (ESP-IDF 5.5.6), building the
Guition config (`panel_model: JC8012P4A1`, production silicon) from a path
with no spaces, in PowerShell:

- `esphome config p4-screen.yaml` is valid.
- `esphome compile p4-screen.yaml` **builds**: RAM 14.5 % (95,326 of
  655,360 bytes of internal SRAM; the LVGL draw buffer goes in PSRAM), flash
  17.4 % (1,411,874 of 8,126,464 bytes of the app partition).
  `firmware.factory.bin` is 1,477,824 bytes and `firmware.ota.bin` is 1,412,288.
- Expect these and ignore them: font warnings about missing combining
  accents (Roboto Condensed doesn't have them; nothing uses them), and a
  linker note that it "cannot assign memory region sram_seg".
- The first compile caught one real bug, now fixed. `on_json_message` hands
  the lambda a `JsonObjectConst`, not a `JsonObject`.

**Not tested:** anything on hardware, including the pins, panel init, touch
orientation under LVGL rotation, esp_hosted Wi-Fi, and the backlight PWM
polarity. The Waveshare variant isn't compiled.
