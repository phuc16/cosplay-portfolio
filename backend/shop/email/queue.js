const db = require("./../../db")

const MAX_ATTEMPTS = 5

async function enqueue(orderId, type, toEmail, payload = null) {
  await db.query(
    "INSERT INTO email_queue (order_id, type, to_email, payload) VALUES (?, ?, ?, ?)",
    [orderId, type, toEmail, payload ? JSON.stringify(payload) : null]
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
  // payload cleared here too — once sent, nothing still needs the plaintext
  // it carried (e.g. the access PIN), so it shouldn't keep sitting in the row.
  await db.query(
    "UPDATE email_queue SET status = 'sent', sent_at = NOW(), payload = NULL WHERE id = ?", [id]
  )
}

/**
 * Record a failure. Once attempts reach MAX_ATTEMPTS the row is marked failed
 * so it stops being retried forever and stays visible for the seller.
 */
async function markFailed(id, error) {
  await db.query(
    // MySQL evaluates a single-table UPDATE's SET list left to right, so by
    // the time this CASE runs, `attempts` already reflects the `attempts + 1`
    // set above -- it is intentionally the POST-increment value, not the
    // pre-update one ANSI SQL/Postgres would give you here. Do NOT add
    // `+ 1` back below; that would silently shrink the retry budget by one.
    `UPDATE email_queue
        SET attempts = attempts + 1,
            last_error = ?,
            status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END
      WHERE id = ?`,
    [String(error).slice(0, 1000), MAX_ATTEMPTS, id]
  )
}

module.exports = { enqueue, claimPending, markSent, markFailed, MAX_ATTEMPTS }
