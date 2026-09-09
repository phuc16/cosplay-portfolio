#!/bin/sh

echo "Waiting for MySQL & applying migrations..."
# Retry migrate:latest until MySQL is reachable and schema is up to date.
# knex exits non-zero if the DB isn't ready yet, so loop instead of a fixed sleep.
n=0
until npx knex migrate:latest; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "Migrations still failing after $n attempts - aborting."
    exit 1
  fi
  echo "MySQL not ready or migration failed - retry $n/30 in 2s..."
  sleep 2
done
echo "Migrations applied."

echo "Running seeds (optional)..."
npx knex seed:run || echo "Seed step skipped (no seeds or seed error) - continuing."

echo "Starting..."
exec "$@"
