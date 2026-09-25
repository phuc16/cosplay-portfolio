const db = require("./../../db")
const { classify, isPrepaid, isExpired } = require("./money")

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Thrown for a missing, unparsable, or backwards date range - the bookkeeping
 * view rejects these with a clear message rather than silently returning
 * every order, unlike the admin orders list's tolerant date filter, because
 * a money view that misinterprets its own range is a bookkeeping error. */
class InvalidRangeError extends Error {}

/**
 * Turn a `YYYY-MM-DD` boundary, interpreted in Asia/Ho_Chi_Minh (fixed
 * UTC+7, no DST), into the UTC instant `orders.created_at` can be compared
 * against. `created_at` is stored UTC; comparing a bare local date string
 * against it would misfile every order placed between local midnight and
 * 7am UTC, and could push orders across a month boundary.
 */
function localDayStartUtc(dateStr) {
  const match = typeof dateStr === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new InvalidRangeError(`Ngày không hợp lệ: ${dateStr}`)

  const date = new Date(`${dateStr}T00:00:00+07:00`)
  if (Number.isNaN(date.getTime())) throw new InvalidRangeError(`Ngày không hợp lệ: ${dateStr}`)

  // `new Date(...)` silently rolls calendar-invalid dates over into the next
  // valid one (e.g. "2026-02-30" becomes March 2nd), so the shape check above
  // is not enough - a typo would otherwise query a wrong-but-valid day with no
  // error. Re-derive the year/month/day the constructed instant actually
  // represents at UTC+7 (the same offset used to build it, not the server's
  // local timezone, which would make this check itself TZ-dependent) and
  // confirm it round-trips to the input.
  const [, year, month, day] = match
  const atOffset = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  if (
    atOffset.getUTCFullYear() !== Number(year) ||
    atOffset.getUTCMonth() + 1 !== Number(month) ||
    atOffset.getUTCDate() !== Number(day)
  ) {
    throw new InvalidRangeError(`Ngày không hợp lệ: ${dateStr}`)
  }

  return date
}

/**
 * Resolve a bookkeeping date range to UTC bounds. `date_to` is inclusive of
 * its whole local day, so the upper bound is the start of the *following*
 * local day, used with `<` rather than `<=`.
 */
function parseLocalDateRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) throw new InvalidRangeError("Cần chọn ngày bắt đầu và ngày kết thúc")
  const from = localDayStartUtc(dateFrom)
  const toStart = localDayStartUtc(dateTo)
  const toExclusive = new Date(toStart.getTime() + MS_PER_DAY)
  if (toExclusive <= from) throw new InvalidRangeError("Ngày kết thúc phải sau ngày bắt đầu")
  return { from, toExclusive }
}

/**
 * Sell-through and time-to-sellout for one row of a drop's per-variant
 * table. Deleted variants (product_variant_id NULL after ON DELETE SET
 * NULL) have no product_variants row to join - remaining is null, displayed
 * as "-" by the frontend, never 0, which would falsely read as sold out.
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
 * actually computes every number here - see this plan's Architecture note
 * for why that trumps a "SQL only" rule.
 */
