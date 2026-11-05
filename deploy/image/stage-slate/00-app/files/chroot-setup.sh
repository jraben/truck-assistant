#!/bin/bash
# Runs inside the image (pi-gen on_chroot). No systemctl --now, no nmcli: nothing is running.
set -euo pipefail
APP=/opt/slate-cockpit
P="$APP/deploy/pi"
U="$P/updater"

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs

id slate >/dev/null 2>&1 || useradd --system --home /var/lib/slate-cockpit --shell /usr/sbin/nologin slate
install -d -o slate -g slate -m 0750 /var/lib/slate-cockpit /var/lib/slate-cockpit/update
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund)

install -m 0644 "$P/mosquitto.conf" /etc/mosquitto/conf.d/slate.conf
install -m 0644 "$P/network/50-slate-network.rules" /etc/polkit-1/rules.d/50-slate-network.rules
install -m 0644 "$P/slate-brain.service" /etc/systemd/system/slate-brain.service
for d in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  install -d -m 0755 "$d"; install -m 0644 "$P/chromium-policy.json" "$d/slate-cockpit.json"
done
install -m 0644 "$P/99-carlinkit.rules" /etc/udev/rules.d/99-carlinkit.rules
[ -f /etc/default/gpsd ] && sed -i 's/^GPSD_OPTIONS=.*/GPSD_OPTIONS="-n"/; s/^USBAUTO=.*/USBAUTO="true"/' /etc/default/gpsd

# Updater: releases dir, units, sudoers rule (restart slate-brain only); the brain runs from releases/current.
install -d -o slate -g slate -m 0755 /opt/slate-cockpit-releases
ln -sfn "$APP" /opt/slate-cockpit-releases/current
install -d -m 0755 /usr/local/lib/slate-cockpit
install -m 0755 "$U/update.sh" /usr/local/lib/slate-cockpit/update.sh
install -m 0644 "$U/slate-updater.path" "$U/slate-updater.service" /etc/systemd/system/
install -d -m 0755 /etc/systemd/system/slate-brain.service.d
install -m 0644 "$U/release.conf" /etc/systemd/system/slate-brain.service.d/10-release.conf
install -m 0440 "$U/slate-updater.sudoers" /etc/sudoers.d/slate-updater
visudo -cf /etc/sudoers.d/slate-updater

# Kiosk for the desktop user.
U1="${FIRST_USER_NAME:-pi}"
H="$(getent passwd "$U1" | cut -d: -f6)"
for g in plugdev audio; do getent group "$g" >/dev/null || groupadd --system "$g"; usermod -aG "$g" "$U1"; done
install -d -o "$U1" -g "$U1" "$H/.config/autostart" "$H/.config/labwc"
install -m 0644 -o "$U1" -g "$U1" "$P/slate-kiosk.desktop" "$H/.config/autostart/slate-kiosk.desktop"
grep -qs 'slate-cockpit/deploy/pi/kiosk.sh' "$H/.config/labwc/autostart" || echo "$APP/deploy/pi/kiosk.sh &" >> "$H/.config/labwc/autostart"
chown "$U1:$U1" "$H/.config/labwc/autostart"
chmod +x "$APP/deploy/pi/kiosk.sh" "$U/update.sh" "$U/setup.sh"

systemctl enable mosquitto gpsd.socket NetworkManager bluetooth slate-brain slate-updater.path slate-firstboot
