# Flashable Pi image

A Raspberry Pi OS (64-bit, desktop) image with everything `deploy/pi/install.sh`
would install already baked in: OS packages (Mosquitto, gpsd, NetworkManager,
Chromium, cifs-utils), Node 24, the built app in `/opt/slate-cockpit`, the
`slate-brain` service, the updater (`slate-updater.path`, sudoers rule), the
Chromium kiosk on the 1920x720 bar, the CarPlay policy and udev rule.

Built with [pi-gen](https://github.com/RPi-Distro/pi-gen), the tool Raspberry
Pi uses for its own images: `stage-slate/` is one extra stage after pi-gen's
`stage3` (minimal desktop).

## Build (Linux with Docker, about an hour)

```sh
./deploy/image/build.sh                                      # app built from this checkout
# or, from a release:
gh release download v0.2.0 --pattern 'slate-cockpit-v0.2.0.tar.gz' --dir deploy/image/stage-slate/00-app/files
APP_TARBALL=slate-cockpit-v0.2.0.tar.gz ./deploy/image/build.sh
```

Output: `deploy/image/work/pi-gen/deploy/slate-cockpit-*.img.xz`. The desktop
user `pi` gets a random password, saved in
`deploy/image/work/first-user-password.txt` (SSH is off in the image). Flash
with Raspberry Pi Imager ("Use custom"), or `xzcat … | sudo dd of=/dev/sdX bs=4M`.

`PI_GEN_REF` picks pi-gen's branch (default `arm64`; check pi-gen's README
for the current 64-bit branch name). The `image` GitHub workflow
(`.github/workflows/image.yml`, run by hand with a tag) does the same on a
hosted runner under qemu; it is slow and has not been run yet, so the local
build is the documented path.

## First boot

1. `slate-firstboot.service` creates the truck's Wi-Fi (`slate-truck`) with a
   random password and hands it to the brain once.
2. The kiosk opens the cockpit and the **setup wizard**: admin password, the
   truck Wi-Fi password (it shows the random one and asks you to change it),
   truck id, pack size, home, drivers, Home Assistant, hotspots, comparison
   vehicle. Every step can be skipped and finished later from Settings, Setup.
3. Updates from then on: Settings, Software updates (`deploy/pi/updater/`).

## Not verified yet

The image has not been built or booted (no Linux/Docker build host in the
session that wrote it). Expect to adjust package names (`chromium` vs
`chromium-browser`) and the labwc autostart path for the Raspberry Pi OS
release pi-gen is on.
