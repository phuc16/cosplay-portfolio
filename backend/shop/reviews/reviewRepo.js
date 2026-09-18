const db = require("./../../db")

const MAX_COMMENT_LENGTH = 1000

class InvalidReviewInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "InvalidReviewInputError"
  }
}

class DuplicateReviewError extends Error {
  constructor() {
    super("Bạn đã đánh giá sản phẩm này cho đơn hàng này rồi")
    this.name = "DuplicateReviewError"
  }
}

/**
 * A review is the first thing in this shop shown to an anonymous public
 * visitor with no token/session required - a meaningfully different
 * exposure level from the order-token-gated/admin-only views the rest of
 * this codebase carefully protects PII behind. The first whitespace-
 * separated token is kept verbatim; only the next token (if any) is shown,
 * collapsed to its first character - "Nguyễn Văn A" -> "Nguyễn V***".
 */
function maskBuyerName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[1][0]}***`
}

function validateShape({ rating, comment }) {
  const r = Number(rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) return "Đánh giá phải từ 1 đến 5 sao"
  if (comment !== undefined && comment !== null && String(comment).length > MAX_COMMENT_LENGTH) {
    return `Nhận xét không được vượt quá ${MAX_COMMENT_LENGTH} ký tự`
  }
  return null
}

async function createReview({ orderId, productId, buyerName, rating, comment }) {
  const invalid = validateShape({ rating, comment })
  if (invalid) throw new InvalidReviewInputError(invalid)

  const trimmedComment = comment ? String(comment).trim().slice(0, MAX_COMMENT_LENGTH) : null
  try {
    const [res] = await db.query(
      `INSERT INTO reviews (order_id, product_id, buyer_name, rating, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [orderId, productId, buyerName, Number(rating), trimmedComment || null]
    )
    return res.insertId
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new DuplicateReviewError()
    throw err
  }
}

async function listProductReviews(productId, limit = 50) {
  const [rows] = await db.query(
    `SELECT id, buyer_name, rating, comment, created_at
       FROM reviews WHERE product_id = ? ORDER BY id DESC LIMIT ?`,
    [productId, limit]
  )
  return rows.map((r) => ({ ...r, buyer_name: maskBuyerName(r.buyer_name) }))
}

/** count/average - average is 0 (not NaN) when there are no reviews yet. */
async function getProductRatingSummary(productId) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE product_id = ?",
    [productId]
  )
  const count = Number(row.count) || 0
  const average = count === 0 ? 0 : Math.round(Number(row.average) * 10) / 10
  return { count, average }
}

/** Returns true if a row was actually deleted, so the route can 404 on an unknown id. */
async function deleteReview(id) {
  const [res] = await db.query("DELETE FROM reviews WHERE id = ?", [id])
  return res.affectedRows > 0
}

module.exports = {
  maskBuyerName,
  validateShape,
  createReview,
  listProductReviews,
  getProductRatingSummary,
  deleteReview,
  InvalidReviewInputError,
  DuplicateReviewError,
}
