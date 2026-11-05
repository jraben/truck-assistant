#!/bin/bash
# Runs once. The access point needs NetworkManager running, so it isn't baked into the image.
set -u
DATA=/var/lib/slate-cockpit
for _ in $(seq 1 30); do nmcli -t general status >/dev/null 2>&1 && break; sleep 2; done
bash /opt/slate-cockpit/deploy/pi/network/setup-ap.sh --random || echo "AP setup failed; run deploy/pi/network/setup-ap.sh by hand"
if [ -f /etc/slate-cockpit/ap-password ]; then
  install -o slate -g slate -m 0600 /etc/slate-cockpit/ap-password "$DATA/ap-initial-password"
fi
touch "$DATA/.firstboot-done"
systemctl disable slate-firstboot.service >/dev/null 2>&1 || true
