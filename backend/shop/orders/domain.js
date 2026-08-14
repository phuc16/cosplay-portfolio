const crypto = require("crypto")

const RESERVATION_HOURS = Number(process.env.RESERVATION_HOURS) || 48

/** 128 bits of entropy. This token is the only thing guarding the order page. */
function generateOrderToken() {
  return crypto.randomBytes(16).toString("hex")
}

/**
 * 6-digit numeric pickup verification code. Short enough for a staff member
 * to read aloud or match by eye against the printed pickup roster when
 * event-venue connectivity is too weak for the QR-scan flow (which needs a
 * live full order-list fetch). Unlike order_token, this is never accepted
 * as a credential anywhere — it only ever gets compared visually.
 */
function generatePickupCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0")
}

/**
 * Human-facing order code shown in emails/admin instead of the raw
 * sequential `id` — a plain "#12" both leaks order volume to anyone who
 * compares two numbers and reads as less polished than most storefronts'
 * opaque order codes. Matches the length/shape of Shopee's own example
 * ("2608137A69U181"): a YYMMDD date prefix (from when the order was
 * placed) plus an 8-character alphanumeric suffix. The suffix is a hash of
 * the id, not randomness — deterministic and derived, so it needs no new
 * column/migration/uniqueness bookkeeping and can never drift out of sync
 * with the real id, while still not reading as an obviously-padded small
 * number the way a raw base-36 id would. Display-only, like pickup_code —
 * not a credential, so it doesn't need to be unguessable, only to look
 * like it isn't just the sequential id.
 */
function formatOrderCode(id, createdAt) {
  const d = new Date(createdAt)
  const y = String(d.getFullYear()).slice(2)
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hash = crypto.createHash("sha256").update(String(id)).digest("hex")
  const suffix = BigInt(`0x${hash.slice(0, 10)}`).toString(36).toUpperCase().padStart(8, "0").slice(0, 8)
  return `${y}${m}${day}${suffix}`
}

/**
 * Sum the order. Throws rather than coercing, because a non-integer price or a
 * negative quantity reaching this point means something upstream is broken and
 * silently rounding it would produce a wrong charge.
 */
function computeTotal(items) {
  let total = 0
  for (const item of items) {
    const price = item.unit_price_snapshot
    const qty = item.qty
    if (!Number.isInteger(price) || price < 0) {
      throw new Error(`Giá không hợp lệ: ${price}`)
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`Số lượng không hợp lệ: ${qty}`)
    }
    total += price * qty
  }
  return total
}

/** null stock means unlimited and is always reservable. */
function isReservable(stockQty, qty) {
  if (!Number.isInteger(qty) || qty <= 0) return false
  if (stockQty === null || stockQty === undefined) return true
  return stockQty >= qty
}

/** COD has nothing to wait for, so it never expires. */
function computeExpiry(paymentMethod, now = new Date(), hours = RESERVATION_HOURS) {
  if (paymentMethod === "cod") return null
  return new Date(now.getTime() + hours * 60 * 60 * 1000)
}

const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "completed", "cancelled"],
  shipped: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/**
 * Pickup orders go confirmed -> completed directly: there is nothing to ship
 * and no tracking code to give.
 */
function canTransition(from, to, fulfillment) {
  const allowed = TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) return false
  if (fulfillment === "pickup" && to === "shipped") return false
  return true
}

module.exports = {
  RESERVATION_HOURS,
  generateOrderToken,
  generatePickupCode,
  formatOrderCode,
  computeTotal,
  isReservable,
  computeExpiry,
  canTransition,
}
