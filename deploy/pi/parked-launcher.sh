#!/bin/sh
# Parked apps launcher (Netflix, YouTube TV, games...). Runs in the kiosk's
# desktop session, started by kiosk.sh, because the brain is a service with
# no screen. Every second it asks the brain what to do (GET /api/parked/next,
# from localhost so no login) and opens or closes one full-screen window.
# The brain sends "close" the moment the truck moves.
BRAIN="${SLATE_BRAIN:-http://localhost:8080}"
BROWSER=$(command -v chromium || command -v chromium-browser)
have=""
for n in moonlight-qt retroarch; do command -v "$n" >/dev/null 2>&1 && have="$have,$n"; done
have="${have#,}"
last=0
pid=""

stop_app() { [ -n "$pid" ] && kill "$pid" 2>/dev/null; pid=""; }

while :; do
  j=$(curl -fsS -m 3 "$BRAIN/api/parked/next?have=$have" 2>/dev/null)
  seq=$(printf '%s' "$j" | sed -n 's/.*"seq":\([0-9]*\).*/\1/p')
  if [ -n "$seq" ] && [ "$seq" -gt "$last" ]; then
    last=$seq
    action=$(printf '%s' "$j" | sed -n 's/.*"action":"\([a-z]*\)".*/\1/p')
    url=$(printf '%s' "$j" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
    native=$(printf '%s' "$j" | sed -n 's/.*"native":"\([a-z0-9-]*\)".*/\1/p')
    stop_app
    if [ "$action" = open ] && [ -n "$native" ]; then
      case "$native" in
        moonlight-qt) moonlight-qt & pid=$! ;;
        retroarch) retroarch --fullscreen & pid=$! ;;
      esac
    elif [ "$action" = open ] && [ -n "$url" ]; then
      "$BROWSER" --app="$url" --kiosk --start-fullscreen --window-position=0,0 --window-size=1920,720 \
        --user-data-dir="$HOME/.config/slate-parked" --autoplay-policy=no-user-gesture-required \
        --noerrdialogs --disable-infobars --no-first-run & pid=$!
    fi
  fi
  # the window was closed by hand (Alt+F4, the app's own exit): forget it
  [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && pid=""
  sleep 1
done
