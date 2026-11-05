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
