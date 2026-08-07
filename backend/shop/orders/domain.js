const crypto = require("crypto")

const RESERVATION_HOURS = Number(process.env.RESERVATION_HOURS) || 48

/** 128 bits of entropy. This token is the only thing guarding the order page. */
function generateOrderToken() {
  return crypto.randomBytes(16).toString("hex")
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
  computeTotal,
  isReservable,
  computeExpiry,
  canTransition,
}
