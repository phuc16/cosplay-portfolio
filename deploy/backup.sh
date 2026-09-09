#!/bin/sh
# Nightly MySQL backup with retention.
# Orders are financial and dispute-resolution records; DEPLOY.md previously
# only recommended backups and nothing was implemented.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cosplay}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-cosplay}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose exec -T mysql mysqldump \
  -uroot -p"$DB_PASS" \
  --single-transaction --quick --routines --triggers \
  "$DB_NAME" | gzip > "$OUT"

# A zero-length or truncated dump is worse than no dump, because it looks like
# a backup. Fail loudly instead.
if [ ! -s "$OUT" ]; then
  echo "[BACKUP] FAILED: $OUT is empty" >&2
  rm -f "$OUT"
  exit 1
fi

if ! gzip -t "$OUT"; then
  echo "[BACKUP] FAILED: $OUT is corrupt" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "[BACKUP] OK $OUT ($(du -h "$OUT" | cut -f1))"
