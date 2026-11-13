#!/bin/sh
# Shared rclone configuration (environment only, nothing written to disk).
#   BACKUP_REMOTE              where backups go; default r2:$BACKUP_R2_BUCKET/db (a local path works for tests)
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_R2_BUCKET
#   BACKUP_ENCRYPTION_KEY      passphrase of the rclone crypt layer (keep a copy outside the server!)
#   BACKUP_ENCRYPTION_SALT     optional second passphrase (default derived from the key)
set -eu
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
if [ -z "${BACKUP_REMOTE:-}" ]; then
  : "${BACKUP_R2_BUCKET:?BACKUP_R2_BUCKET is required (or set BACKUP_REMOTE)}"
  : "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
  export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
  BACKUP_REMOTE="r2:${BACKUP_R2_BUCKET}/db"
fi
# File names stay readable (dates, for retention); the content is encrypted
export RCLONE_CONFIG_VAULT_TYPE=crypt RCLONE_CONFIG_VAULT_REMOTE="$BACKUP_REMOTE"
export RCLONE_CONFIG_VAULT_FILENAME_ENCRYPTION=off RCLONE_CONFIG_VAULT_DIRECTORY_NAME_ENCRYPTION=false
RCLONE_CONFIG_VAULT_PASSWORD="$(rclone obscure "$BACKUP_ENCRYPTION_KEY")"
RCLONE_CONFIG_VAULT_PASSWORD2="$(rclone obscure "${BACKUP_ENCRYPTION_SALT:-${BACKUP_ENCRYPTION_KEY}::salt}")"
export RCLONE_CONFIG_VAULT_PASSWORD RCLONE_CONFIG_VAULT_PASSWORD2
