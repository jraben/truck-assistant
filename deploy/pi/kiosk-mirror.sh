#!/bin/sh
# The optional Mirror screen (ui/src/mirror) in its own Chromium window on a 1920x720 touch bar
# display over the rear-view mirror. Started by slate-mirror.desktop next to the main kiosk.
# Does nothing unless Settings > Cameras > "Mirror screen (optional)" is on.
#
# Which display: the last one xrandr lists as connected (the mirror bar is the second HDMI;
# with the tablet as the main screen it may be the Pi's only display). SLATE_MIRROR_OUTPUT=HDMI-2
# picks one by name. Touch: map the bar's touch input to it once, e.g.
#   xinput map-to-output "<touch device name>" HDMI-2
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

i=0
until curl -fsS -o /dev/null http://localhost:8080/api/health || [ $i -ge 60 ]; do i=$((i+1)); sleep 1; done
curl -fsS http://localhost:8080/api/cams | grep -q '"mirrorScreen":true' || { echo "Mirror screen is off (Settings > Cameras)"; exit 0; }

OUT="${SLATE_MIRROR_OUTPUT:-$(xrandr --query 2>/dev/null | awk '/ connected/ {o=$1} END {print o}')}"
GEOM=$(xrandr --query 2>/dev/null | awk -v o="$OUT" '$1 == o { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+x[0-9]+\+[0-9]+\+[0-9]+$/) print $i }')
POS=$(echo "${GEOM:-1920x720+0+0}" | sed -E 's/^[0-9]+x[0-9]+\+([0-9]+)\+([0-9]+)$/\1,\2/')
SIZE=$(echo "${GEOM:-1920x720+0+0}" | sed -E 's/^([0-9]+)x([0-9]+).*/\1,\2/')

BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" \
  --kiosk --app="http://localhost:8080/?mirror" \
  --window-size="$SIZE" --window-position="$POS" \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI --disable-pinch --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 --no-first-run \
  --user-data-dir="$HOME/.config/slate-mirror"
