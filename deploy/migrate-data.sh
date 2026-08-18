#!/bin/sh
# One-time data migration from an old server to this (new) one: the MySQL
# database (via mysqldump, same as backup.sh) and the MinIO object storage
# volume (original images + thumbnails + payment-proof screenshots — the
# "known gap" DEPLOY.md flags as never having a backup mechanism of its
# own, so this is also the first script in this repo that touches it).
#
# Run this ON THE NEW SERVER, after ./deploy/auto-deploy.sh has already
# brought the new stack up (so docker-compose.pull.yml's containers exist
# to receive the data). Requires root-SSH from this box to the OLD server
# (test with `ssh root@OLD_HOST true` first — set up a key if that prompts
# for a password, this script never handles interactive auth).
#
# Usage:
#   ./deploy/migrate-data.sh root@OLD_HOST [OLD_INSTALL_DIR]
#   OLD_INSTALL_DIR defaults to /opt/cosplay-portfolio (auto-deploy.sh's
#   own default — override if the old server used a different --dir).
#
# Safety model (mirrors deploy/restore.sh, not a blind overwrite):
#   1. Pull a fresh mysqldump + a tar of the MinIO volume from OLD_HOST.
#   2. Restore the dump into a SCRATCH database first and print row counts
#      — verify these against the old server's live counts yourself before
#      continuing.
#   3. Explicit typed confirmation ("yes") before touching this server's
#      real `cosplay` database or `minio_data` volume — both may already
#      have been initialized (migrations ran, an empty bucket exists) by
#      auto-deploy.sh, and this step replaces that.
#   4. MinIO is briefly stopped on the OLD server during its copy (a raw
#      volume tar of files mid-write would risk a corrupt object) — order
#      pages/images on the OLD server will 404 for that window. MySQL
#      needs no such pause: --single-transaction gives a consistent
#      snapshot without locking or stopping anything.
set -eu

OLD_HOST="${1:-}"
OLD_DIR="${2:-/opt/cosplay-portfolio}"
NEW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/tmp/cosplay-migrate-$$"

log() { echo "[MIGRATE] $*"; }
die() { echo "[MIGRATE] ERROR: $*" >&2; exit 1; }

[ -n "$OLD_HOST" ] || die "Usage: $0 root@OLD_HOST [OLD_INSTALL_DIR]"
[ -f "$NEW_DIR/docker-compose.pull.yml" ] || die "Run this from the new server's cosplay-portfolio checkout (docker-compose.pull.yml not found under $NEW_DIR)."
command -v ssh >/dev/null 2>&1 || die "ssh not found."

# accept-new: auto-trusts a host key this box has never seen before (exactly
# the "yes/no, are you sure" prompt a normal first-time ssh would ask) —
# without it, BatchMode=yes below refuses that prompt outright and just
# fails instead of defaulting either way. Still REJECTS a host key that
# changed since a previous connection (the actual MITM protection), so this
# isn't a blanket StrictHostKeyChecking=no. Applied consistently to every
# ssh call in this script via SSH_OPTS, not just the first check, so a
# single successful check doesn't leave later calls depending on ordering.
SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

log "Checking SSH access to $OLD_HOST..."
# shellcheck disable=SC2086
ssh $SSH_OPTS "$OLD_HOST" true \
  || die "Cannot SSH to $OLD_HOST non-interactively. Copy an SSH key there first (ssh-copy-id $OLD_HOST) — this script never prompts for a password."

# Resolves the actual (project-name-prefixed) Docker volume behind a
# service's mount, on whichever host $1 runs the ssh-prefix for — rather
# than assuming the compose project name (and therefore the volume name)
# matches "cosplay-portfolio", which only holds if both servers used the
# exact same --dir with auto-deploy.sh. $4 is that host's own compose-file
# directory (OLD_DIR for the remote call, NEW_DIR for the local one) — a
# previous version of this function hardcoded OLD_DIR for both, which
# silently broke the local (new-server) lookup whenever the two servers
# used different --dir values.
remote_volume_name() {
  # $1 = ssh prefix ("" for local, "ssh HOST" for remote), $2 = service,
  # $3 = mount path, $4 = that host's install dir
  $1 sh -c "docker inspect \$(docker compose -f '$4/docker-compose.pull.yml' ps -q '$2') --format '{{ range .Mounts }}{{ if eq .Destination \"$3\" }}{{ .Name }}{{ end }}{{ end }}'"
}

mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# ── 1. MySQL: pull a DATA-ONLY dump from the old server ─────────────────
# --no-create-info --complete-insert deliberately, NOT a full schema+data
# dump: the old server may be on an older code version (fewer migrations
# applied — e.g. it never ran the ones adding orders.access_pin_hash or
# email_queue.payload) than this new server's already-fully-migrated,
# currently-empty schema. A normal dump's CREATE TABLE statements (which
# mysqldump prefixes with DROP TABLE IF EXISTS by default) would silently
# regress this server's tables back to the OLD, narrower schema on import.
# --complete-insert names columns explicitly per row, so importing old
# rows into a table with EXTRA (nullable) columns the old server never had
# just leaves those columns NULL for migrated rows — correct, not an error.
log "Reading DB_PASS from $OLD_HOST:$OLD_DIR/.env..."
OLD_DB_PASS="$(ssh $SSH_OPTS "$OLD_HOST" "grep -m1 '^DB_PASS=' '$OLD_DIR/.env' | cut -d= -f2-")"
[ -n "$OLD_DB_PASS" ] || die "Could not read DB_PASS from $OLD_HOST:$OLD_DIR/.env"

log "Dumping MySQL data (schema-agnostic) from $OLD_HOST (--single-transaction, no downtime there)..."
ssh $SSH_OPTS "$OLD_HOST" "cd '$OLD_DIR' && docker compose -f docker-compose.pull.yml exec -T mysql \
  mysqldump -uroot -p'$OLD_DB_PASS' --single-transaction --quick --no-create-info --complete-insert cosplay" \
  | gzip > "$WORK/cosplay-data.sql.gz"

[ -s "$WORK/cosplay-data.sql.gz" ] || die "Dump is empty — aborting before touching anything on this server."
gzip -t "$WORK/cosplay-data.sql.gz" || die "Dump is corrupt — aborting."
log "Dump OK ($(du -h "$WORK/cosplay-data.sql.gz" | cut -f1))."

# ── 2. Restore into a scratch DB here first — verify before committing ──
# The scratch DB needs THIS server's current (fully-migrated) schema before
# the data-only dump can load into it — cloned from the live 'cosplay' DB's
# structure (auto-deploy.sh already ran every migration against it), not
# from the old dump, which carries no schema at all anymore.
NEW_DB_PASS="$(grep -m1 '^DB_PASS=' "$NEW_DIR/.env" | cut -d= -f2-)"
[ -n "$NEW_DB_PASS" ] || die "Could not read DB_PASS from $NEW_DIR/.env — run this after auto-deploy.sh has created it."

log "Cloning this server's current schema into scratch DB 'cosplay_migrate_test'..."
cd "$NEW_DIR"
docker compose -f docker-compose.pull.yml exec -T mysql mysqldump \
  -uroot -p"$NEW_DB_PASS" --no-data --routines --triggers cosplay > "$WORK/schema.sql"
docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" \
  -e "DROP DATABASE IF EXISTS cosplay_migrate_test; CREATE DATABASE cosplay_migrate_test;"
docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" \
  cosplay_migrate_test < "$WORK/schema.sql"

# FOREIGN_KEY_CHECKS=0 wraps the load since mysqldump's table dump order,
# while normally FK-safe, isn't guaranteed here on a filtered data-only
# dump — cheap insurance, same pattern tests/helpers/db.js already uses.
log "Loading old data into the scratch DB..."
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  gunzip -c "$WORK/cosplay-data.sql.gz"
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" cosplay_migrate_test

log "Verifying scratch DB counts:"
docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" cosplay_migrate_test -e "
  SELECT 'orders' AS t, COUNT(*) AS n FROM orders
  UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
  UNION ALL SELECT 'products', COUNT(*) FROM products
  UNION ALL SELECT 'variants', COUNT(*) FROM product_variants
  UNION ALL SELECT 'sum_totals', COALESCE(SUM(total),0) FROM orders;"

