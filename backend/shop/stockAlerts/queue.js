const db = require("./../../db")

const MAX_ATTEMPTS = 5

/**
 * `conn` is accepted explicitly (rather than always using the pool) so this
 * can be called from inside catalogRepo.replaceVariants' own transaction -
 * pass the plain `db` module when calling outside a transaction (see
 * stockAlerts/sender.js's claimPending/markSent/markFailed calls below).
 */
async function enqueueMany(conn, rows) {
  if (!rows.length) return
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?)").join(", ")
  const values = rows.flatMap((r) => [
    r.product_variant_id, r.email, r.product_name_snapshot,
    r.variant_label_snapshot, r.collection_slug_snapshot,
  ])
  await conn.query(
    `INSERT INTO stock_alert_queue
       (product_variant_id, email, product_name_snapshot, variant_label_snapshot, collection_slug_snapshot)
     VALUES ${placeholders}`,
    values
  )
}

/** Pending messages that have not exhausted their retries. */
async function claimPending(limit = 10) {
  const [rows] = await db.query(
    `SELECT * FROM stock_alert_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY id ASC LIMIT ?`,
    [MAX_ATTEMPTS, limit]
  )
  return rows
}

async function markSent(id) {
  await db.query(
    "UPDATE stock_alert_queue SET status = 'sent', sent_at = NOW() WHERE id = ?", [id]
  )
}

/**
 * Record a failure. Same post-increment CASE evaluation order as
 * email/queue.js::markFailed - by the time this CASE runs, `attempts`
 * already reflects the `attempts + 1` set above, so it is intentionally
 * the POST-increment value being compared against MAX_ATTEMPTS.
 */
async function markFailed(id, error) {
  await db.query(
    `UPDATE stock_alert_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?`,
    [String(error).slice(0, 1000), MAX_ATTEMPTS, id]
  )
}

/** Failed messages, for surfacing in the admin. */
async function listFailed() {
  const [rows] = await db.query(
    "SELECT * FROM stock_alert_queue WHERE status = 'failed' ORDER BY id DESC LIMIT 50"
  )
  return rows
}

module.exports = { enqueueMany, claimPending, markSent, markFailed, listFailed, MAX_ATTEMPTS }
