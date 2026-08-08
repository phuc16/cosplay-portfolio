const db = require("./../../db")

const MAX_ATTEMPTS = 5

async function enqueue(orderId, type, toEmail) {
  await db.query(
    "INSERT INTO email_queue (order_id, type, to_email) VALUES (?, ?, ?)",
    [orderId, type, toEmail]
  )
}

/** Pending messages that have not exhausted their retries. */
async function claimPending(limit = 10) {
  const [rows] = await db.query(
    `SELECT * FROM email_queue
      WHERE status = 'pending' AND attempts < ?
      ORDER BY id ASC LIMIT ?`,
    [MAX_ATTEMPTS, limit]
  )
  return rows
}

async function markSent(id) {
  await db.query("UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?", [id])
}

/**
 * Record a failure. Once attempts reach MAX_ATTEMPTS the row is marked failed
 * so it stops being retried forever and stays visible for the seller.
 */
async function markFailed(id, error) {
  await db.query(
    `UPDATE email_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?`,
    [String(error).slice(0, 1000), MAX_ATTEMPTS, id]
  )
}

module.exports = { enqueue, claimPending, markSent, markFailed, MAX_ATTEMPTS }