log ""
log "Compare the counts above against the OLD server's live numbers:"
log "  ssh $OLD_HOST \"cd $OLD_DIR && docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p'$OLD_DB_PASS' cosplay -e \\\"SELECT COUNT(*), COALESCE(SUM(total),0) FROM orders;\\\"\""
log ""
log "NOTE: migrated orders will have NULL access_pin_hash (the old server"
log "predates that column/feature entirely) — those buyers' PIN gate has"
log "nothing to verify against, so they cannot self-verify a PIN for their"
log "old order anymore. Admin's own login still bypasses it as normal."
log "Decide separately whether to backfill PINs (and notify affected"
log "buyers) for migrated orders — this script does not do that for you."
log ""

# ── 3. MinIO: stop on old (consistency), tar the volume, stream over ────
OLD_MINIO_VOLUME="$(remote_volume_name "ssh $SSH_OPTS $OLD_HOST" minio /data "$OLD_DIR")"
[ -n "$OLD_MINIO_VOLUME" ] || die "Could not find the MinIO volume on $OLD_HOST — is its 'minio' service running?"
log "Old server's MinIO volume: $OLD_MINIO_VOLUME"

log "Stopping MinIO on $OLD_HOST for a consistent copy (images/uploads there will 404 until it restarts)..."
ssh $SSH_OPTS "$OLD_HOST" "cd '$OLD_DIR' && docker compose -f docker-compose.pull.yml stop minio"

log "Streaming MinIO data from $OLD_HOST..."
ssh $SSH_OPTS "$OLD_HOST" "docker run --rm -v '$OLD_MINIO_VOLUME':/from alpine tar czf - -C /from ." > "$WORK/minio-data.tar.gz"

log "Restarting MinIO on $OLD_HOST..."
ssh $SSH_OPTS "$OLD_HOST" "cd '$OLD_DIR' && docker compose -f docker-compose.pull.yml start minio"

[ -s "$WORK/minio-data.tar.gz" ] || die "MinIO tar is empty — aborting before touching anything on this server."
log "MinIO archive OK ($(du -h "$WORK/minio-data.tar.gz" | cut -f1))."

# ── 4. Explicit confirmation before overwriting THIS server's real data ─
echo
echo "About to REPLACE on THIS server:"
echo "  - database 'cosplay' (whatever's there now — check the scratch-DB counts above first)"
echo "  - the MinIO 'minio_data' volume (all objects currently there, if any)"
echo
printf 'Type "yes" to continue: '
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || die "Aborted — nothing on this server was touched."

log "Clearing any existing rows in 'cosplay' first (so old-server IDs can't collide with anything already here)..."
cd "$NEW_DIR"
TABLES="$(docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" -N -e \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='cosplay' AND table_name NOT LIKE 'knex_migrations%';")"
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  for t in $TABLES; do echo "TRUNCATE TABLE \`$t\`;"; done
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" cosplay

log "Importing into the real 'cosplay' database..."
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  gunzip -c "$WORK/cosplay-data.sql.gz"
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p"$NEW_DB_PASS" cosplay

log "Loading MinIO data..."
NEW_MINIO_VOLUME="$(remote_volume_name "" minio /data "$NEW_DIR")"
[ -n "$NEW_MINIO_VOLUME" ] || die "Could not find the MinIO volume on this server — did auto-deploy.sh finish successfully?"
docker compose -f docker-compose.pull.yml stop minio
docker run --rm -v "$NEW_MINIO_VOLUME":/to -v "$WORK/minio-data.tar.gz":/minio-data.tar.gz:ro \
  alpine sh -c "rm -rf /to/* /to/..?* /to/.[!.]* 2>/dev/null; tar xzf /minio-data.tar.gz -C /to"
docker compose -f docker-compose.pull.yml start minio

log ""
log "Done. Verify:"
log "  - docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p\"\$DB_PASS\" cosplay -e \"SELECT COUNT(*) FROM orders;\""
log "  - open the site and confirm images/thumbnails load"
log "  - log into admin and spot-check a recent order's payment-proof photo"
log ""
log "Scratch DB 'cosplay_migrate_test' from step 2 is still there — drop it once you're satisfied:"
log "  docker compose -f docker-compose.pull.yml exec -T mysql mysql -uroot -p\"\$DB_PASS\" -e \"DROP DATABASE cosplay_migrate_test;\""
