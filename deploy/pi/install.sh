#!/usr/bin/env bash
# Slate Cockpit on a Raspberry Pi (4 or 5, Raspberry Pi OS 64-bit with desktop).
# Idempotent: safe to run again after a git pull. Run from the repo:
#   sudo ./deploy/pi/install.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APP=/opt/slate-cockpit
DATA=/var/lib/slate-cockpit
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

echo "== packages"
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients gpsd gpsd-clients curl rsync network-manager bluez chromium >/dev/null \
  || apt-get install -y -qq mosquitto mosquitto-clients gpsd gpsd-clients curl rsync network-manager bluez chromium-browser >/dev/null

echo "== node 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi

echo "== user and folders"
id slate >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin slate
install -d -o slate -g slate -m 0750 "$DATA"
install -d -m 0755 "$APP"

echo "== app"
rsync -a --delete --exclude node_modules --exclude .git --exclude 'brain/data' --exclude firmware --exclude print "$REPO/" "$APP/"
cd "$APP"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

echo "== mosquitto"
install -m 0644 "$APP/deploy/pi/mosquitto.conf" /etc/mosquitto/conf.d/slate.conf
systemctl enable --now mosquitto
systemctl restart mosquitto

echo "== gpsd (USB puck)"
if [ -f /etc/default/gpsd ] && ! grep -q '^GPSD_OPTIONS="-n"' /etc/default/gpsd; then
  sed -i 's/^GPSD_OPTIONS=.*/GPSD_OPTIONS="-n"/' /etc/default/gpsd
  sed -i 's/^USBAUTO=.*/USBAUTO="true"/' /etc/default/gpsd
fi
systemctl enable --now gpsd.socket || true

echo "== network: NetworkManager, the slate-truck access point, and the brain's rights"
# The brain switches the USB client radio (wlan1) between home Wi-Fi, the driver's
# hotspot and Bluetooth tethering through nmcli; polkit lets the slate user do that.
install -m 0644 "$APP/deploy/pi/network/50-slate-network.rules" /etc/polkit-1/rules.d/50-slate-network.rules
systemctl enable --now NetworkManager >/dev/null 2>&1 || true
systemctl enable --now bluetooth >/dev/null 2>&1 || true
# First run only: create the truck's own Wi-Fi on wlan0. Interactive installs are asked
# for a password; unattended ones get a random one, printed once (never in the repo).
if ! nmcli -t -f NAME connection show 2>/dev/null | grep -qx slate-ap; then
  if [ -t 0 ]; then bash "$APP/deploy/pi/network/setup-ap.sh"; else bash "$APP/deploy/pi/network/setup-ap.sh" --random; fi
fi
ip link show wlan1 >/dev/null 2>&1 || echo "   note: no wlan1 yet. Plug in the USB Wi-Fi adapter (deploy/pi/README.md, Network) for hotspot / home Wi-Fi."

echo "== updater (releases dir, path unit, sudoers rule for restarting the brain only)"
bash "$APP/deploy/pi/updater/setup.sh" --from-install

echo "== brain service"
install -m 0644 "$APP/deploy/pi/slate-brain.service" /etc/systemd/system/slate-brain.service
systemctl daemon-reload
systemctl enable slate-brain
systemctl restart slate-brain

echo "== CarPlay dongle: Chromium policy (WebUSB, mic, autoplay) and udev"
# Both Chromium package names read their own policy dir; install to both.
for d in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  install -d -m 0755 "$d"
  install -m 0644 "$APP/deploy/pi/chromium-policy.json" "$d/slate-cockpit.json"
done
install -m 0644 "$APP/deploy/pi/99-carlinkit.rules" /etc/udev/rules.d/99-carlinkit.rules
getent group plugdev >/dev/null || groupadd --system plugdev
id -nG "$KIOSK_USER" | grep -qw plugdev || usermod -aG plugdev "$KIOSK_USER"
id -nG "$KIOSK_USER" | grep -qw audio || usermod -aG audio "$KIOSK_USER"
udevadm control --reload-rules
udevadm trigger --subsystem-match=usb --attr-match=idVendor=1314 || true

echo "== kiosk autostart for $KIOSK_USER"
chmod +x "$APP/deploy/pi/kiosk.sh"
HOME_DIR=$(getent passwd "$KIOSK_USER" | cut -d: -f6)
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$HOME_DIR/.config/autostart"
install -m 0644 -o "$KIOSK_USER" -g "$KIOSK_USER" "$APP/deploy/pi/slate-kiosk.desktop" "$HOME_DIR/.config/autostart/slate-kiosk.desktop"
# labwc (Wayland, Bookworm+) reads its own autostart file.
if [ -d "$HOME_DIR/.config/labwc" ] || command -v labwc >/dev/null; then
  install -d -o "$KIOSK_USER" -g "$KIOSK_USER" "$HOME_DIR/.config/labwc"
  AUTO="$HOME_DIR/.config/labwc/autostart"
  grep -qs 'slate-cockpit/deploy/pi/kiosk.sh' "$AUTO" || echo "$APP/deploy/pi/kiosk.sh &" >> "$AUTO"
  chown "$KIOSK_USER:$KIOSK_USER" "$AUTO"
fi

echo "== done: http://$(hostname).local:8080  (settings: /settings)"
systemctl --no-pager --lines=5 status slate-brain || true
