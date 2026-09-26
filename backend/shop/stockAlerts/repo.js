const db = require("../../db")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class InvalidEmailError extends Error {
  constructor() { super("Email không hợp lệ"); this.name = "InvalidEmailError" }
}
class VariantNotFoundError extends Error {
  constructor() { super("Không tìm thấy phân loại sản phẩm"); this.name = "VariantNotFoundError" }
}
class VariantNotSoldOutError extends Error {
  constructor() { super("Phân loại này chưa hết hàng"); this.name = "VariantNotSoldOutError" }
}

/**
 * Sign up (or resubscribe) an email for a restock alert on one variant.
 * Strictly 0 stock only - NULL means unlimited and can never be "sold out"
 * (same rule ProductCard.jsx's isSoldOut already enforces on the frontend).
 */
async function signUp({ variant_id, email }) {
  if (!EMAIL_RE.test(String(email || "").trim())) throw new InvalidEmailError()

  const [[variant]] = await db.query(
    "SELECT id, stock_qty FROM product_variants WHERE id = ?",
    [variant_id]
  )
  if (!variant) throw new VariantNotFoundError()
  if (variant.stock_qty !== 0) throw new VariantNotSoldOutError()

  await db.query(
    `INSERT INTO stock_alerts (product_variant_id, email)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE notified_at = NULL`,
    [variant_id, String(email).trim()]
  )
}

/**
 * Still-waiting subscribers for one variant, locked for update - called from
 * inside catalogRepo.replaceVariants' own transaction on a restock event.
 */
async function listUnnotified(conn, variantId) {
  const [rows] = await conn.query(
    "SELECT * FROM stock_alerts WHERE product_variant_id = ? AND notified_at IS NULL FOR UPDATE",
    [variantId]
  )
  return rows
}

/**
 * Marks the given stock_alerts rows as notified - called in the same
 * transaction as the stock_alert_queue inserts for them, so a rollback
 * undoes both together.
 */
async function markNotified(conn, ids) {
  if (!ids.length) return
  await conn.query(
    `UPDATE stock_alerts SET notified_at = UTC_TIMESTAMP() WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  )
}

module.exports = {
  signUp, listUnnotified, markNotified,
  InvalidEmailError, VariantNotFoundError, VariantNotSoldOutError,
}
