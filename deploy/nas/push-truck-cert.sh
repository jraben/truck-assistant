#!/bin/sh
# Send the truck's certificate from the NAS to the Pi (deploy/pi/https/README.md).
# The NAS issues and renews it (it already does that for the other *.jeffraben.com
# sites); this copies it over SSH whenever it changed and the truck is reachable
# (home Wi-Fi or Tailscale). Run it daily from the NAS's task scheduler or cron:
#   CERT_DIR=/volume1/certs/truck.jeffraben.com PI=jeff@slate-truck ./push-truck-cert.sh
# CERT_DIR holds fullchain.pem and privkey.pem (or set CERT / KEY to the two files).
# The truck away is not an error: it tries again next time.
set -eu
PI="${PI:?PI=user@host of the truck Pi, e.g. jeff@slate-truck}"
CERT="${CERT:-${CERT_DIR:?CERT_DIR (or CERT and KEY)}/fullchain.pem}"
KEY="${KEY:-${CERT_DIR}/privkey.pem}"
DEST="${DEST:-/var/lib/slate-cockpit/tls}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 ${SSH_OPTS:-}"
log() { echo "[truck-cert] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

[ -r "$CERT" ] && [ -r "$KEY" ] || { log "can't read $CERT / $KEY"; exit 1; }
want="$(cat "$CERT" "$KEY" | sha256sum | cut -d' ' -f1)"
have="$($SSH "$PI" "cat '$DEST/fullchain.pem' '$DEST/privkey.pem' 2>/dev/null | sha256sum | cut -d' ' -f1" 2>/dev/null)" || { log "truck not reachable: next time"; exit 0; }
[ "$want" = "$have" ] && { log "truck already has this certificate"; exit 0; }

# Into a scratch name, then renamed into place, so the brain never reads half a file.
$SSH "$PI" "umask 027 && cat > '$DEST/.fullchain.new'" < "$CERT"
$SSH "$PI" "umask 027 && cat > '$DEST/.privkey.new'" < "$KEY"
$SSH "$PI" "mv -f '$DEST/.privkey.new' '$DEST/privkey.pem' && mv -f '$DEST/.fullchain.new' '$DEST/fullchain.pem'"
log "certificate sent; the brain switches to it within a minute (check: curl -s http://<pi>:8080/api/https)"
