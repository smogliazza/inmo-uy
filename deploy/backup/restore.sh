#!/bin/sh
# Restore a backup into a database (spec 12.4, guides/restore.md).
#   restore.sh list                         backups available (daily/ and weekly/)
#   restore.sh latest|<daily/NAME|weekly/NAME>  restore into RESTORE_DATABASE_URL
# RESTORE_DATABASE_URL is required and must point to an EMPTY database (a fresh one, or a test server):
# the dump drops and recreates every table it contains.
set -eu
. /usr/local/bin/rclone-env.sh

case "${1:-}" in
  list) rclone lsf -R vault: | grep '\.sql\.gz$' | sort; exit 0 ;;
  "") echo "usage: restore.sh list | latest | daily/NAME | weekly/NAME" >&2; exit 2 ;;
esac
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required (an empty database)}"
src="$1"
if [ "$src" = "latest" ]; then src="daily/$(rclone lsf vault:daily | grep '\.sql\.gz$' | sort | tail -n 1)"; fi
echo "[restore] $src → $(echo "$RESTORE_DATABASE_URL" | sed 's|//[^@]*@|//***@|')"
rclone cat "vault:$src" | gunzip | psql --quiet --set ON_ERROR_STOP=1 "$RESTORE_DATABASE_URL"
echo "[restore] done. Check: psql \"\$RESTORE_DATABASE_URL\" -c 'select count(*) from \"Property\"'"
