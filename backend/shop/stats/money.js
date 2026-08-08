const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/** bank/momo/paypal are paid before the seller ships anything; COD is paid
 * at handover. This one set is the only place that distinction lives. */
function isPrepaid(paymentMethod) {
  return PREPAID_METHODS.has(paymentMethod)
}

/**
 * Classify one order into exactly one money bucket, per the spec's Money
 * Definitions:
 *
 *              pending            confirmed/shipped   completed   cancelled
 * prepaid   awaiting_payment      received            received    lost
 * cod       other                 to_collect          received    lost
 *
 * "other" (a pending COD order) is neither money in hand nor a committed
 * promise to collect — the seller has not even confirmed the order yet — so
 * it is deliberately excluded from Received, Outstanding, and Lost. It is
 * still a real return value, never undefined, so every input is accounted
 * for and a caller cannot silently drop an order by forgetting a branch.
 */
function classify(order) {
  const { status, payment_method: paymentMethod } = order
  const prepaid = isPrepaid(paymentMethod)

  if (status === "cancelled") return "lost"
  if (status === "completed") return "received"

  if (prepaid) {
    return status === "pending" ? "awaiting_payment" : "received"
  }
  return status === "pending" ? "other" : "to_collect"
}

/**
 * An order counts as expired when it was cancelled at or after its own
 * deadline. An admin who manually cancels an already-overdue order is
 * indistinguishable from the automatic sweep and is counted as expired too —
 * accepted per spec rather than adding a `cancel_reason` column for one
 * statistic. COD orders never have `expires_at` and are never expired.
 */
function isExpired(order) {
  if (order.status !== "cancelled") return false
  if (!order.expires_at || !order.cancelled_at) return false
  return new Date(order.cancelled_at).getTime() >= new Date(order.expires_at).getTime()
}

module.exports = { isPrepaid, classify, isExpired, PREPAID_METHODS }
