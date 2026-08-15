const jwt = require("jsonwebtoken")
const redis = require("./../../redis")
const domain = require("./domain")
const repo = require("./orderRepo")

const PIN_MAX_ATTEMPTS = 5
const PIN_LOCKOUT_MINUTES = 15
// Generous enough that a buyer checking back over a multi-day event doesn't
// have to re-enter the PIN, short enough that a leaked session token (e.g.
// a shared screenshot of the unlocked page) doesn't stay useful forever.
const ORDER_SESSION_HOURS = 24

/**
 * Gates the public order page and its sibling routes (payment info, QR
 * images, proof upload) — order_token in the URL alone used to be
 * sufficient, which let anyone the buyer casually shared the link with
 * also see the pickup code and upload payment proof (griefing: an attacker
 * could overwrite it with a fake photo, causing admin to decline a real
 * order). Access now requires ONE of:
 *   - a valid admin JWT (the same one issued by POST /api/login) — an admin
 *     following a buyer's link (support, troubleshooting) never needs a PIN
 *   - a verified-PIN session JWT scoped to this exact order_token, issued
 *     by POST /:token/verify-pin
 * Any other case (missing/invalid/expired token, or a session scoped to a
 * DIFFERENT order) responds 401 with error "pin_required" — the frontend
 * treats any 401 here as "show the PIN entry gate", not "order not found".
 */
function orderAccess(req, res, next) {
  const header = req.headers.authorization
  const token = header?.split(" ")[1]
  if (!token) {
    return res.status(401).json({ error: "pin_required", message: "Cần mã PIN để xem đơn hàng này" })
  }

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] })
  } catch {
    return res.status(401).json({ error: "pin_required", message: "Cần mã PIN để xem đơn hàng này" })
  }

  if (payload.role === "admin") {
    req.isAdmin = true
    return next()
  }
  if (payload.order_access && payload.order_access === req.params.token) {
    return next()
  }
  return res.status(401).json({ error: "pin_required", message: "Cần mã PIN để xem đơn hàng này" })
}

// Same IPv6-subnet-agnostic reasoning as server.js's login lockout, except
// keyed by order_token rather than IP: the threat here is someone
// repeatedly guessing ONE specific order's PIN, from any address, not a
// single IP hammering many orders.
async function verifyPin(orderToken, pin) {
  const lockKey = `pin_lock:${orderToken}`
  const attemptKey = `pin_fail:${orderToken}`

  const lockedUntil = await redis.get(lockKey)
  if (lockedUntil) {
    const ttl = await redis.ttl(lockKey)
    return { ok: false, locked: true, retryAfterSeconds: ttl }
  }

  const order = await repo.getOrderByToken(orderToken)
  if (!order) return { ok: false, locked: false, notFound: true }

  if (!domain.verifyAccessPin(pin, order.access_pin_hash)) {
    const attempts = await redis.incr(attemptKey)
    if (attempts === 1) await redis.expire(attemptKey, 60 * PIN_LOCKOUT_MINUTES)
    if (attempts >= PIN_MAX_ATTEMPTS) {
      await redis.set(lockKey, "1", "EX", 60 * PIN_LOCKOUT_MINUTES)
      await redis.del(attemptKey)
      return { ok: false, locked: true, retryAfterSeconds: 60 * PIN_LOCKOUT_MINUTES }
    }
    return { ok: false, locked: false }
  }

  await redis.del(attemptKey)
  await redis.del(lockKey)
  return { ok: true, sessionToken: issueOrderSessionToken(orderToken) }
}

/**
 * Issues the same order-access session JWT verifyPin() does, without
 * requiring the PIN — used exactly once, right after checkout: the buyer
 * who just submitted the order IS the buyer, in that same request/browser,
 * so re-proving it with a PIN they haven't even received the email for yet
 * would be pure friction with no real security benefit. Never called from
 * anywhere a buyer isn't already mid-checkout.
 */
function issueOrderSessionToken(orderToken) {
  return jwt.sign(
    { order_access: orderToken },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: `${ORDER_SESSION_HOURS}h` }
  )
}

module.exports = { orderAccess, verifyPin, issueOrderSessionToken, PIN_MAX_ATTEMPTS, PIN_LOCKOUT_MINUTES }
