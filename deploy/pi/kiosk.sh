#!/bin/sh
# Chromium kiosk on the 12.3" 1920x720 bar. Started by the desktop autostart
# entry (slate-kiosk.desktop). Waits for the brain, then opens the cockpit.
URL="${SLATE_URL:-http://localhost:8080/}"

# CarPlay: WebUSB to the dongle and the mic for Siri/calls are granted by the
# managed policy (/etc/chromium/policies/managed/slate-cockpit.json, from
# chromium-policy.json); autoplay so CarPlay audio plays without a tap.
# --use-fake-ui-for-media-stream auto-accepts the mic prompt in case the
# policy isn't picked up (it only skips the prompt; the real mic is used).

# Blank-screen and power-saving off: this is a dashboard.
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

i=0
until curl -fsS -o /dev/null http://localhost:8080/api/health || [ $i -ge 60 ]; do i=$((i+1)); sleep 1; done

BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" \
  --kiosk --app="$URL" \
  --window-size=1920,720 --window-position=0,0 \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-features=Translate,TranslateUI --disable-pinch --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 --no-first-run \
  --autoplay-policy=no-user-gesture-required   --use-fake-ui-for-media-stream \
  --user-data-dir="$HOME/.config/slate-kiosk"