async function getDropStats(collectionId) {
  const [[collection]] = await db.query(
    "SELECT id, title, created_at FROM collections WHERE id = ? LIMIT 1",
    [collectionId]
  )
  if (!collection) return null

  // A cart (and so an order) can span multiple collections - orders.collection_id
  // is only the first cart line's collection, so filtering on it here would
  // both miss orders whose first item belongs elsewhere and, worse, attribute
  // a mixed order's *entire* total to whichever collection happened to be
  // first. Money is computed from order_items' own per-line collection
  // snapshot instead - one row per order it touches, scoped to just the
  // revenue this collection's items represent within that order.
  // Mirrors getBookkeepingStats' same split: a gacha draw's order_items row
  // is a decorative prize value, not money paid, and a booth order never gets
  // a real purchase-line item at all - so booth revenue is pulled from the
  // order's own o.total/collection_id instead (set at startBoothSession
  // time), in a second branch scoped to this collection.
  const [orderRows] = await db.query(
    `SELECT o.id, o.status, o.payment_method, o.fulfillment_method, o.expires_at, o.cancelled_at,
            SUM(oi.unit_price_snapshot * oi.qty) AS collection_total
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND oi.collection_id_snapshot = ? AND oi.gacha_draw_id IS NULL
      GROUP BY o.id, o.status, o.payment_method, o.fulfillment_method, o.expires_at, o.cancelled_at

      UNION ALL

      SELECT o.id, o.status, o.payment_method, o.fulfillment_method, o.expires_at, o.cancelled_at,
             o.total AS collection_total
        FROM orders o
       WHERE o.collection_id = ? AND o.fulfillment_method = 'booth'`,
    [collectionId, collectionId]
  )

  const received = { bank: 0, momo: 0, paypal: 0, cod: 0, cash: 0 }
  const orderCounts = { pending: 0, confirmed: 0, shipped: 0, completed: 0, cancelled: 0 }
  const fulfillmentCounts = { ship: 0, pickup: 0, digital: 0, booth: 0 }
  let awaitingPayment = 0
  let toCollect = 0
  let lost = 0
  let pendingCod = 0
  let prepaidCount = 0
  let expiredCount = 0

  for (const o of orderRows) {
    orderCounts[o.status] += 1
    fulfillmentCounts[o.fulfillment_method] += 1

    // SUM() over an integer expression comes back from mysql2 as a decimal
    // string, not a number - unlike a bare column, which is why every other
    // read in this file skips the cast. Number() here, or every += below
    // silently string-concatenates instead of adding.
    const amount = Number(o.collection_total)
    const bucket = classify(o)
    if (bucket === "received") received[o.payment_method] += amount
    else if (bucket === "awaiting_payment") awaitingPayment += amount
    else if (bucket === "to_collect") toCollect += amount
    else if (bucket === "lost") lost += amount
    else if (bucket === "other") pendingCod += amount

    if (isPrepaid(o.payment_method)) {
      prepaidCount += 1
      if (isExpired(o)) expiredCount += 1
    }
  }

  const [[{ units_sold: unitsSold }]] = await db.query(
    `SELECT COALESCE(SUM(oi.qty), 0) AS units_sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.collection_id_snapshot = ? AND o.status != 'cancelled'`,
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
      WHERE oi.collection_id_snapshot = ? AND o.status != 'cancelled'
      GROUP BY oi.product_variant_id, oi.product_name_snapshot, oi.variant_label_snapshot
      ORDER BY sold DESC`,
    [collectionId]
  )

  return {
    collection_id: collection.id,
    collection_title: collection.title,
    received,
    received_total: received.bank + received.momo + received.paypal + received.cod + received.cash,
    awaiting_payment: awaitingPayment,
    to_collect: toCollect,
    lost,
    pending_cod: pendingCod,
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
 * still-available variants - time-to-sellout alone is undefined for
 * anything that has never sold out.
 *
 * Deleted variants are absent by construction: this query starts from
 * product_variants, which no longer has their row. A deleted variant cannot
 * be restocked, so its absence from a restock list is correct, not a gap.
 */
async function getRestockStats(collectionId) {
  const where = collectionId ? "WHERE c.id = ?" : ""
  const params = collectionId ? [collectionId] : []
  const [variantRows] = await db.query(
    `SELECT v.id AS variant_id, v.label, v.stock_qty,
            p.name AS product_name,
            c.id AS collection_id, c.title AS collection_title, c.created_at AS collection_created_at
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN collections c ON c.id = p.collection_id
       ${where}`,
    params
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
      // Floored at one day. Besides preventing a divide-by-zero on a drop
      // created today, this stops a brand-new collection's first sale from
      // reporting an absurd per-day rate - an hour-based floor made a single
      // sale read as 24/day and vaulted fresh drops above real bestsellers,
      // in the one view whose whole job is ranking what to restock.
      1
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

/**
 * Bookkeeping totals across every collection for a date range, plus an
 * explicit "no collection" bucket (order_items.collection_id_snapshot can be
 * null for a legacy row predating that column) so per-collection sums always
 * reconcile with the top-level totals.
 *
 * Top-level totals come from the order rows directly (order.total,
 * shipping_fee are whole-order values with no per-collection analog).
 * byCollection comes from a separate order_items-scoped query, since a cart
 * (and so an order) can span multiple collections - grouping by the order's
 * own collection_id would attribute a mixed order's *entire* total to
 * whichever collection happened to be the first cart line, both missing
 * every other collection it touches and overcounting that one. Each order's
 * total splits across every collection it touches by their item revenue
 * within it, so summing byCollection still reconciles exactly against the
 * top-level totals (a bucket is per-order, shared by all its item splits).
 */
async function getBookkeepingStats({ date_from: dateFrom, date_to: dateTo }) {
  const { from, toExclusive } = parseLocalDateRange(dateFrom, dateTo)

  const [orderRows] = await db.query(
    `SELECT o.id, o.status, o.payment_method, o.total, o.shipping_fee
       FROM orders o
      WHERE o.created_at >= ? AND o.created_at < ?`,
    [from, toExclusive]
  )

  // A gacha draw's order_items row carries a prize's decorative display_price,
  // not money paid, and never snapshots a collection - so it's excluded here
  // (`gacha_draw_id IS NULL`) rather than summed as if it were revenue. Booth
  // orders never get a real purchase-line item at all (startBoothSession
  // writes none - only drawForSession's decorative draw rows), so they'd
  // otherwise vanish entirely from by_collection; the second branch attributes
  // a booth order's real o.total to its own collection_id instead. An online
  // gacha order isn't double-counted: its real purchase-line item already
  // reconciles in the first branch, and the second branch only fires for
  // fulfillment_method = 'booth'.
  const [collectionRows] = await db.query(
    `SELECT o.id AS order_id, o.status, o.payment_method,
            oi.collection_id_snapshot AS collection_id, c.title AS collection_title,
            SUM(oi.unit_price_snapshot * oi.qty) AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND oi.gacha_draw_id IS NULL
       LEFT JOIN collections c ON c.id = oi.collection_id_snapshot
      WHERE o.created_at >= ? AND o.created_at < ?
      GROUP BY o.id, o.status, o.payment_method, oi.collection_id_snapshot, c.title

      UNION ALL

      SELECT o.id AS order_id, o.status, o.payment_method,
             o.collection_id AS collection_id, c.title AS collection_title,
             o.total AS amount
        FROM orders o
        LEFT JOIN collections c ON c.id = o.collection_id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.fulfillment_method = 'booth'`,
    [from, toExclusive, from, toExclusive]
  )

  const received = { bank: 0, momo: 0, paypal: 0, cod: 0, cash: 0 }
  let awaitingPayment = 0
  let toCollect = 0
  let lost = 0
  let pendingCod = 0
  let shippingCost = 0
  const byCollection = new Map()

  const addTo = (entry, bucket, amount) => {
    if (bucket === "received") entry.received_total += amount
    else if (bucket === "awaiting_payment") entry.awaiting_payment += amount
    else if (bucket === "to_collect") entry.to_collect += amount
    else if (bucket === "lost") entry.lost += amount
    else if (bucket === "other") entry.pending_cod += amount
  }

  for (const o of orderRows) {
    const bucket = classify(o)
    if (bucket === "received") received[o.payment_method] += o.total
    else if (bucket === "awaiting_payment") awaitingPayment += o.total
    else if (bucket === "to_collect") toCollect += o.total
    else if (bucket === "lost") lost += o.total
    else if (bucket === "other") pendingCod += o.total

    if (o.shipping_fee) shippingCost += o.shipping_fee
  }

  for (const row of collectionRows) {
    const bucket = classify(row)
    const key = row.collection_id === null ? "none" : row.collection_id
    if (!byCollection.has(key)) {
      byCollection.set(key, {
        collection_id: row.collection_id,
        collection_title: row.collection_id === null ? "Không thuộc bộ sưu tập" : row.collection_title,
        received_total: 0, awaiting_payment: 0, to_collect: 0, lost: 0, pending_cod: 0,
      })
    }
    addTo(byCollection.get(key), bucket, Number(row.amount))
  }

  return {
    date_from: dateFrom,
    date_to: dateTo,
    received,
    received_total: received.bank + received.momo + received.paypal + received.cod + received.cash,
    awaiting_payment: awaitingPayment,
    to_collect: toCollect,
    lost,
    pending_cod: pendingCod,
    shipping_cost: shippingCost,
    by_collection: [...byCollection.values()],
  }
}

const GACHA_TIERS = ["common", "rare", "mythical", "legendary", "ancient"]

/**
 * A gacha product's draws, tier rollup, and money - both online and booth
 * combined, and split by channel. gacha_sessions.source ("online" |
 * "booth_cash") is the channel discriminator; practice draws never persist
 * a session/draw row at all (see prizeRepo.practiceDraw), so no filtering
 * for those is needed here. Draw counts are read straight off gacha_draws,
 * matching the prize editor's own "Đã trúng" figure (quantity_total -
 * quantity_remaining) - drawn history is immutable even if the order that
 * paid for it is later cancelled (see replacePrizes' delete-guard comment),
 * so these are not filtered by order status.
 */
async function getGachaDropStats(productId) {
  const [[product]] = await db.query(
    `SELECT p.id, p.name, p.price, p.collection_id, c.title AS collection_title
       FROM products p
       JOIN collections c ON c.id = p.collection_id
      WHERE p.id = ? AND p.type = 'gacha'`,
    [productId]
  )
  if (!product) return null

  const [prizeRows] = await db.query(
    `SELECT id, name, tier, display_price, quantity_total, quantity_remaining
       FROM gacha_prizes WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
    [productId]
  )

  const [drawRows] = await db.query(
    `SELECT gd.gacha_prize_id, gs.source, COUNT(*) AS cnt
       FROM gacha_draws gd
       JOIN gacha_sessions gs ON gs.id = gd.session_id
      WHERE gs.product_id = ?
      GROUP BY gd.gacha_prize_id, gs.source`,
    [productId]
  )
  const drawnByPrize = new Map()
  for (const row of drawRows) {
    const entry = drawnByPrize.get(row.gacha_prize_id) || { online: 0, booth: 0 }
    if (row.source === "online") entry.online = Number(row.cnt)
    else if (row.source === "booth_cash") entry.booth = Number(row.cnt)
    drawnByPrize.set(row.gacha_prize_id, entry)
  }

  const tierRollup = new Map(GACHA_TIERS.map((t) => [t, {
    tier: t, drawn_online: 0, drawn_booth: 0, value_online: 0, value_booth: 0,
  }]))

  const prizes = prizeRows.map((p) => {
    const drawn = drawnByPrize.get(p.id) || { online: 0, booth: 0 }
    const price = Number(p.display_price)
    const rollup = tierRollup.get(p.tier)
    if (rollup) {
      rollup.drawn_online += drawn.online
      rollup.drawn_booth += drawn.booth
      rollup.value_online += drawn.online * price
      rollup.value_booth += drawn.booth * price
    }
    return {
      id: p.id, name: p.name, tier: p.tier, display_price: price,
      quantity_total: p.quantity_total, quantity_remaining: p.quantity_remaining,
      drawn_online: drawn.online, drawn_booth: drawn.booth,
    }
  })

  const [[{ variant_id: variantId }]] = await db.query(
    "SELECT id AS variant_id FROM product_variants WHERE product_id = ? LIMIT 1",
    [productId]
  )
  const [[{ total: onlineRevenue }]] = await db.query(
    `SELECT COALESCE(SUM(oi.unit_price_snapshot * oi.qty), 0) AS total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_variant_id = ? AND oi.gacha_draw_id IS NULL AND o.status != 'cancelled'`,
    [variantId]
  )
  const [[{ total: boothRevenue }]] = await db.query(
    `SELECT COALESCE(SUM(o.total), 0) AS total
       FROM gacha_sessions gs
       JOIN orders o ON o.id = gs.order_id
      WHERE gs.product_id = ? AND gs.source = 'booth_cash' AND o.status != 'cancelled'`,
    [productId]
  )

  const tiers = [...tierRollup.values()]
  const valueGivenOut = tiers.reduce(
    (acc, t) => ({ online: acc.online + t.value_online, booth: acc.booth + t.value_booth }),
    { online: 0, booth: 0 }
  )

  return {
    product_id: product.id,
    product_name: product.name,
    collection_id: product.collection_id,
    collection_title: product.collection_title,
    prizes,
    tiers,
    revenue: {
      online: Number(onlineRevenue), booth: Number(boothRevenue),
      total: Number(onlineRevenue) + Number(boothRevenue),
    },
    value_given_out: {
      online: valueGivenOut.online, booth: valueGivenOut.booth,
      total: valueGivenOut.online + valueGivenOut.booth,
    },
  }
}

module.exports = {
  getDropStats, buildVariantSummary, getRestockStats,
  getBookkeepingStats, parseLocalDateRange, InvalidRangeError,
  getGachaDropStats,
}
