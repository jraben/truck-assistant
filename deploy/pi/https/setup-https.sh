#!/bin/bash
# The truck's own secure address for the dash tablet (README.md beside this file).
#   sudo ./deploy/pi/https/setup-https.sh truck.jeffraben.com
# - The truck's Wi-Fi (slate-ap) answers that name with 10.42.0.1, so it works with no signal.
# - <data>/tls is where the NAS drops the certificate (deploy/nas/push-truck-cert.sh);
#   the admin user that runs this joins the slate group so the NAS can copy it in over SSH.
# - The brain serves https on :443 as soon as the certificate is there (brain/src/https.ts).
set -euo pipefail
HOST="${1:-${SLATE_HOST:-}}"
[ -n "$HOST" ] || { echo "usage: sudo $0 <name, e.g. truck.jeffraben.com>"; exit 1; }
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "'$HOST' isn't a host name"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
DATA="${DATA_DIR:-/var/lib/slate-cockpit}"
AP_IP="${AP_IP:-10.42.0.1}"
ADMIN="${SUDO_USER:-}"

echo "== $HOST answers $AP_IP on the truck's Wi-Fi"
install -d -m 0755 /etc/NetworkManager/dnsmasq-shared.d
printf '# Truck Assistant: the cockpit'"'"'s secure name, offline (deploy/pi/https)\naddress=/%s/%s\n' "$HOST" "$AP_IP" > /etc/NetworkManager/dnsmasq-shared.d/slate-https.conf
if nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx slate-ap; then nmcli connection up slate-ap >/dev/null && echo "   slate-ap restarted (devices on it reconnect in a few seconds)"; else echo "   slate-ap isn't up: it takes effect when it is"; fi

echo "== $DATA/tls for the certificate"
install -d -o slate -g slate -m 2770 "$DATA/tls"
if [ -n "$ADMIN" ] && [ "$ADMIN" != root ]; then usermod -aG slate "$ADMIN" && echo "   $ADMIN can copy into it (log out and back in for the group)"; fi
mkdir -p /etc/slate-cockpit && printf '%s\n' "$HOST" > /etc/slate-cockpit/https-host

echo "== the brain may use port 443"
if ! grep -q CAP_NET_BIND_SERVICE /etc/systemd/system/slate-brain.service 2>/dev/null; then
  echo "   /etc/systemd/system/slate-brain.service lacks AmbientCapabilities=CAP_NET_BIND_SERVICE: re-run deploy/pi/install.sh (it copies the new unit)"
fi

cat <<NEXT

Next (README.md beside this file):
  1. DNS: an A record $HOST -> $AP_IP (backup for tablets using Private DNS).
  2. NAS: issue the certificate for $HOST and schedule deploy/nas/push-truck-cert.sh
     (SSH key for ${ADMIN:-your admin user}@$(hostname)).
  3. Tablet: open https://$HOST, install the app, point Tasker's Launch App at it.
Check: curl -s http://localhost:8080/api/https
NEXT
