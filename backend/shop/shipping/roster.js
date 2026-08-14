const { formatOrderCode } = require("../orders/domain")

const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/**
 * Shape already-fetched confirmed pickup orders (plus their order_items)
 * into the printable pickup roster. The whole point of this document is the
 * paid-vs-collect-at-handover distinction — a COD order with no recorded
 * cod_amount cannot be shown as "collect ₫0" (that would let a buyer walk
 * away having paid nothing, when the seller intended to charge them), so it
 * is excluded and reported instead, mirroring the export's same guard.
 */
function buildRoster(orders) {
  const rows = []
  const excluded = []

  for (const order of orders) {
    // A completed order has already been handed over — for COD that means the
    // buyer paid at handover, so nothing remains to collect. Treat it as paid
    // regardless of payment_method: this is defense in depth alongside the
    // caller's status filter, so the roster can never double-charge a buyer
    // whose order already closed out. Do not remove as "redundant" with the
    // route's WHERE clause — this guard is what makes the printed page safe
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
      items: (order.items || []).map((i) => ({
        product_name: i.product_name_snapshot,
        variant_label: i.variant_label_snapshot,
        qty: i.qty,
      })),
      paid,
      amount_due: amountDue,
    })
  }

  rows.sort((a, b) => a.buyer_name.localeCompare(b.buyer_name, "vi"))
  return { rows, excluded }
}

module.exports = { buildRoster }
