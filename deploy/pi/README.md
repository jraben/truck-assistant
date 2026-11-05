# Raspberry Pi install

```sh
git clone … && cd slate-cockpit
sudo ./deploy/pi/install.sh        # idempotent: run again after every git pull
```

It installs the brain (systemd `slate-brain`), Mosquitto, gpsd, the Chromium
kiosk on the 1920x720 bar (autostart for the desktop user, `KIOSK_USER` to
override), and everything CarPlay needs:

| File | Goes to | Does |
|---|---|---|
| `chromium-policy.json` | `/etc/chromium/policies/managed/slate-cockpit.json` (and `chromium-browser/`) | `WebUsbAllowDevicesForUrls`: the cockpit at `http://localhost:8080` may open Carlinkit dongles (USB 1314:1520 and 1314:1521) without a chooser; `AudioCaptureAllowedUrls`: the mic for Siri and calls without a prompt; `AutoplayAllowlist`: sound without a tap |
| `99-carlinkit.rules` | `/etc/udev/rules.d/` | the kiosk user (seat `uaccess`, or group `plugdev`) can open the dongle; USB autosuspend off for it |
| `kiosk.sh` | run from autostart | Chromium with `--autoplay-policy=no-user-gesture-required` and `--use-fake-ui-for-media-stream` (mic prompt auto-accepted if the policy is missed) |

The kiosk user is added to `plugdev` and `audio`; log out and in (or reboot)
once after the first install.

## CarPlay dongle (Carlinkit CPC200-CCPA / Autokit)

The cockpit drives the dongle itself over WebUSB (`ui/src/carplay/`, using a
vendored copy of node-carplay 4.1.0). The iPhone connects to the dongle
wirelessly; the Pi only talks USB to the dongle.

### Power

The dongle draws up to ~1 A while it runs Wi-Fi and Bluetooth, more as it
boots. Under-powered, it reboots mid-session: CarPlay drops, the cockpit shows
"CarPlay stopped" and reconnects, over and over. Plug it into the **Pi's blue
USB 3 port** (the Pi 5 gives up to 1.6 A across its USB ports with a 5 A
supply; a Pi 4 has 1.2 A total), or better, a **powered USB hub**. Don't share
a port with the GPS puck's hub if that hub is bus-powered.

### Firmware: don't let it update

Carlinkit dongles update themselves from the phone's internet connection when
they can, and some firmware versions change the USB protocol so third-party
hosts (node-carplay included) stop working: the dongle opens, then never
reports the phone, or video never starts. Which versions break it is not
pinned down here (node-carplay's issue tracker is the place to check before
any update); assume any update can.

- Before the first drive, note the firmware version (below) and keep it.
- Turn **automatic updates off** wherever the firmware offers it (the
  dongle's own settings page or the Autokit app; it varies by unit).
- Don't run the vendor's update tool or the Autokit app's "upgrade".
- If an update breaks it, the vendor's site has older firmware images; a
  downgrade is at your own risk.

### Checking it on the Pi

```sh
lsusb | grep 1314                       # 1314:1520 or 1314:1521 = dongle seen
ls -l /dev/bus/usb/$(lsusb | awk '/1314:/{print $2"/"substr($4,1,3)}')   # group plugdev, mode crw-rw----+
cat /etc/chromium/policies/managed/slate-cockpit.json
dmesg | tail -20                        # repeated "USB disconnect" = power problem
vcgencmd get_throttled                  # anything but 0x0 = under-voltage at some point
```

In Chromium on the Pi, `chrome://policy` must list the three policies as OK,
and `chrome://usb-internals` shows the dongle. The firmware version shows in
the dongle's settings page or the Autokit app; the browser console logs the
dongle's start-up (DevTools on the kiosk: run `kiosk.sh` by hand with `--remote-debugging-port=9222`
added, then open `chrome://inspect` from a laptop on the same network).

The CarPlay view's overlay says what state it is in: no WebUSB (not Chromium),
no dongle, opening, waiting for the phone, connected, or stopped with the
reason (and when it retries). Size, fps and dpi sent to the dongle are picked
from the CarPlay panel's real pixel size (even numbers), 160 dpi for the 12.3"
bar, and 30 fps, falling back to 20 (remembered in the browser) if the dongle
won't do 30.

### Without a dongle

`http://localhost:8080/?carplaySim=1#carplay` plays a test clip through the
same video, touch and now-playing path (touches show as dots). Regenerate the
clip with `node scripts/make-carplay-sim-clip.mjs` (needs ffmpeg).

## Network: the truck's Wi-Fi and getting online

Design: `docs/connectivity.md`. Two radios, two jobs:

