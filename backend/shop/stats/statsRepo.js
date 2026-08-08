const db = require("./../../db")
const { classify, isPrepaid, isExpired } = require("./money")

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Sell-through and time-to-sellout for one row of a drop's per-variant
 * table. Deleted variants (product_variant_id NULL after ON DELETE SET
 * NULL) have no product_variants row to join — remaining is null, displayed
 * as "—" by the frontend, never 0, which would falsely read as sold out.
 */
function buildVariantSummary(row, collectionCreatedAt) {
  const sold = Number(row.sold)
  const deleted = row.variant_id === null
  const unlimited = !deleted && row.stock_qty === null
  const remaining = deleted || unlimited ? null : Number(row.stock_qty)

  let sellThrough = null
  if (!deleted && !unlimited) {
    const denom = sold + remaining
    sellThrough = denom === 0 ? 0 : sold / denom
  }

  let timeToSelloutDays = null
  if (!deleted && !unlimited && remaining === 0 && row.last_sale_at) {
    timeToSelloutDays = Math.max(
      (new Date(row.last_sale_at).getTime() - new Date(collectionCreatedAt).getTime()) / MS_PER_DAY,
      0
    )
  }

  return {
    variant_id: row.variant_id,
    product_name: row.product_name,
    variant_label: row.variant_label,
    sold,
    deleted,
    unlimited,
    remaining,
    sell_through: sellThrough,
    time_to_sellout_days: timeToSelloutDays,
  }
}

/**
 * Retrospective for one collection: money classified per order, order
 * counts, units sold, expiry rate, fulfillment mix, and a per-variant table.
 *
 * Money classification happens in JavaScript over a scoped fetch
 * (`WHERE collection_id = ?`, served by the orders_collection_id_foreign
 * index MySQL creates for the foreign key) rather than as a SQL CASE
 * expression, so the exhaustively-tested classify() from money.js is what
 * actually computes every number here — see this plan's Architecture note
 * for why that trumps a "SQL only" rule.
 */
async function getDropStats(collectionId) {
  const [[collection]] = await db.query(
    "SELECT id, title, created_at FROM collections WHERE id = ? LIMIT 1",
    [collectionId]
  )
  if (!collection) return null

  const [orderRows] = await db.query(
    `SELECT id, status, payment_method, total, fulfillment_method, expires_at, cancelled_at
       FROM orders WHERE collection_id = ?`,
    [collectionId]
  )

  const received = { bank: 0, momo: 0, paypal: 0, cod: 0 }
  const orderCounts = { pending: 0, confirmed: 0, shipped: 0, completed: 0, cancelled: 0 }
  const fulfillmentCounts = { ship: 0, pickup: 0 }
  let awaitingPayment = 0
  let toCollect = 0
  let lost = 0
  let prepaidCount = 0
  let expiredCount = 0

  for (const o of orderRows) {
    orderCounts[o.status] += 1
    fulfillmentCounts[o.fulfillment_method] += 1

    const bucket = classify(o)
    if (bucket === "received") received[o.payment_method] += o.total
    else if (bucket === "awaiting_payment") awaitingPayment += o.total
    else if (bucket === "to_collect") toCollect += o.total
    else if (bucket === "lost") lost += o.total

    if (isPrepaid(o.payment_method)) {
      prepaidCount += 1
      if (isExpired(o)) expiredCount += 1
    }
  }

  const [[{ units_sold: unitsSold }]] = await db.query(
    `SELECT COALESCE(SUM(oi.qty), 0) AS units_sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.collection_id = ? AND o.status != 'cancelled'`,
    [collectionId]
  )

  const [variantRows] = await db.query(
    `SELECT oi.product_variant_id AS variant_id,
            oi.product_name_snapshot AS product_name,
            oi.variant_label_snapshot AS variant_label,
            SUM(oi.qty) AS sold,
            MAX(o.created_at) AS last_sale_at,
            v.stock_qty AS stock_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN product_variants v ON v.id = oi.product_variant_id
      WHERE o.collection_id = ? AND o.status != 'cancelled'
      GROUP BY oi.product_variant_id, oi.product_name_snapshot, oi.variant_label_snapshot
      ORDER BY sold DESC`,
    [collectionId]
  )

  return {
    collection_id: collection.id,
    collection_title: collection.title,
    received,
    received_total: received.bank + received.momo + received.paypal + received.cod,
    awaiting_payment: awaitingPayment,
    to_collect: toCollect,
    lost,
    order_counts: orderCounts,
    units_sold: Number(unitsSold),
    expiry_rate: prepaidCount === 0 ? null : expiredCount / prepaidCount,
    prepaid_order_count: prepaidCount,
    expired_order_count: expiredCount,
    fulfillment_counts: fulfillmentCounts,
    variants: variantRows.map((row) => buildVariantSummary(row, collection.created_at)),
  }
}

/**
 * Per-variant sales velocity across every drop, sorted fastest-first.
 *
 * Velocity = units sold ÷ days on sale, where days-on-sale runs from the
 * variant's collection's created_at to either its last sale (if it has sold
 * out) or now. This gives one comparable number for both sold-out and
 * still-available variants — time-to-sellout alone is undefined for
 * anything that has never sold out.
 *
 * Deleted variants are absent by construction: this query starts from
 * product_variants, which no longer has their row. A deleted variant cannot
 * be restocked, so its absence from a restock list is correct, not a gap.
 */
async function getRestockStats() {
  const [variantRows] = await db.query(
    `SELECT v.id AS variant_id, v.label, v.stock_qty,
            p.name AS product_name,
            c.id AS collection_id, c.title AS collection_title, c.created_at AS collection_created_at
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN collections c ON c.id = p.collection_id`
  )

  const [salesRows] = await db.query(
    `SELECT oi.product_variant_id AS variant_id, SUM(oi.qty) AS sold, MAX(o.created_at) AS last_sale_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled' AND oi.product_variant_id IS NOT NULL
      GROUP BY oi.product_variant_id`
  )
  const salesByVariant = new Map(salesRows.map((r) => [r.variant_id, r]))

  const now = new Date()

  const result = variantRows.map((v) => {
    const sales = salesByVariant.get(v.variant_id)
    const sold = sales ? Number(sales.sold) : 0
    const unlimited = v.stock_qty === null
    const remaining = unlimited ? null : Number(v.stock_qty)
    const soldOut = !unlimited && remaining === 0

    const saleEnd = soldOut && sales ? new Date(sales.last_sale_at) : now
    const daysOnSale = Math.max(
      (saleEnd.getTime() - new Date(v.collection_created_at).getTime()) / MS_PER_DAY,
      1 / 24 // floors at one hour, so a same-hour drop never divides by zero
    )
    const velocity = sold / daysOnSale

    let sellThrough = null
    if (!unlimited) {
      const denom = sold + remaining
      sellThrough = denom === 0 ? 0 : sold / denom
    }

    let timeToSelloutDays = null
    if (soldOut && sales) {
      timeToSelloutDays = Math.max(
        (new Date(sales.last_sale_at).getTime() - new Date(v.collection_created_at).getTime()) / MS_PER_DAY,
        0
      )
    }

    return {
      variant_id: v.variant_id,
      label: v.label,
      product_name: v.product_name,
      collection_id: v.collection_id,
      collection_title: v.collection_title,
      stock_qty: v.stock_qty,
      unlimited,
      remaining,
      sold,
      velocity,
      sell_through: sellThrough,
      time_to_sellout_days: timeToSelloutDays,
    }
  })

  return result.sort((a, b) => b.velocity - a.velocity)
}

module.exports = { getDropStats, buildVariantSummary, getRestockStats }
