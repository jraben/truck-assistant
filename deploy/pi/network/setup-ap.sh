#!/usr/bin/env bash
# The truck's own Wi-Fi: access point "slate-truck" on the built-in radio (wlan0),
# a NetworkManager profile named slate-ap. The ESP32 truck box joins it; so can a
# phone opening /settings. The password is never in the repo:
#   sudo ./deploy/pi/network/setup-ap.sh                 # asks for one (or Enter for a random one)
#   sudo ./deploy/pi/network/setup-ap.sh --random        # makes one and prints it once
#   sudo ./deploy/pi/network/setup-ap.sh --reset         # replace an existing profile
# The password is kept root-only in /etc/slate-cockpit/ap-password. Put the same one
# in the truck box's ESPHome secrets (wifi_password).
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
IFACE="${AP_IFACE:-wlan0}"
SSID="${AP_SSID:-slate-truck}"
NAME=slate-ap
RESET=0; RANDOM_PW=0
for a in "$@"; do case "$a" in --reset) RESET=1 ;; --random) RANDOM_PW=1 ;; *) echo "unknown option $a"; exit 2 ;; esac; done

if nmcli -t -f NAME connection show | grep -qx "$NAME"; then
  if [ "$RESET" -eq 0 ]; then echo "== $NAME exists (use --reset to replace it)"; exit 0; fi
  nmcli connection delete "$NAME" >/dev/null
fi

gen() { tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c 16; }
PW=""
if [ "$RANDOM_PW" -eq 0 ] && [ -t 0 ]; then
  read -r -s -p "Password for Wi-Fi '$SSID' (8-63 characters, Enter = make a random one): " PW; echo
fi
[ -n "$PW" ] || PW="$(gen)"
[ "${#PW}" -ge 8 ] && [ "${#PW}" -le 63 ] || { echo "password must be 8-63 characters"; exit 1; }

nmcli connection add type wifi ifname "$IFACE" con-name "$NAME" autoconnect yes ssid "$SSID" \
  802-11-wireless.mode ap 802-11-wireless.band bg \
  ipv4.method shared ipv4.addresses 10.42.0.1/24 ipv6.method disabled \
  wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.psk "$PW" \
  connection.autoconnect-priority 200 >/dev/null
nmcli connection up "$NAME" >/dev/null || echo "   (not up yet: is $IFACE present and not used by another profile?)"

install -d -m 0700 /etc/slate-cockpit
umask 077; printf '%s\n' "$PW" > /etc/slate-cockpit/ap-password
echo "== access point '$SSID' on $IFACE, gateway 10.42.0.1"
echo "   password (also in /etc/slate-cockpit/ap-password, root only): $PW"
