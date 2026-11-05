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

## Updates, rollback and backups (Track D)

`install.sh` also runs `updater/setup.sh --from-install`:

| What | Where | Does |
|---|---|---|
| Releases | `/opt/slate-cockpit-releases/` (owned by `slate`), `current` and `previous` symlinks | the brain runs from `current` (drop-in `slate-brain.service.d/10-release.conf`); `install.sh` points `current` at `/opt/slate-cockpit` |
| `slate-updater.path` + `.service` | `/etc/systemd/system/` | the brain writes `/var/lib/slate-cockpit/update/request.json`; the path unit runs `update.sh` as `slate` |
| `update.sh` | `/usr/local/lib/slate-cockpit/` (root-owned) | download (release tarball from the release workflow, else source tarball, or `UPDATE_METHOD=git`), `npm ci` (+ build), switch `current`, restart, health check, automatic switch back if `/api/health` doesn't answer on the new version within 2 min |
| `slate-updater.sudoers` | `/etc/sudoers.d/slate-updater` | the updater's only root right: `systemctl restart slate-brain` |

Repository URL and channel (stable tags or `main`) are on `/settings`,
Software updates, with the changelog, Install and Roll back. Progress:
`/var/lib/slate-cockpit/update/status.json`; build output: `update/build.log`.
`update.sh` is copied when `setup.sh` runs, so re-run `setup.sh` (or
`install.sh`) when a release changes it.

Backups (Settings, Backups) go to a mounted share, rsync over SSH or an
HTTP PUT. Helpers:

```sh
sudo ./deploy/pi/backup/setup-backup.sh nas //nas.local/slate-backups backupuser   # SMB at /mnt/nas-backup
sudo ./deploy/pi/backup/setup-backup.sh ssh-key                                    # key for rsync over SSH
```

Security model and what to do if the truck is stolen: `docs/security.md`.
A flashable image with all of this baked in: `deploy/image/`.
