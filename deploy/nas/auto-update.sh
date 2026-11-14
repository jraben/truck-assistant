#!/bin/sh
# The NAS copy updates itself: every $EVERY seconds, pull the image GitHub built
# from main (it's only pushed after a green build), and if it changed, restart the
# cockpit on it. If the new one isn't healthy within $HEALTH_WAIT seconds, put the
# old image back and leave that build alone until the next one.
# Runs in the `updater` service of docker-compose.yml (docker:cli, docker.sock).
set -u
STACK="${STACK:-/stack}"
SERVICE="${SERVICE:-slate-cockpit}"
CONTAINER="${CONTAINER:-slate-cockpit}"
IMAGE="${IMAGE:-ghcr.io/jraben/truck-assistant:latest}"
EVERY="${EVERY:-600}"
HEALTH_WAIT="${HEALTH_WAIT:-180}"
compose() { docker compose -p slate-cockpit --project-directory "$STACK" -f "$STACK/docker-compose.yml" "$@"; }
log() { echo "[auto-update] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
running_image() { docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null; }
bad=""

once() {
  before="$(running_image)"
  if ! docker pull -q "$IMAGE" >/dev/null 2>&1; then log "pull failed (offline?)"; return; fi
  new="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)"
  [ -n "$new" ] || return
  [ "$new" = "$before" ] && return
  if [ "$new" = "$bad" ]; then return; fi
  log "new build ${new#sha256:} (was ${before#sha256:}): restarting $SERVICE"
  compose up -d --no-deps "$SERVICE" || { log "restart failed"; return; }
  waited=0
  while [ "$waited" -lt "$HEALTH_WAIT" ]; do
    sleep 10; waited=$((waited + 10))
    h="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)"
    [ "$h" = healthy ] && { log "healthy on the new build"; docker image prune -f >/dev/null 2>&1; return; }
  done
  log "not healthy after ${HEALTH_WAIT}s: going back to ${before#sha256:}"
  bad="$new"
  if [ -n "$before" ]; then docker tag "$before" "$IMAGE" && compose up -d --no-deps "$SERVICE"; fi
}

log "watching $IMAGE every ${EVERY}s for $SERVICE"
while :; do once; sleep "$EVERY"; done
