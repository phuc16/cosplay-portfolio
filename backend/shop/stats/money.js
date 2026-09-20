const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/** bank/momo/paypal are paid before the seller ships anything; COD is paid
 * at handover. This one set is the only place that distinction lives. */
function isPrepaid(paymentMethod) {
  return PREPAID_METHODS.has(paymentMethod)
}

/** Booth-counter cash. Staff take the money at the point of sale, so the
 * order is born `confirmed` with the cash already in the till - there is no
 * transfer for an admin to verify (unlike prepaid) and no future handover to
 * wait on (unlike COD). It is received from `confirmed` onward. */
const AT_SALE_METHODS = new Set(["cash"])

function isAtSale(paymentMethod) {
  return AT_SALE_METHODS.has(paymentMethod)
}

/**
 * Classify one order into exactly one money bucket, per the spec's Money
 * Definitions:
 *
 *              pending            confirmed/shipped   completed   cancelled
 * prepaid   awaiting_payment      received            received    lost
 * cod       other                 to_collect          received    lost
 * cash      other                 received            received    lost
 *
 * "other" (a pending COD order) is neither money in hand nor a committed
 * promise to collect - the seller has not even confirmed the order yet - so
 * it is deliberately excluded from Received, Outstanding, and Lost. It is
 * still a real return value, never undefined, so every input is accounted
 * for and a caller cannot silently drop an order by forgetting a branch.
 * A pending cash order should not exist (startBoothSession creates it
 * `confirmed`), and shares that bucket for the same reason: no money is
 * provably in hand yet.
 */
function classify(order) {
  const { status, payment_method: paymentMethod } = order

  if (status === "cancelled") return "lost"
  if (status === "completed") return "received"

  if (isPrepaid(paymentMethod)) {
    return status === "pending" ? "awaiting_payment" : "received"
  }
  if (isAtSale(paymentMethod)) {
    return status === "pending" ? "other" : "received"
  }
  return status === "pending" ? "other" : "to_collect"
}

/**
 * An order counts as expired when it was cancelled at or after its own
 * deadline. An admin who manually cancels an already-overdue order is
 * indistinguishable from the automatic sweep and is counted as expired too -
 * accepted per spec rather than adding a `cancel_reason` column for one
 * statistic. COD orders never have `expires_at` and are never expired.
 */
function isExpired(order) {
  if (order.status !== "cancelled") return false
  if (!order.expires_at || !order.cancelled_at) return false
  return new Date(order.cancelled_at).getTime() >= new Date(order.expires_at).getTime()
}

module.exports = { isPrepaid, isAtSale, classify, isExpired, PREPAID_METHODS, AT_SALE_METHODS }
