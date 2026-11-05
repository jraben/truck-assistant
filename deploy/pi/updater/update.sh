#!/usr/bin/env bash
# Slate Cockpit updater. Runs as the slate user (slate-updater.service), started
# by slate-updater.path when the brain writes $DATA/update/request.json.
#
# install: fetch the release (prebuilt tarball from the release workflow, else the
#   source tarball, or UPDATE_METHOD=git: git clone of the tag), npm ci (+ build),
#   switch /opt/slate-cockpit-releases/current, restart the brain (the one sudo
#   rule), wait for /api/health and the new version; anything wrong -> switch back.
# rollback: swap current and previous, restart, check health.
# Progress goes to $DATA/update/status.json, which the brain shows on /settings.
# Idempotent: a release dir already built for the same tag is reused.
set -uo pipefail

DATA="${DATA_DIR:-/var/lib/slate-cockpit}"
REL="${RELEASES_DIR:-/opt/slate-cockpit-releases}"
PORT="${PORT:-8080}"
UPD="$DATA/update"
REQ="$UPD/request.json"
JOB="$UPD/request.taken.json"
HEALTH_WAIT="${HEALTH_WAIT:-120}"

[ -f "$REQ" ] || exit 0
mv -f "$REQ" "$JOB"

field() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=j[process.argv[2]];process.stdout.write(v==null?"":String(v))' "$JOB" "$1"; }
ID="$(field id)"; ACTION="$(field action)"; TAG="$(field tag)"; SHA="$(field sha)"; CHANNEL="$(field channel)"
ASSET="$(field assetUrl)"; TARBALL="$(field tarballUrl)"; REPO="$(field repo)"

status() { # phase message
  node -e 'const [f,id,phase,msg,tag,prev]=process.argv.slice(1);const fs=require("fs");fs.writeFileSync(f+".tmp",JSON.stringify({id,phase,message:msg,at:new Date().toISOString(),tag:tag||null,previous:prev||null},null,2));fs.renameSync(f+".tmp",f)' \
    "$UPD/status.json" "$ID" "$1" "$2" "$TAG" "$(readlink "$REL/previous" 2>/dev/null || true)"
  echo "[update] $1: $2"
}
fail() { status failed "$1"; exit 1; }

case "$ID" in ''|*[!A-Za-z0-9-]*) echo "bad job id"; exit 1 ;; esac
safe_url() { case "$1" in https://github.com/*|https://api.github.com/*|'') return 0 ;; *) return 1 ;; esac; }
safe_url "$ASSET" && safe_url "$TARBALL" && safe_url "$REPO" || fail "refusing a download from outside github.com"

health_ok() { # expected tag (or empty)
  local want="$1" i=0 v
  while [ "$i" -lt "$HEALTH_WAIT" ]; do
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok":true'; then
      [ -z "$want" ] && return 0
      v="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/api/update/version" 2>/dev/null || true)"
      case "$v" in *"\"tag\":\"$want\""*) return 0 ;; esac
    fi
    sleep 2; i=$((i + 2))
  done
  return 1
}
restart() { sudo -n /usr/bin/systemctl restart slate-brain; }
point() { ln -sfn "$2" "$REL/.$1.new" && mv -Tf "$REL/.$1.new" "$REL/$1"; } # atomic symlink swap

if [ "$ACTION" = rollback ]; then
  CUR="$(readlink "$REL/current")"; PREV="$(readlink "$REL/previous" || true)"
  [ -n "$PREV" ] && [ -d "$PREV" ] || fail "no previous version to go back to"
  status restarting "going back to $(basename "$PREV")"
  point current "$PREV"; point previous "$CUR"
  restart || fail "couldn't restart the brain (sudoers rule missing?)"
  status verifying "waiting for the brain"
  if health_ok ""; then status done "back on $(basename "$PREV")"; else point current "$CUR"; point previous "$PREV"; restart; fail "the previous version didn't start; stayed on $(basename "$CUR")"; fi
  exit 0
fi

[ "$ACTION" = install ] || fail "unknown action $ACTION"
case "$TAG" in ''|*[!A-Za-z0-9._@-]*) fail "bad tag" ;; esac
NAME="$(printf '%s' "$TAG" | tr '@' '-')"
DIR="$REL/$NAME"
BUILD="$REL/.build-$NAME"
CUR="$(readlink "$REL/current" 2>/dev/null || true)"
OLDPREV="$(readlink "$REL/previous" 2>/dev/null || true)"
[ "$DIR" = "$CUR" ] && { status done "$TAG is already running"; exit 0; }

if [ ! -f "$DIR/brain/dist/index.js" ]; then
  rm -rf "$BUILD"; mkdir -p "$BUILD"
  PREBUILT=0
  status downloading "fetching $TAG"
  if [ "${UPDATE_METHOD:-tarball}" = git ] && [ -n "$REPO" ]; then
    git clone --quiet --depth 1 --branch "${TAG#main@}" "$REPO" "$BUILD" 2>/dev/null \
      || { git clone --quiet "$REPO" "$BUILD" && git -C "$BUILD" checkout --quiet "${SHA:-$TAG}"; } || fail "git fetch of $TAG failed"
  elif [ -n "$ASSET" ] && curl -fsSL --retry 3 -o "$BUILD.tgz" "$ASSET"; then
    tar xzf "$BUILD.tgz" -C "$BUILD" --strip-components=1 || fail "release tarball unreadable"
    PREBUILT=1
  else
    curl -fsSL --retry 3 -o "$BUILD.tgz" "$TARBALL" || fail "download failed (offline?)"
    tar xzf "$BUILD.tgz" -C "$BUILD" --strip-components=1 || fail "source tarball unreadable"
  fi
  rm -f "$BUILD.tgz"
  cd "$BUILD" || fail "build dir missing"
  if [ "$PREBUILT" = 1 ] && [ -f brain/dist/index.js ]; then
    status building "installing dependencies"
    npm ci --omit=dev --no-audit --no-fund >"$UPD/build.log" 2>&1 || fail "npm ci failed (see $UPD/build.log)"
  else
    status building "npm ci and build (several minutes on a Pi)"
    { npm ci --no-audit --no-fund && npm run build && npm prune --omit=dev --no-audit --no-fund; } >"$UPD/build.log" 2>&1 || fail "build failed (see $UPD/build.log)"
  fi
  node -e 'const [f,tag,sha,channel]=process.argv.slice(1);require("fs").writeFileSync(f,JSON.stringify({tag,sha:sha||null,channel,installedAt:new Date().toISOString()},null,2))' "$BUILD/release.json" "$TAG" "$SHA" "$CHANNEL"
  rm -rf "$DIR"; mv "$BUILD" "$DIR"
fi

status restarting "switching to $TAG"
point current "$DIR"
[ -n "$CUR" ] && point previous "$CUR"
restart || { [ -n "$CUR" ] && point current "$CUR"; fail "couldn't restart the brain (sudoers rule missing?)"; }
status verifying "waiting for /api/health on $TAG"
if health_ok "$TAG"; then
  status done "$TAG is running"
  # keep current, previous and the original install; drop the rest
  for d in "$REL"/*/; do d="${d%/}"; [ -L "$d" ] && continue; [ "$d" = "$DIR" ] || [ "$d" = "$CUR" ] || rm -rf "$d"; done
else
  if [ -n "$CUR" ]; then point current "$CUR"; [ -n "$OLDPREV" ] && point previous "$OLDPREV"; restart; fi
  status rolled-back "$TAG didn't pass the health check in ${HEALTH_WAIT}s; back on $(basename "${CUR:-?}")"
  exit 1
fi
