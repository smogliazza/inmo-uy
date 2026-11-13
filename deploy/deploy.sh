#!/usr/bin/env bash
# Deploy a tagged release on the Droplet (spec 12.3). Runs in /opt/inmo-uy, next to docker-compose.prod.yml,
# Caddyfile and the .env files. The release workflow calls it over SSH; it can also be run by hand:
#
#   ./deploy.sh v1.2.0.0
#
# 1. pulls the images for the tag and recreates the containers (migrations run when the API starts);
# 2. waits until GET /api/health answers the tag's version (from inside the API container, so DNS / TLS
#    problems do not count as a failed release);
# 3. if it does not within 3 minutes, goes back to the previous tag and exits with an error.
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?usage: deploy.sh vX.Y.Z.W}"
# COMPOSE_FILE can add override files (docker-compose.prod.yml:other.yml); the production file is the default
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose)
PREV="$(cat .deployed-tag 2>/dev/null || true)"

up() {
    export TAG="$1"
    # DEPLOY_NO_PULL=1: use images already on this machine (testing a locally built release)
    [ "${DEPLOY_NO_PULL:-}" = "1" ] || "${COMPOSE[@]}" pull --quiet
    "${COMPOSE[@]}" up -d --remove-orphans
}

api_version() {
    "${COMPOSE[@]}" exec -T api node -e \
        "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(j=>console.log(j.version||'')).catch(()=>console.log(''))" \
        2>/dev/null | tr -d '\r'
}

wait_for() {
    local want="${1#v}"
    for _ in $(seq 1 36); do
        [ "$(api_version)" = "$want" ] && return 0
        sleep 5
    done
    return 1
}

echo "[deploy] ${PREV:-none} → $TAG"
up "$TAG"
if wait_for "$TAG"; then
    echo "$TAG" > .deployed-tag
    docker image prune -f >/dev/null
    echo "[deploy] $TAG is live"
    exit 0
fi

echo "[deploy] $TAG did not report version ${TAG#v} on /api/health" >&2
"${COMPOSE[@]}" logs --tail=80 api >&2 || true
if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    echo "[deploy] rolling back to $PREV" >&2
    up "$PREV"
    wait_for "$PREV" && echo "[deploy] back on $PREV" >&2 || echo "[deploy] WARNING: $PREV did not come back healthy either" >&2
fi
exit 1
