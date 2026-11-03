#!/usr/bin/env bash
#
# THE NIGHTLY DATABASE BACKUP: the whole Supabase database, dumped, locked with a passphrase, and sent to R2.
#
# Supabase's free plan keeps no backups, so this server does: one dump a night, kept 30 days in R2 and 7 days on this
# disk. Nothing here is printed but sizes and file names: never a connection string, a key or the passphrase.
#
#   Run it once by hand:   cd ~/tulmi && ./deploy/backup-db.sh
#   Every night (03:17 in India, 21:47 UTC):
#     (crontab -l 2>/dev/null | grep -v backup-db.sh; echo "47 21 * * * cd /root/tulmi && ./deploy/backup-db.sh >> /var/log/x0-backup.log 2>&1") | crontab -
#
# What it reads from tulmi/.env (only these lines; the file is never sourced):
#   SUPABASE_DB_URL         the SESSION POOLER connection string (Supabase → Connect → Session pooler; port 5432). The direct
#                           address is IPv6 only, which this server may not reach. A SECRET: it holds the database password
#   BACKUP_PASSPHRASE       locks each dump (AES-256, openssl). Keep a copy somewhere safe off this server: without it a
#                           backup cannot be opened. Unset: the dump goes up unlocked (the bucket is private, but lock it)
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   the same R2 token the media files use
#   BACKUP_R2_BUCKET        where the dumps go (default: R2_BUCKET), under backups/db/
#
# To bring a backup back (into a NEW, empty database first, to check it, before ever touching the live one):
#   aws s3 cp s3://<bucket>/backups/db/x0-db-2026-11-03.dump.enc . --endpoint-url https://<account>.r2.cloudflarestorage.com
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in x0-db-2026-11-03.dump.enc \
#     | docker run -i --rm -e DBURL postgres:17-alpine sh -c 'pg_restore --no-owner --no-privileges --clean --if-exists -d "$DBURL"'
# with BACKUP_PASSPHRASE and DBURL (the target database) set in your shell.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-tulmi/.env}"
LOCAL_DIR="${BACKUP_DIR:-/root/x0-backups}"
KEEP_LOCAL_DAYS=7
KEEP_R2_DAYS=30
PG_IMAGE="postgres:17-alpine"
AWS_IMAGE="amazon/aws-cli:2.22.0"

# One value from the env file: the last line that sets it, without quotes. Never sourced, so nothing else in it runs.
val() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" | tr -d '\r'; }
say() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$1"; }
die() { say "FAILED: $1"; exit 1; }

[ -f "$ENV_FILE" ] || die "no $ENV_FILE"
DBURL="$(val SUPABASE_DB_URL)"
[ -n "$DBURL" ] || die "SUPABASE_DB_URL is not set in $ENV_FILE (Supabase → Connect → Session pooler)"
R2_ACCOUNT="$(val R2_ACCOUNT_ID)"
BUCKET="$(val BACKUP_R2_BUCKET)"; BUCKET="${BUCKET:-$(val R2_BUCKET)}"
[ -n "$R2_ACCOUNT" ] && [ -n "$BUCKET" ] || die "R2_ACCOUNT_ID and R2_BUCKET (or BACKUP_R2_BUCKET) must be set"
AWS_ACCESS_KEY_ID="$(val R2_ACCESS_KEY_ID)"; AWS_SECRET_ACCESS_KEY="$(val R2_SECRET_ACCESS_KEY)"
[ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] || die "R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set"
BACKUP_PASSPHRASE="$(val BACKUP_PASSPHRASE)"
# Handed to the containers by name (-e NAME), so no value is ever on a command line.
export DBURL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY BACKUP_PASSPHRASE AWS_DEFAULT_REGION=auto

DAY="$(date -u +%F)"
mkdir -p "$LOCAL_DIR" && chmod 700 "$LOCAL_DIR"
umask 077

# ------------------------------------------------------------------ dump
RAW="$LOCAL_DIR/x0-db-$DAY.dump"
say "dumping the database"
# Custom format: compressed, and pg_restore can bring back one table on its own.
docker run --rm -e DBURL -e PGCONNECT_TIMEOUT=30 "$PG_IMAGE" \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges "$DBURL"' > "$RAW" \
  || { rm -f "$RAW"; die "pg_dump failed (check SUPABASE_DB_URL is the session pooler string)"; }
[ -s "$RAW" ] || { rm -f "$RAW"; die "the dump is empty"; }

# ------------------------------------------------------------------ lock
if [ -n "$BACKUP_PASSPHRASE" ]; then
  OUT="$RAW.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$RAW" -out "$OUT" || die "could not lock the dump"
  rm -f "$RAW"
else
  OUT="$RAW"
  say "warning: BACKUP_PASSPHRASE is not set, so this dump is not locked"
fi
say "dump ready: $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"

# ------------------------------------------------------------------ send to R2
aws() { docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -v "$LOCAL_DIR:/b" "$AWS_IMAGE" "$@" --endpoint-url "https://$R2_ACCOUNT.r2.cloudflarestorage.com"; }
aws s3 cp "/b/$(basename "$OUT")" "s3://$BUCKET/backups/db/$(basename "$OUT")" --only-show-errors || die "upload to R2 failed"
say "sent to R2: backups/db/$(basename "$OUT")"

# ------------------------------------------------------------------ keep 30 days in R2, 7 here
CUTOFF="$(date -u -d "-$KEEP_R2_DAYS days" +%F)"
aws s3 ls "s3://$BUCKET/backups/db/" | awk '{print $4}' | while read -r name; do
  d="$(printf '%s' "$name" | sed -n 's/^x0-db-\([0-9-]\{10\}\)\..*/\1/p')"
  if [ -n "$d" ] && [[ "$d" < "$CUTOFF" ]]; then aws s3 rm "s3://$BUCKET/backups/db/$name" --only-show-errors && say "removed old: $name"; fi
done
find "$LOCAL_DIR" -name 'x0-db-*' -type f -mtime +"$KEEP_LOCAL_DAYS" -delete

say "backup done"
