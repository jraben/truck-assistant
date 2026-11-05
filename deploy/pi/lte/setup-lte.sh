#!/usr/bin/env bash
# Tier 2: a USB Cat-4 LTE modem (Quectel EC25 / EG25-G class) as the Pi's last
# way online, through ModemManager + NetworkManager. Run once after plugging
# the modem in, and again after changing the APN on /settings > Remote:
#
#   sudo ./deploy/pi/lte/setup-lte.sh            # APN from the brain's settings
#   sudo ./deploy/pi/lte/setup-lte.sh fast.t-mobile.com
#
# The profile is "slate-lte". Its route metric (900) is worse than Wi-Fi's, so
# home Wi-Fi and the driver's hotspot still win whenever they are up; LTE
# carries the truck only when nothing else does (parked, remote viewing).
# The brain never touches it (it manages slate-net-* profiles only).
set -euo pipefail

DATA="${DATA_DIR:-/var/lib/slate-cockpit}"
NAME=slate-lte

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

echo "== ModemManager"
apt-get install -y -qq modemmanager usb-modeswitch >/dev/null
systemctl enable --now ModemManager >/dev/null

# APN (and an optional user/password) from remote.json, unless given on the command line.
read_setting() { node -e "try{const r=require('$DATA/remote.json');const v=$1;process.stdout.write(v==null?'':String(v))}catch{}" 2>/dev/null || true; }
APN="${1:-$(read_setting 'r.lte.apn')}"
USER_="$(read_setting 'r.lte.user')"
PASS="$(read_setting 'r.lte.password')"
[ -n "$APN" ] || { echo "No APN: set it on /settings > Remote (LTE APN), or pass it: $0 <apn>"; exit 1; }

echo "== waiting for the modem (up to 60 s)"
for _ in $(seq 1 30); do
  mmcli -L 2>/dev/null | grep -q '/Modem/' && break
  sleep 2
done
mmcli -L | grep -q '/Modem/' || { echo "ModemManager sees no modem. Check lsusb and dmesg (some sticks need usb-modeswitch)."; exit 1; }
mmcli -m any | grep -E 'manufacturer|model|state|signal quality' || true

echo "== NetworkManager profile $NAME (APN $APN)"
nmcli connection delete "$NAME" >/dev/null 2>&1 || true
nmcli connection add type gsm ifname '*' con-name "$NAME" gsm.apn "$APN" \
  connection.autoconnect yes connection.autoconnect-retries 0 \
  ipv4.route-metric 900 ipv6.route-metric 900 >/dev/null
[ -n "$USER_" ] && nmcli connection modify "$NAME" gsm.username "$USER_"
[ -n "$PASS" ] && nmcli connection modify "$NAME" gsm.password "$PASS" gsm.password-flags 0
nmcli connection up "$NAME" || echo "   not up yet: check the SIM, the APN and the signal (mmcli -m any)"
nmcli -f NAME,DEVICE,STATE connection show --active
