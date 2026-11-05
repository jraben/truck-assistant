#!/usr/bin/env bash
# Tier 2 remote access: Tailscale on the Pi, so the cockpit, /settings, /truck
# and the cameras open from your phone exactly as on the dash, over any link
# (home Wi-Fi, a hotspot, the LTE modem), with no ports opened anywhere.
#
#   sudo ./deploy/pi/tailscale/setup-tailscale.sh            # asks for the auth key
#   sudo TS_AUTHKEY=tskey-auth-... ./deploy/pi/tailscale/setup-tailscale.sh
#
# The auth key is typed at first setup and handed to tailscale once. It is
# never written to disk, the repo, or the brain's settings. Make it in the
# Tailscale admin console > Settings > Keys: reusable OFF, pre-approved, and
# tag it (e.g. tag:truck) so an ACL can limit what the truck may reach.
set -euo pipefail

HOSTNAME_TS="${TS_HOSTNAME:-slate-truck}"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

if ! command -v tailscale >/dev/null; then
  echo "== installing Tailscale (official apt repository)"
  . /etc/os-release
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${VERSION_CODENAME}.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/debian/${VERSION_CODENAME}.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list
  apt-get update -qq
  apt-get install -y -qq tailscale >/dev/null
fi
systemctl enable --now tailscaled >/dev/null

if tailscale status >/dev/null 2>&1; then
  echo "== already on the tailnet as $(tailscale status --self --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName)}catch{console.log("?")}})')"
  exit 0
fi

KEY="${TS_AUTHKEY:-}"
if [ -z "$KEY" ]; then
  [ -t 0 ] || { echo "No terminal to ask on: run it again with TS_AUTHKEY=... in the environment."; exit 1; }
  read -r -s -p "Tailscale auth key (tskey-auth-…, not shown): " KEY; echo
fi
[ -n "$KEY" ] || { echo "no key given"; exit 1; }

# --ssh off: the truck is not a jump host. Key expiry: disable it for this
# machine in the admin console, or the truck drops off the tailnet in 180 days.
tailscale up --authkey="$KEY" --hostname="$HOSTNAME_TS" --ssh=false --accept-dns=true
unset KEY TS_AUTHKEY
echo "== on the tailnet: http://${HOSTNAME_TS}:8080/truck (the link with the token is on /settings > Remote)"
