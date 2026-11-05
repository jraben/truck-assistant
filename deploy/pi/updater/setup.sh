#!/usr/bin/env bash
# One-time (idempotent) setup of the updater on the Pi:
#   sudo ./deploy/pi/updater/setup.sh                 # keep the current release
#   sudo ./deploy/pi/updater/setup.sh --from-install  # point "current" at /opt/slate-cockpit (install.sh does this)
# Creates /opt/slate-cockpit-releases (owned by slate), the systemd path + service,
# the sudoers rule (restart slate-brain, nothing else) and a drop-in so the brain
# runs from releases/current.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/slate-cockpit
REL=/opt/slate-cockpit-releases
DATA=/var/lib/slate-cockpit
FROM_INSTALL=0; [ "${1:-}" = --from-install ] && FROM_INSTALL=1

id slate >/dev/null 2>&1 || { echo "no slate user: run deploy/pi/install.sh first"; exit 1; }
install -d -o slate -g slate -m 0755 "$REL"
install -d -o slate -g slate -m 0750 "$DATA/update"
install -d -m 0755 /usr/local/lib/slate-cockpit
install -m 0755 -o root -g root "$HERE/update.sh" /usr/local/lib/slate-cockpit/update.sh   # root-owned, outside anything slate can write
if [ "$FROM_INSTALL" = 1 ] || [ ! -e "$REL/current" ]; then
  ln -sfn "$APP" "$REL/.current.new" && mv -Tf "$REL/.current.new" "$REL/current"
  chown -h slate:slate "$REL/current"
fi

install -m 0644 "$HERE/slate-updater.path" /etc/systemd/system/slate-updater.path
install -m 0644 "$HERE/slate-updater.service" /etc/systemd/system/slate-updater.service
install -d -m 0755 /etc/systemd/system/slate-brain.service.d
install -m 0644 "$HERE/release.conf" /etc/systemd/system/slate-brain.service.d/10-release.conf

TMP="$(mktemp)"; install -m 0440 "$HERE/slate-updater.sudoers" "$TMP"
if visudo -cf "$TMP" >/dev/null; then install -m 0440 "$TMP" /etc/sudoers.d/slate-updater; else echo "sudoers rule failed visudo; not installed"; fi
rm -f "$TMP"

systemctl daemon-reload
systemctl enable --now slate-updater.path >/dev/null
echo "== updater ready: releases in $REL (current -> $(readlink "$REL/current"))"
