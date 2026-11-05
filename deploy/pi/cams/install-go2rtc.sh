#!/usr/bin/env bash
# go2rtc for the cameras, pinned. install.sh runs this; safe to run again.
# The brain writes the config (DATA_DIR/go2rtc.yaml, from /settings > Cameras)
# and runs go2rtc itself, so there is no unit to enable here.
#
#   sudo ./deploy/pi/cams/install-go2rtc.sh
#   GO2RTC_SHA256=<hash> sudo -E ./deploy/pi/cams/install-go2rtc.sh   # verify the download
set -euo pipefail

GO2RTC_VERSION="${GO2RTC_VERSION:-1.9.9}"
BIN=/usr/local/bin/go2rtc

[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv6l) ARCH=arm ;;
  x86_64) ARCH=amd64 ;;
  *) echo "unsupported CPU $(uname -m)"; exit 1 ;;
esac

if [ -x "$BIN" ] && "$BIN" -version 2>/dev/null | grep -q "$GO2RTC_VERSION"; then
  echo "   go2rtc $GO2RTC_VERSION already installed"
  exit 0
fi

URL="https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${ARCH}"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
echo "   downloading go2rtc $GO2RTC_VERSION ($ARCH)"
curl -fsSL "$URL" -o "$TMP"
SUM=$(sha256sum "$TMP" | cut -d' ' -f1)
if [ -n "${GO2RTC_SHA256:-}" ]; then
  [ "$SUM" = "$GO2RTC_SHA256" ] || { echo "   sha256 mismatch: got $SUM, expected $GO2RTC_SHA256"; exit 1; }
else
  echo "   sha256 $SUM (set GO2RTC_SHA256 to check it against the release page next time)"
fi
install -m 0755 "$TMP" "$BIN"
"$BIN" -version || true
