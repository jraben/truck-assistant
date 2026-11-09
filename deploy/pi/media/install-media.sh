#!/usr/bin/env bash
# Track B on the Pi: AM/FM (RTL-SDR + ffmpeg), the Spotify Connect speaker
# (librespot, from the raspotify package) and the music folder. Called by
# install.sh; safe to run again. Needs root.
set -euo pipefail
DATA="${DATA:-/var/lib/slate-cockpit}"

echo "== media: rtl-sdr and ffmpeg (AM/FM)"
apt-get install -y -qq rtl-sdr ffmpeg >/dev/null
# The kernel's DVB-T driver grabs RTL-SDR dongles first; keep it off them.
echo 'blacklist dvb_usb_rtl28xxu' > /etc/modprobe.d/blacklist-rtl-sdr.conf
modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true

echo "== media: nrsc5 (HD Radio channels HD1-HD4 on the same tuner)"
# Built from source at a pinned release commit (github.com/theori-io/nrsc5, v3.2.0); the brain
# finds it on PATH. A failed build only leaves HD Radio off: analog FM keeps working.
NRSC5_COMMIT=a5c09723b135327aeef157770caae9aebf597547
if ! command -v nrsc5 >/dev/null; then
  apt-get install -y -qq git build-essential cmake autoconf libtool pkg-config libao-dev libfftw3-dev librtlsdr-dev libusb-1.0-0-dev >/dev/null
  SRC=$(mktemp -d)
  if git clone -q https://github.com/theori-io/nrsc5.git "$SRC/nrsc5" && git -C "$SRC/nrsc5" checkout -q "$NRSC5_COMMIT" \
    && cmake -S "$SRC/nrsc5" -B "$SRC/nrsc5/build" >/dev/null && make -s -C "$SRC/nrsc5/build" -j"$(nproc)" >/dev/null \
    && make -s -C "$SRC/nrsc5/build" install >/dev/null; then
    ldconfig; echo "   nrsc5 $(nrsc5 -v 2>&1 | head -1)"
  else
    echo "   note: nrsc5 didn't build; HD Radio stays off (analog FM still works)"
  fi
  rm -rf "$SRC"
fi

echo "== media: librespot (Spotify Connect) from raspotify"
if ! command -v librespot >/dev/null; then
  # raspotify's own apt repository (https://dtcooper.github.io/raspotify); it ships /usr/bin/librespot.
  curl -fsSL https://dtcooper.github.io/raspotify/key.asc | gpg --dearmor --yes -o /usr/share/keyrings/raspotify-archive-keyrings.gpg
  echo 'deb [signed-by=/usr/share/keyrings/raspotify-archive-keyrings.gpg] https://dtcooper.github.io/raspotify raspotify main' > /etc/apt/sources.list.d/raspotify.list
  apt-get update -qq && apt-get install -y -qq raspotify >/dev/null || echo "   note: raspotify didn't install; Spotify Connect stays off (the Media view says so)"
fi
# The brain runs librespot itself (name, bitrate from /settings), so raspotify's own service stays off.
systemctl disable --now raspotify >/dev/null 2>&1 || true

echo "== media: the brain's groups and music folder"
usermod -aG audio,plugdev slate
install -d -o slate -g slate -m 0755 "$DATA/music"
echo "   copy music into $DATA/music (Artist/Album/NN - Title.mp3)"
