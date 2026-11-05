#!/usr/bin/env bash
# Build the flashable image with pi-gen (in Docker), on a Linux machine with Docker:
#   ./deploy/image/build.sh                     # builds the app from this checkout
#   APP_TARBALL=slate-cockpit-v0.2.0.tar.gz ./deploy/image/build.sh
#       (a release tarball already in stage-slate/00-app/files)
# Output: deploy/image/work/pi-gen/deploy/*.img.xz, and the desktop user's random
# password in deploy/image/work/first-user-password.txt.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$HERE/work"
PI_GEN_REPO="${PI_GEN_REPO:-https://github.com/RPi-Distro/pi-gen.git}"
PI_GEN_REF="${PI_GEN_REF:-arm64}"   # pi-gen's 64-bit branch; check its README for the current name
FILES="$HERE/stage-slate/00-app/files"
mkdir -p "$WORK"

if [ -n "${APP_TARBALL:-}" ]; then
  cp "$FILES/$APP_TARBALL" "$FILES/app.tar.gz"
else
  echo "== building the app"
  (cd "$ROOT" && npm ci --no-audit --no-fund && npm run build)
  TAG="$(git -C "$ROOT" describe --tags --always 2>/dev/null || echo dev)"
  SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo)"
  node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({tag: process.argv[2], sha: process.argv[3] || null, channel: "stable", builtAt: new Date().toISOString()}, null, 2))' "$ROOT/release.json" "$TAG" "$SHA"
  (cd "$ROOT" && tar czf "$FILES/app.tar.gz" --transform 's,^,slate-cockpit/,' \
    package.json package-lock.json release.json LICENSE README.md brain/package.json brain/dist ui/package.json ui/dist deploy docs)
  rm -f "$ROOT/release.json"
fi

[ -d "$WORK/pi-gen/.git" ] || git clone --depth 1 --branch "$PI_GEN_REF" "$PI_GEN_REPO" "$WORK/pi-gen"
rm -rf "$WORK/pi-gen/stage-slate"
cp -r "$HERE/stage-slate" "$WORK/pi-gen/stage-slate"
chmod +x "$WORK/pi-gen/stage-slate/prerun.sh" "$WORK/pi-gen/stage-slate/00-app/01-run.sh"
touch "$WORK/pi-gen/stage2/SKIP_IMAGES" "$WORK/pi-gen/stage3/SKIP_IMAGES"   # only our final image
cp "$HERE/config" "$WORK/pi-gen/config"
PW="$(tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c 16)"
echo "FIRST_USER_PASS=$PW" >> "$WORK/pi-gen/config"
(umask 077; echo "$PW" > "$WORK/first-user-password.txt")
cd "$WORK/pi-gen" && ./build-docker.sh
echo "== image: $(ls "$WORK"/pi-gen/deploy/*.img.xz 2>/dev/null)"