| Radio | Job | Who manages it |
|---|---|---|
| Built-in Wi-Fi, `wlan0` | Access point **slate-truck** (10.42.0.1) for the ESP32 truck box and a phone opening `/settings` | NetworkManager profile `slate-ap`, made once by `network/setup-ap.sh`. The brain never touches it. |
| USB Wi-Fi adapter, `wlan1` | Client: home Wi-Fi in the driveway, else the driver's phone hotspot | The brain, through `nmcli`, profiles named `slate-net-*` |
| Built-in Bluetooth | Fallback: Bluetooth tethering (PAN) to the driver's phone | The brain, profile `slate-net-bt-<driver>` |

**USB Wi-Fi adapter.** Any adapter with an in-kernel Raspberry Pi OS driver
(no DKMS build): MT7601U, MT7610U/MT7612U, or RTL8811CU/RTL8821CU class,
~$15. Check after plugging in: `ip link` shows `wlan1`, and
`nmcli device` lists it as `wifi`. If it comes up as something else, set
`NET_CLIENT_IFACE` in `/etc/systemd/system/slate-brain.service`. One radio
doing both AP and client would pin the AP to the hotspot's channel and drop the
truck box whenever the phone moves channel, so it is not supported.

**The access point.** `install.sh` creates it the first time (asks for a
password, or makes a random one when run unattended, prints it once and keeps
it root-only in `/etc/slate-cockpit/ap-password`). Change it later with
`sudo ./deploy/pi/network/setup-ap.sh --reset`. SSID override: `AP_SSID=… `.
The truck box's ESPHome `secrets.yaml` needs the same SSID and password
(`firmware/truckbox/secrets.example.yaml` still says `slate-cockpit`: set
`wifi_ssid` to `slate-truck`, or run the setup with `AP_SSID=slate-cockpit`).

**The brain's rights.** `network/50-slate-network.rules` (polkit) lets the
`slate` user scan, add/modify/delete connections and bring them up. Without
it every switch fails with "not authorized"; the network panel in the cockpit
shows that error.

**Settings.** Home Wi-Fi (truck) and each driver's hotspot name/password and
Bluetooth address (Drivers) go on `/settings`, masked like the API keys. For
Bluetooth tethering, pair the phone once (`bluetoothctl`, then `pair`,
`trust` the phone's address) and turn on Bluetooth Personal Hotspot / tethering
on the phone. `GET /api/network` shows what the brain sees and which network it
picked, and why it couldn't use one.

Checking it:

```sh
nmcli -f NAME,TYPE,DEVICE,AUTOCONNECT-PRIORITY connection show   # slate-ap on wlan0, slate-net-* on wlan1
nmcli device wifi list ifname wlan1                               # what the client radio can see
journalctl -u slate-brain | grep '\[net\]'                        # switches the brain made
```

## Media (Track B): AM/FM, Spotify Connect, music files

`install.sh` runs `deploy/pi/media/install-media.sh`: rtl-sdr + ffmpeg, the
librespot binary (from raspotify's apt repo; raspotify's own service is
disabled because the brain runs librespot itself), the `audio`/`plugdev`
groups for the `slate` user, and `/var/lib/slate-cockpit/music`.

**AM/FM hardware (optional, about $30-40):** an RTL-SDR Blog V4 dongle with
its dipole antenna kit, on a USB port (a short USB extension keeps it away
from the Pi's noise). An antenna outside the cab (a magnetic whip on the roof
or bed rail) beats a dipole behind the glass. FM works out of the box; AM uses
the V4's built-in upconverter, wants a long wire, and is experimental. Check
it with `rtl_test -t` ("Found 1 device"). "usb_claim_interface error" means
the DVB driver still has it: reboot after install (it is blacklisted in
/etc/modprobe.d). One tuner = one station at a time; Seek runs a 2-second band
scan (`rtl_power`) first.

**Spotify Connect:** the truck shows up in Spotify as the speaker name set on
/settings → Spotify (default "Slate Truck"). librespot plays through ALSA as
the `slate` user; if it can't open the default device (the desktop's PipeWire
holds it), set `LIBRESPOT_DEVICE` in `slate-brain.service` to a card from
`aplay -L` (e.g. `plughw:CARD=Headphones`, or the USB DAC / amp feeding the
truck's speakers). Playback control needs Spotify Premium.

**Music files:** copy into `/var/lib/slate-cockpit/music` as
`Artist/Album/NN - Title.ext` (mp3, m4a, flac, ogg, opus, wav); the Media
view's Files tab browses it, offline.

**WOPR voice:** uses the same USB mic as CarPlay (the Chromium policy already
allows the mic on `http://localhost:8080`).
