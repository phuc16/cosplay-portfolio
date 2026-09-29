const { formatOrderCode } = require("../orders/domain")

const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/**
 * Shape already-fetched confirmed pickup orders (plus their order_items)
 * into the printable pickup roster. The whole point of this document is the
 * paid-vs-collect-at-handover distinction - a COD order with no recorded
 * cod_amount cannot be shown as "collect ₫0" (that would let a buyer walk
 * away having paid nothing, when the seller intended to charge them), so it
 * is excluded and reported instead, mirroring the export's same guard.
 */
function buildRoster(orders) {
  const rows = []
  const excluded = []

  for (const order of orders) {
    // A completed order has already been handed over - for COD that means the
    // buyer paid at handover, so nothing remains to collect. Treat it as paid
    // regardless of payment_method: this is defense in depth alongside the
    // caller's status filter, so the roster can never double-charge a buyer
    // whose order already closed out. Do not remove as "redundant" with the
    // route's WHERE clause - this guard is what makes the printed page safe
    // on its own.
    const paid = order.status === "completed" || PREPAID_METHODS.has(order.payment_method)
    let amountDue = 0
    if (!paid) {
      if (order.cod_amount === null || order.cod_amount === undefined) {
        excluded.push({
          order_id: order.id, reason: "cod_missing_amount",
          message: `${formatOrderCode(order.id, order.created_at)}: đơn COD nhưng chưa có số tiền thu hộ`,
        })
        continue
      }
      amountDue = order.cod_amount
    }

    rows.push({
      order_id: order.id,
      order_code: formatOrderCode(order.id, order.created_at),
      buyer_name: order.buyer_name,
      phone: order.phone,
      pickup_code: order.pickup_code,
      queue_number: order.queue_number ?? null,
      // The buyer's own checkout note - for staff handing the order over,
      // never sent to a courier (this is a pickup order, there is no
      // courier involved at all).
      note: order.note || null,
      items: (order.items || []).map((i) => ({
        product_name: i.product_name_snapshot,
        variant_label: i.variant_label_snapshot,
        qty: i.qty,
        image_url: i.image_url || null,
        // A pickup order can still carry a digital item alongside the
        // physical one(s) actually handed over here - staff packing the
        // physical side need a cue that a digital delivery link also needs
        // sending, since nothing else about the pickup event covers it.
        delivery_link: i.delivery_link_snapshot || null,
        is_gift: Boolean(i.is_gift),
      })),
      // Same "+ Sản phẩm số" cue the shipping export queue and admin orders
      // list already show next to the order code, for the same reason: the
      // per-item badge only appears once the row is expanded.
      has_digital_item: (order.items || []).some((i) => i.delivery_link_snapshot),
      paid,
      amount_due: amountDue,
      prepared: Boolean(order.prepared),
    })
  }

  // By queue number (STT), the order staff actually call buyers in - not
  // alphabetical, which has no relationship to who's been waiting longest.
  // A row with no number yet (shouldn't happen for a confirmed order, but
  // not guaranteed - see assignQueueNumberIfNeeded's own caveats) sorts
  // after every numbered row rather than disappearing to the top under a
  // NULL-sorts-first default; buyer_name is only a tiebreaker among those.
  rows.sort((a, b) => {
    if (a.queue_number === null && b.queue_number === null) {
      return a.buyer_name.localeCompare(b.buyer_name, "vi")
    }
    if (a.queue_number === null) return 1
    if (b.queue_number === null) return -1
    return a.queue_number - b.queue_number
  })
  return { rows, excluded }
}

module.exports = { buildRoster }
