#!/bin/sh
# The NAS copy updates itself: every $EVERY seconds, pull the image GitHub built
# from main (it's only pushed after a green build), and if it changed, restart the
# cockpit on it. If the new one isn't healthy within $HEALTH_WAIT seconds, put the
# old image back and leave that build alone until the next one.
# It also updates at once when the cockpit asks: tapping "Update available" in the
# footer writes $DATA/update/request.json (brain/src/ops/updater.ts DockerRunner);
# this script answers in $DATA/update/status.json (downloading, restarting, done, failed).
# Runs in the `updater` service of docker-compose.yml (docker:cli, docker.sock, the data volume).
set -u
STACK="${STACK:-/stack}"
SERVICE="${SERVICE:-slate-cockpit}"
CONTAINER="${CONTAINER:-slate-cockpit}"
IMAGE="${IMAGE:-ghcr.io/jraben/truck-assistant:latest}"
EVERY="${EVERY:-600}"
HEALTH_WAIT="${HEALTH_WAIT:-180}"
DATA="${DATA:-/data}"
REQ="$DATA/update/request.json"
STATUS="$DATA/update/status.json"
compose() { docker compose -p slate-cockpit --project-directory "$STACK" -f "$STACK/docker-compose.yml" "$@"; }
log() { echo "[auto-update] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
running_image() { docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null; }
bad=""
job=""      # the request being answered, if any
result=""   # what once() did: same | updated | rolled-back | pull-failed | restart-failed | bad-build

# status.json for the cockpit, only while answering a request (the brain matches the id).
say() {
  [ -n "$job" ] || return 0
  [ -d "$DATA/update" ] || return 0
  printf '{"id":"%s","phase":"%s","message":"%s","at":"%s"}\n' "$job" "$1" "$2" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

once() {
  result=""
  before="$(running_image)"
  say downloading "Downloading the newest build"
  if ! docker pull -q "$IMAGE" >/dev/null 2>&1; then log "pull failed (offline?)"; result=pull-failed; return; fi
  new="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)"
  [ -n "$new" ] || { result=pull-failed; return; }
  [ "$new" = "$before" ] && { result=same; return; }
  if [ "$new" = "$bad" ]; then result=bad-build; return; fi
  log "new build ${new#sha256:} (was ${before#sha256:}): restarting $SERVICE"
  say restarting "Restarting the cockpit on the new build (about a minute)"
  compose up -d --no-deps "$SERVICE" || { log "restart failed"; result=restart-failed; return; }
  waited=0
  while [ "$waited" -lt "$HEALTH_WAIT" ]; do
    sleep 10; waited=$((waited + 10))
    h="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)"
    [ "$h" = healthy ] && { log "healthy on the new build"; docker image prune -f >/dev/null 2>&1; result=updated; return; }
  done
  log "not healthy after ${HEALTH_WAIT}s: going back to ${before#sha256:}"
  bad="$new"
  if [ -n "$before" ]; then docker tag "$before" "$IMAGE" && compose up -d --no-deps "$SERVICE"; fi
  result=rolled-back
}

answer() {
  case "$result" in
    updated) say done "Updated: the cockpit is running the new build" ;;
    same) say done "Already on the newest build" ;;
    rolled-back) say rolled-back "The new build didn't start properly, so the previous one is back" ;;
    bad-build) say failed "That build failed before and was skipped; the next one will install" ;;
    pull-failed) say failed "Couldn't download the build (is the NAS online?)" ;;
    *) say failed "The restart didn't go through; the running version is unchanged" ;;
  esac
}

log "watching $IMAGE every ${EVERY}s for $SERVICE (and $REQ)"
since=$EVERY   # check at start
while :; do
  if [ -f "$REQ" ]; then
    job="$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "$REQ" | head -n 1)"
    rm -f "$REQ"
    log "update asked for from the cockpit (${job:-no id})"
    once; answer; job=""; since=0
  elif [ "$since" -ge "$EVERY" ]; then
    once; since=0
  fi
  sleep 10; since=$((since + 10))
done
