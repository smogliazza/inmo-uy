#!/bin/sh
# Nightly encrypted database backup.
#   backup.sh daemon   wait for BACKUP_TIME (TZ, default 03:30 America/Montevideo) every day
#   backup.sh now      one backup right away
# Database connection: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (standard libpq variables).
# Retention: KEEP_DAILY daily copies (default 14) and KEEP_WEEKLY Sunday copies (default 8).
# Optional BACKUP_HEALTHCHECK_URL is called after every successful backup (e.g. healthchecks.io).
set -eu
. /usr/local/bin/rclone-env.sh

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

prune() {
  dir="$1"; keep="$2"
  total=$(rclone lsf "vault:$dir" 2>/dev/null | grep -c '\.sql\.gz$' || true)
  [ "$total" -gt "$keep" ] || return 0
  rclone lsf "vault:$dir" | grep '\.sql\.gz$' | sort | head -n "$((total - keep))" | while read -r f; do
    rclone deletefile "vault:$dir/$f" && log "pruned $dir/$f"
  done
}

run_backup() {
  name="inmo-$(date +%Y-%m-%d_%H%M%S).sql.gz"
  log "starting $name"
  # Upload under a temporary name and only rename it when pg_dump succeeded, so a failed run never
  # replaces or removes a good backup. (No `set -o pipefail` in POSIX sh: pg_dump's status goes to a marker.)
  rm -f /tmp/pgdump.failed
  { pg_dump --no-owner --no-privileges --clean --if-exists || touch /tmp/pgdump.failed; } | gzip -9 | rclone rcat "vault:partial/$name"
  if [ -f /tmp/pgdump.failed ]; then
    rclone deletefile "vault:partial/$name" 2>/dev/null || true
    log "FAILED: pg_dump returned an error"; return 1
  fi
  rclone moveto "vault:partial/$name" "vault:daily/$name"
  [ "$(date +%u)" = "7" ] && rclone copyto "vault:daily/$name" "vault:weekly/$name" && log "weekly copy kept"
  prune daily "$KEEP_DAILY"
  prune weekly "$KEEP_WEEKLY"
  log "done $name ($(rclone size --json "vault:daily/$name" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p') bytes, encrypted)"
  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then wget -q -O /dev/null "$BACKUP_HEALTHCHECK_URL" || log "warning: health check ping failed"; fi
}

case "${1:-daemon}" in
  now) run_backup ;;
  daemon)
    log "waiting for $BACKUP_TIME every day (TZ=$TZ)"
    last=""
    while true; do
      if [ "$(date +%H:%M)" = "$BACKUP_TIME" ] && [ "$last" != "$(date +%F)" ]; then
        last="$(date +%F)"
        run_backup || log "backup failed; will try again tomorrow"
      fi
      sleep 30
    done ;;
  *) echo "usage: backup.sh [daemon|now]" >&2; exit 2 ;;
esac
