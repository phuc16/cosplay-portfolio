#!/bin/sh
# Restore a dump into a scratch database so it can be verified without
# touching production. Usage: ./restore.sh <dump.sql.gz> [target_db]
set -eu

DUMP="$1"
TARGET="${2:-cosplay_restore_test}"

[ -f "$DUMP" ] || { echo "No such dump: $DUMP" >&2; exit 1; }

docker compose exec -T mysql mysql -uroot -p"$DB_PASS" \
  -e "DROP DATABASE IF EXISTS \`$TARGET\`; CREATE DATABASE \`$TARGET\`;"

gunzip -c "$DUMP" | docker compose exec -T mysql mysql -uroot -p"$DB_PASS" "$TARGET"

echo "[RESTORE] Restored into $TARGET. Verifying:"
docker compose exec -T mysql mysql -uroot -p"$DB_PASS" "$TARGET" -e "
  SELECT 'orders' AS t, COUNT(*) AS n FROM orders
  UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
  UNION ALL SELECT 'products', COUNT(*) FROM products
  UNION ALL SELECT 'variants', COUNT(*) FROM product_variants
  UNION ALL SELECT 'sum_totals', COALESCE(SUM(total),0) FROM orders;"
