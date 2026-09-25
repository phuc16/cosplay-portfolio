const db = require("./../../db")
const domain = require("./domain")
const emailQueue = require("./../email/queue")
const sessionRepo = require("./../gacha/sessionRepo")

const TRANSITION_EMAILS = {
  confirmed: "payment_confirmed",
  shipped: "shipped",
  cancelled: "cancelled",
  // `completed` intentionally sends nothing: the buyer already has the item.
}

const BUYER_INFO_LABELS = {
  buyer_name: "Tên người nhận",
  phone: "Số điện thoại",
  note: "Ghi chú",
  address_raw: "Địa chỉ nhận hàng",
}

class OutOfStockError extends Error {
  constructor(variantLabel, productName, variantId) {
    super(`Hết hàng: ${productName} - ${variantLabel}`)
    this.name = "OutOfStockError"
    this.variantLabel = variantLabel
    this.productName = productName
    // Lets the client auto-drop exactly this line, same as VariantNotFoundError.
    this.variantId = variantId
  }
}

/** Distinct from OutOfStockError: the variant_id matches no row at all (deleted or never existed), not one that's merely sold out. */
class VariantNotFoundError extends Error {
  constructor(missingIds) {
    super("Một sản phẩm trong giỏ hàng không còn tồn tại")
    this.name = "VariantNotFoundError"
    // Lets the client drop exactly the stale cart lines (they live in localStorage, not cleared by a page reload).
    this.missingVariantIds = missingIds
  }
}

class EmptyCartError extends Error {
  constructor() {
    super("Giỏ hàng trống")
    this.name = "EmptyCartError"
  }
}

class RequestKeyConflictError extends Error {
  constructor() {
    super("Mã yêu cầu đã được dùng cho một đơn khác, vui lòng thử lại")
    this.name = "RequestKeyConflictError"
  }
}

/**
 * The buyer asked for ship/pickup on a collection that never offered it -
 * e.g. "pickup" against a ship-only collection. Distinct from OutOfStockError:
 * this is a request-shape problem the client should not retry unchanged, not
 * a stock race, so the route maps it to 400 rather than 409.
 */
class FulfillmentNotOfferedError extends Error {
  constructor(method) {
    super(
      method === "pickup"
        ? "Bộ sưu tập này không hỗ trợ nhận tại chỗ"
        : "Bộ sưu tập này không hỗ trợ giao hàng"
    )
    this.name = "FulfillmentNotOfferedError"
  }
}

/**
 * A cart line's collection is no longer "active" - most commonly, it was
 * open when the item was added to the buyer's cart but the seller ended the
 * drop (status -> "closed") before checkout. Mirrors OutOfStockError's shape
 * (a real product/variant to quote) so the route can map it the same way:
 * a 409 race the client cannot retry unchanged, not a 400 validation error.
 */
class CollectionNotActiveError extends Error {
  constructor(variantLabel, productName, variantId, reason = "inactive") {
    super(`Bộ sưu tập đã đóng: ${productName} - ${variantLabel}`)
    this.name = "CollectionNotActiveError"
    this.variantLabel = variantLabel
    this.productName = productName
    // Lets the client auto-drop exactly this line, same as VariantNotFoundError.
    this.variantId = variantId
    // "not_started" | "ended" | "inactive" (draft/archived/manually closed
    // with no end_at) - lets the route give the buyer an accurate reason
    // instead of always saying the drop has ended, which is wrong for a
    // collection that has not opened yet.
    this.reason = reason
  }
}

/** COD collects cash at physical delivery - nothing to collect once a digital good has already been emailed out. */
class NoCodForDigitalError extends Error {
  constructor() {
    super("Không hỗ trợ thanh toán COD cho đơn có sản phẩm số")
    this.name = "NoCodForDigitalError"
  }
}

/** COD collects cash at physical delivery - a gacha turn is consumed online the moment the order is confirmed, so there is never a doorstep at which to collect. */
class NoCodForGachaError extends Error {
  constructor() {
    super("Không hỗ trợ thanh toán COD cho lượt quay gacha")
    this.name = "NoCodForGachaError"
  }
}

/** A gacha turn can only ever be the sole item in its cart - one order maps to exactly one gacha session, so a second gacha product or any ordinary line in the same cart has no session to belong to. */
class MixedGachaCartError extends Error {
  constructor() {
    super("Không thể mua lượt gacha cùng lúc với sản phẩm khác trong một đơn")
    this.name = "MixedGachaCartError"
  }
}

/** The turns bought must be backed by real prizes: unlike variant stock, a gacha turn draws from the shared gacha_prizes pool. */
class GachaPoolSoldOutError extends Error {
  constructor() {
    super("Kho quà gacha không đủ cho số lượt bạn muốn mua")
    this.name = "GachaPoolSoldOutError"
  }
}

/** A cart with at least one physical line must pick ship/pickup - only an all-digital cart may omit it. */
class FulfillmentRequiredError extends Error {
  constructor() {
    super("Hình thức nhận hàng không hợp lệ")
    this.name = "FulfillmentRequiredError"
  }
}

class InvalidBuyerInfoError extends Error {
  constructor(message) {
    super(message)
    this.name = "InvalidBuyerInfoError"
  }
}

/** Only ever thrown by the buyer-facing edit path (requirePending: true) - the admin path has no status restriction. */
class OrderNotEditableError extends Error {
  constructor() {
    super("Đơn hàng không còn ở trạng thái chờ thanh toán nên không thể chỉnh sửa.")
    this.name = "OrderNotEditableError"
  }
}

/**
 * Look up a previous submit of this idempotency key.
 *
 * request_key is client-supplied and unique across ALL buyers, so a bare key
 * match is not proof the same person is retrying. The caller must confirm the
 * stored row belongs to the buyer making the current request before treating
 * it as a replay - handing back a stranger's order_token would give them the
 * order page, and with it that buyer's name, phone, email and address.
 */
async function findByRequestKey(conn, requestKey) {
  const [[row]] = await conn.query(
    "SELECT id, order_token, total, email FROM orders WHERE request_key = ? LIMIT 1",
    [requestKey]
  )
  return row || null
}

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase()

/** Is the stored order the same buyer as the one submitting now? */
function isSameBuyer(row, buyer) {
  const a = normalizeEmail(row.email)
  const b = normalizeEmail(buyer.email)
  return a !== "" && a === b
}

const replayResult = (row) => ({
  id: row.id,
  order_token: row.order_token,
  total: row.total,
  reused: true,
})

/**
 * Create an order and reserve its stock in one transaction.
 *
 * Prices come from the catalog inside the transaction - never from the client,
 * which sends only {variant_id, qty}. Only product_variants rows are locked,
 * and always in ascending id order, so two concurrent orders touching the same
 * variants cannot deadlock by grabbing them in opposite orders.
 */
async function createOrder(input) {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) throw new EmptyCartError()

  const buyer = input.buyer || {}

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Idempotency: a retried submit must not reserve stock a second time.
    // Only this buyer's own earlier order counts as a retry. If the key is
    // taken by someone else it is a coincidental collision between two
    // unrelated buyers, and this buyer is still entitled to their order - so
    // fall through and create it. The unique index then rejects the insert and
    // the catch below turns that into a visible RequestKeyConflictError rather
    // than silently returning the other buyer's order.
    if (input.request_key) {
      const existing = await findByRequestKey(conn, input.request_key)
      if (existing && isSameBuyer(existing, buyer)) {
        await conn.commit()
        return replayResult(existing)
      }
    }

    const wanted = new Map()
    for (const item of items) {
      const id = Number(item.variant_id)
      const qty = Number(item.qty)
      wanted.set(id, (wanted.get(id) || 0) + qty)
    }
    // This sort is what makes the locking safe: it produces an ascending id
    // list that drives both the IN (...) below - InnoDB walks the primary key
    // in index order, so it takes the row locks ascending - and the check and
    // decrement loops further down. The SQL ORDER BY only orders the result
    // set; it does not govern lock acquisition.
    const ids = [...wanted.keys()].sort((a, b) => a - b)

    // FOR UPDATE OF v locks only the product_variants rows. A bare FOR UPDATE
    // would also lock the joined products rows, and it would take those locks
    // in variant-id order - an order with no consistent relationship to product
    // ids - so two orders buying from the same two products via differently
    // ordered variants could deadlock on the parent rows. Verified on MySQL
    // 8.4: with OF v, a concurrent SELECT ... FROM products FOR UPDATE does not
    // block, while the same on product_variants does.
    const [rows] = await conn.query(
      `SELECT v.id, v.label, v.stock_qty, v.delivery_link, v.thumbnail_image, v.image_url,
              p.id AS product_id, p.name AS product_name, p.type AS product_type, p.images AS product_images,
              p.price, p.collection_id, p.gacha_booth_only, c.status AS collection_status,
              c.start_at AS collection_start_at, c.end_at AS collection_end_at,
              c.allow_ship, c.allow_pickup, c.payment_deadline_hours
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN collections c ON c.id = p.collection_id
        WHERE v.id IN (${ids.map(() => "?").join(",")})
        ORDER BY v.id ASC
        FOR UPDATE OF v`,
      ids
    )
    if (rows.length !== ids.length) {
      const foundIds = new Set(rows.map((r) => r.id))
      throw new VariantNotFoundError(ids.filter((id) => !foundIds.has(id)))
    }
    // A booth-only gacha product must never be purchasable online - hidden
    // from the public storefront (see catalogRepo.getPublicCollectionBySlug),
    // but "hidden from the UI" is never treated as a security boundary on its
    // own in this codebase, so it's rejected here too, the same way an
    // unknown variant_id is: same error, same message, same 409 response -
    // deliberately NOT a distinguishing error, so a booth-only product can't
    // be told apart from a nonexistent one by probing.
    const boothOnlyRow = rows.find((r) => r.product_type === "gacha" && r.gacha_booth_only)
    if (boothOnlyRow) {
      throw new VariantNotFoundError([boothOnlyRow.id])
    }

    const allDigital = rows.every((r) => r.product_type === "digital")
    const anyDigital = rows.some((r) => r.product_type === "digital")

    const anyGacha = rows.some((r) => r.product_type === "gacha")
    if (anyGacha) {
      // Spec: a gacha item can only ever be the SOLE item in its cart. Any
      // second line item at all - another product, another gacha product, or
      // even a second variant of the same gacha product - is rejected. This
      // also guarantees exactly one gacha row for the pool check below, which
      // would otherwise under-count turns against the pool while
      // startOnlineSessionIfNeeded sums every gacha order_item.
      if (rows.length > 1) {
        throw new MixedGachaCartError()
      }
      if (input.payment_method === "cod") {
        throw new NoCodForGachaError()
      }
    }

    if (anyDigital && input.payment_method === "cod") {
      throw new NoCodForDigitalError()
    }

    // The prize pool, not the variant's stock_qty, is what a gacha turn
    // actually consumes. Locked here in the same transaction as the stock
    // check so it cannot go stale between this check and the insert. No lock
    // cycle with drawForSession (gacha_sessions -> orders -> gacha_prizes):
    // this path only ever inserts a brand-new orders row afterwards, never
    // locks an existing one.
    //
    // ACCEPTED RISK - turns can be oversold under concurrent orders. This
    // checks the pool but reserves nothing, and the FOR UPDATE only
    // serialises the two transactions, it doesn't make the second see a
    // smaller pool: two buyers can each pass this check against the same
    // remaining quantity, both pay, and whoever draws first drains it,
    // leaving the other's paid order hitting GachaSoldOutError partway
    // through its turns.
    //
    // Reserving properly is not a small change: a session row doesn't exist
    // until the order reaches 'confirmed', so the racing orders are both
    // 'pending' with nothing to count against - closing this needs real
    // reservation state on gacha_prizes plus a release path on every
    // cancel/expiry, mirroring stock_reserved. A cheaper derived
    // reservation does exist - subtract the outstanding turns on
    // order_items belonging to this product's LIVE_ORDER_STATUSES orders -
    // but it was rejected because it makes this a locking read over
    // orders/order_items during order CREATION, taken BEFORE the
    // gacha_prizes FOR UPDATE below, while a DRAW takes gacha_prizes
    // FOR UPDATE and only then inserts into order_items: the two paths would
    // approach the same pair of tables in opposite orders, which is a
    // deadlock cycle. The FOR UPDATE below serialises concurrent
    // createOrder calls against each other, but it is taken too late to
    // cover the order_items read and does nothing to order those two
    // acquisitions. Not worth a new lock-ordering hazard to fix a race that
    // is already visible via has_incomplete_gacha_session. Deliberately not built for
    // v1: the festival's pool is sized well above a day's sales, and the
    // failure is detectable and refundable rather than silent -
    // listOrders' has_incomplete_gacha_session flags any confirmed order
    // whose session still has undrawn turns, which is exactly the order a
    // stuck buyer ends up in, so staff see it on the admin order list and
    // can refund or restock by hand.
    if (anyGacha) {
      const gachaRow = rows.find((r) => r.product_type === "gacha")
      const requestedTurns = wanted.get(gachaRow.id)
      const [[pool]] = await conn.query(
        "SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM gacha_prizes WHERE product_id = ? FOR UPDATE",
        [gachaRow.product_id]
      )
      if (Number(pool.total) < requestedTurns) throw new GachaPoolSoldOutError()
    }

    // Collection open/scheduled check only here - the ship/pickup-offered
    // check that used to run in this same loop is deferred below, until
    // fulfillmentMethod is resolved, which now depends on whether a gift
    // applies (see below), which in turn depends on the real paid total.
    const now = new Date()
    for (const row of rows) {
      // A collection whose end_at has already passed is rejected here even
      // if its stored status still says "active" - the real transition to
      // "closed" only happens lazily on a read path (see catalogRepo.js's
      // closeExpiredCollections), which this write path never calls. A
      // collection whose start_at hasn't arrived yet is rejected the same
      // way - this check is the primary defense against ordering early, not
      // just cleanup for a stale link: catalogRepo now deliberately shows a
      // not-yet-started collection on the public site as a browsable
      // preview, so its variant_ids are directly visible to anyone browsing,
      // not just someone with an old cart or a crafted request.
      const collectionNotStarted = row.collection_start_at && new Date(row.collection_start_at) > now
      const collectionExpired = row.collection_end_at && new Date(row.collection_end_at) <= now
      if (row.collection_status !== "active" || collectionNotStarted || collectionExpired) {
        const reason = collectionNotStarted ? "not_started" : collectionExpired ? "ended" : "inactive"
        throw new CollectionNotActiveError(row.label, row.product_name, row.id, reason)
      }
    }

    const byId = new Map(rows.map((r) => [r.id, r]))
    const lines = []

    for (const id of ids) {
      const variant = byId.get(id)
      const qty = wanted.get(id)
      if (!domain.isReservable(variant.stock_qty, qty)) {
        throw new OutOfStockError(variant.label, variant.product_name, id)
      }
      lines.push({
        variant_id: id,
        qty,
        product_name_snapshot: variant.product_name,
        variant_label_snapshot: variant.label,
        unit_price_snapshot: variant.price,
        collection_id: variant.collection_id,
        delivery_link_snapshot: variant.product_type === "digital" ? variant.delivery_link : null,
        image_url_snapshot: variant.thumbnail_image || variant.image_url || firstImage(variant.product_images),
        is_gift: false,
        // Recorded now, not re-derived later - see releaseStock and this
        // migration's own comment for why.
        stock_reserved: variant.stock_qty !== null,
      })
    }

    const total = domain.computeTotal(lines)

    // A free gift is not a catalog item: no stock, no collection, no
    // relationship to product_variants at all (see the 2026-09-14 free-gift
    // design doc). Looked up directly, inside this same transaction, so its
    // config can't change mid-request.
    const [[giftSettingsRow]] = await conn.query("SELECT * FROM gift_settings ORDER BY id LIMIT 1")
    const giftApplies = Boolean(giftSettingsRow?.enabled) && total >= (giftSettingsRow?.min_total || 0)
    // Digital-vs-physical is inferred from delivery_link presence, not a
    // separate type column - one field that can't contradict itself.
    const giftIsPhysical = giftApplies && !giftSettingsRow.delivery_link

    // Fulfillment resolution now happens after the gift decision: an
    // all-digital cart that qualifies for a *physical* gift still needs a
    // real shipping/pickup answer, even though none of its actual paid items
    // would have required one on their own. When no gift applies (or it's
    // itself digital), this is identical to the original `!allDigital` check.
    const fulfillmentRequired = !allDigital || giftIsPhysical
    if (fulfillmentRequired && !["ship", "pickup"].includes(input.fulfillment_method)) {
      throw new FulfillmentRequiredError()
    }
    const fulfillmentMethod = fulfillmentRequired ? input.fulfillment_method : "digital"

    // Ship/pickup-offered check, deferred from the loop above because it
    // needs fulfillmentMethod. Only ever checked against the buyer's real
    // paid rows - the gift has no collection to check this against, and is
    // never subject to it (mirrors how a digital row is already exempt).
    for (const row of rows) {
      if (row.product_type !== "digital") {
        if (fulfillmentMethod === "ship" && !row.allow_ship) {
          throw new FulfillmentNotOfferedError("ship")
        }
        if (fulfillmentMethod === "pickup" && !row.allow_pickup) {
          throw new FulfillmentNotOfferedError("pickup")
        }
      }
    }

    // Decrement only finite stock; NULL means unlimited and stays NULL.
    // Runs over the paid lines only - the gift (appended below, if any) has
    // no stock to reserve.
    for (const line of lines) {
      const variant = byId.get(line.variant_id)
      if (variant.stock_qty !== null) {
        await conn.query(
          "UPDATE product_variants SET stock_qty = stock_qty - ? WHERE id = ?",
          [line.qty, line.variant_id]
        )
      }
    }

    if (giftApplies) {
      lines.push({
        variant_id: null,
        qty: 1,
        product_name_snapshot: giftSettingsRow.name,
        variant_label_snapshot: "",
        unit_price_snapshot: 0,
        collection_id: null,
        delivery_link_snapshot: giftSettingsRow.delivery_link || null,
        image_url_snapshot: giftSettingsRow.image_url || null,
        is_gift: true,
        stock_reserved: false,
      })
    }

    const token = domain.generateOrderToken()
    // Falls back to domain.RESERVATION_HOURS (via computeExpiry's default
    // parameter) when the collection has no override configured. Reads
    // lines[0], which is always the first *paid* line - the gift, if any,
    // is always appended last and is never lines[0].
    const deadlineHours = byId.get(lines[0].variant_id).payment_deadline_hours || undefined
    const expiresAt = domain.computeExpiry(input.payment_method, new Date(), deadlineHours)
    const isPickup = fulfillmentMethod === "pickup"
    // Neither a pickup nor an all-digital order has anywhere to ship to.
    const skipAddress = isPickup || fulfillmentMethod === "digital"
    const pickupCode = isPickup ? domain.generatePickupCode() : null
    // Only the hash is ever persisted (see migration 021) - accessPin itself
    // is returned once here so the caller can email it, same lifecycle as
    // order_token except accessPin is never stored in plaintext anywhere.
    const accessPin = domain.generateAccessPin()
    const accessPinHash = domain.hashAccessPin(accessPin)

    const [res] = await conn.query(
      `INSERT INTO orders
         (order_token, request_key, buyer_name, phone, email, fulfillment_method,
          address_street, address_ward, address_district, address_province, address_raw,
          note, status, payment_method, total, cod_amount, collection_id, expires_at, pickup_code,
          access_pin_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        input.request_key || null,
        buyer.buyer_name,
        buyer.phone,
        buyer.email,
        fulfillmentMethod,
        skipAddress ? null : buyer.address_street || null,
        skipAddress ? null : buyer.address_ward || null,
        skipAddress ? null : buyer.address_district || null,
        skipAddress ? null : buyer.address_province || null,
        skipAddress ? null : buyer.address_raw || null,
        input.note || null,
        input.payment_method,
        total,
        input.payment_method === "cod" ? total : null,
        lines[0].collection_id,
        expiresAt,
        pickupCode,
        accessPinHash,
      ]
    )

    for (const line of lines) {
      await conn.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, product_name_snapshot,
            variant_label_snapshot, unit_price_snapshot, qty, delivery_link_snapshot, image_url_snapshot,
            collection_id_snapshot, is_gift, stock_reserved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [res.insertId, line.variant_id, line.product_name_snapshot,
         line.variant_label_snapshot, line.unit_price_snapshot, line.qty, line.delivery_link_snapshot,
         line.image_url_snapshot, line.collection_id, line.is_gift, line.stock_reserved]
      )
    }

    await conn.commit()
    return { id: res.insertId, order_token: token, access_pin: accessPin, total, reused: false }
  } catch (err) {
    await conn.rollback()
    if (err.code === "ER_DUP_ENTRY" && input.request_key) {
      const existing = await findByRequestKey(db, input.request_key)
      // A concurrent submit by this same buyer won the unique index: their
      // order is our order, so return it.
      if (existing && isSameBuyer(existing, buyer)) return replayResult(existing)
      // The key belongs to a different buyer. Refusing loudly is the only safe
      // answer: reusing their order would leak their order_token, and we cannot
      // store ours under a key the index already gave away.
      if (existing) throw new RequestKeyConflictError()
    }
    throw err
  } finally {
    conn.release()
  }
}

/** products.images is a JSON column; mysql2 may hand back a string or an array. */
function firstImage(value) {
  const arr = Array.isArray(value) ? value : (typeof value === "string" && value.trim() ? JSON.parse(value) : [])
  return Array.isArray(arr) ? arr[0] || null : null
}

async function attachItems(order) {
  if (!order) return null
  // image_url_snapshot (taken at order-creation time) wins - it survives the
  // variant/product being deleted later, which a completed order's own
  // history must not depend on. The live join is a fallback only for orders
  // placed before this snapshot column existed.
  const [rows] = await db.query(
    `SELECT oi.*, pv.thumbnail_image AS variant_thumbnail, pv.image_url AS variant_image_url,
            p.images AS product_images, p.type AS product_type
       FROM order_items oi
       LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
       LEFT JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = ? ORDER BY oi.id ASC`,
    [order.id]
  )
  const items = rows.map(({ variant_thumbnail, variant_image_url, product_images, ...item }) => ({
    ...item,
    // mysql2 returns a TINYINT(1) as a JS number (0/1), not a boolean (no
    // typeCast configured in db.js) - left as-is, `{item.is_gift && <X/>}`
    // renders a literal "0" text node for every non-gift item, since 0 is
    // falsy but still a renderable React child.
    is_gift: Boolean(item.is_gift),
    image_url: item.image_url_snapshot || variant_thumbnail || variant_image_url || firstImage(product_images),
  }))
  return { ...order, items }
}

/**
 * A pickup order's items can span multiple collections (a cart isn't
 * restricted to one), and each collection sets its own pickup_location/note -
 * so "where do I go to collect this" can genuinely be more than one place.
 * Distinct per collection_id (not per item), and only collections that still
 * exist and have at least one of the two fields set; a deleted collection's
 * entry silently drops rather than showing a blank location.
 */
async function attachPickupLocations(order) {
  if (!order) return order
  if (order.fulfillment_method !== "pickup") return { ...order, pickup_locations: [] }
  const [rows] = await db.query(
    `SELECT DISTINCT c.id AS collection_id, c.title AS collection_title, c.pickup_location, c.pickup_note
       FROM order_items oi
       JOIN collections c ON c.id = oi.collection_id_snapshot
      WHERE oi.order_id = ? AND (c.pickup_location IS NOT NULL OR c.pickup_note IS NOT NULL)`,
    [order.id]
  )
  return { ...order, pickup_locations: rows }
}

async function getOrderByToken(token) {
  const [[row]] = await db.query(
    "SELECT * FROM orders WHERE order_token = ? LIMIT 1",
    [token]
  )
  return attachPickupLocations(await attachItems(row))
}

async function getOrderById(id) {
  const [[row]] = await db.query(
    "SELECT * FROM orders WHERE id = ? LIMIT 1",
    [id]
  )
  return attachPickupLocations(await attachItems(row))
}

/**
 * Parse an admin-supplied date filter boundary. Malformed input is ignored
 * (returns null) rather than surfaced as an error, per the route's
 * tolerate-bad-input contract. `date_to` is treated as inclusive: a bare
 * YYYY-MM-DD is widened to the end of that day so "to 2026-01-31" doesn't
 * silently exclude orders created that afternoon.
 */
function parseDateBoundary(value, { endOfDay = false } = {}) {
  if (typeof value !== "string" || value === "") return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999)
  }
  return date
}

async function listOrders(filter = {}) {
  const where = []
  const params = []
  if (filter.status) { where.push("status = ?"); params.push(filter.status) }
  if (filter.fulfillment_method) { where.push("fulfillment_method = ?"); params.push(filter.fulfillment_method) }
  // A cart (and so an order) can span multiple collections - matching on the
  // order's own collection_id (set to only the first cart line's collection
  // at createOrder time) would silently miss an order for every collection
  // but the first one its items belong to. EXISTS against order_items'
  // per-line snapshot catches every collection the order actually touches.
  //
  // A booth-cash order is the one exception: startBoothSession never writes
  // a purchase-line order_items row at all (only drawForSession's decorative
  // draw rows exist, and those never set collection_id_snapshot), so the
  // EXISTS check alone silently excludes every booth order regardless of
  // collection - matched here by falling back to the order's own
  // collection_id, which startBoothSession does set correctly.
  if (filter.collection_id) {
    where.push(`(
      EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.collection_id_snapshot = ?)
      OR (o.fulfillment_method = 'booth' AND o.collection_id = ?)
    )`)
    params.push(filter.collection_id, filter.collection_id)
  }

  // Filters on created_at (not confirmed_at/etc.) so idx_orders_status_created
  // stays usable when a status filter is also present.
  const from = parseDateBoundary(filter.date_from)
  if (from) { where.push("created_at >= ?"); params.push(from) }
  const to = parseDateBoundary(filter.date_to, { endOfDay: true })
  if (to) { where.push("created_at <= ?"); params.push(to) }

  // Free-text search across the identifiers an admin actually has on hand
  // when looking up a specific order: its numeric id, the buyer's name,
  // phone, or email. order_code (the Shopee-style display code) is a
  // computed value, not a column, so an id search only matches the raw
  // numeric id - a buyer quoting their display code would need it decoded
  // first, same as everywhere else order_code isn't the DB key.
  // Capped rather than left unbounded: buyer_name/phone/email have no index,
  // so an admin session (or a compromised admin token) pasting in a huge
  // string would otherwise cost a full-table LIKE scan for no added value -
  // no real name/phone/email is anywhere close to this long.
  const search = String(filter.search || "").trim().slice(0, 100)
  if (search) {
    const clauses = ["buyer_name LIKE ?", "phone LIKE ?", "email LIKE ?"]
    const clauseParams = [`%${search}%`, `%${search}%`, `%${search}%`]
    if (/^\d+$/.test(search)) {
      clauses.unshift("id = ?")
      clauseParams.unshift(Number(search))
    }
    where.push(`(${clauses.join(" OR ")})`)
    params.push(...clauseParams)
  }

  // A mixed cart (e.g. a shipped physical item plus a digital one) resolves
  // fulfillment_method to "ship"/"pickup" - only an all-digital order ever
  // gets "digital" (see createOrder). Without this flag, the admin list has
  // no way to show that a "ship" order still needs a delivery link sent;
  // staff would only discover it by opening every order's detail.
  //
  // has_incomplete_gacha_session is the same idea for the abandoned-session
  // case: a buyer who paid, got confirmed, and never opened their case leaves
  // turns owed indefinitely with nothing to pack. The session row stays
  // 'active' until its last turn is drawn, so that alone is the signal.
  const [rows] = await db.query(
    `SELECT o.*,
            EXISTS (
              SELECT 1 FROM order_items oi
               WHERE oi.order_id = o.id AND oi.delivery_link_snapshot IS NOT NULL
            ) AS has_digital_item,
            EXISTS (
              SELECT 1 FROM gacha_sessions gs
               WHERE gs.order_id = o.id AND gs.status = 'active'
            ) AS has_incomplete_gacha_session
       FROM orders o ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY o.created_at DESC, o.id DESC`,
    params
  )
  return rows.map((r) => ({
    ...r,
    has_digital_item: Boolean(r.has_digital_item),
    has_incomplete_gacha_session: Boolean(r.has_incomplete_gacha_session),
  }))
}

/**
 * Booth orders, each with its drawn items attached - unlike listOrders,
 * whose payload is deliberately item-free (kept light for the main Orders
 * list's every-order-every-poll usage). fulfillment_method is hardcoded
 * here, never taken from the caller, so this can never be pointed at
 * anything but booth orders. Same fetch-then-batch-items shape as
 * shop/shipping/roster.js's route uses for the pickup roster - one query
 * for the matching orders, one for all their items via `IN (...)`, no
 * per-order round trip.
 */
async function listBoothOrdersWithItems({ collection_id } = {}) {
  const orders = await listOrders({ fulfillment_method: "booth", collection_id })
  if (!orders.length) return []

  const [itemRows] = await db.query(
    `SELECT oi.order_id, oi.product_name_snapshot, oi.variant_label_snapshot, oi.unit_price_snapshot,
            oi.qty, oi.is_gift, oi.gacha_tier_snapshot,
            oi.image_url_snapshot, pv.thumbnail_image AS variant_thumbnail, pv.image_url AS variant_image_url,
            p.images AS product_images
       FROM order_items oi
       LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
       LEFT JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id IN (${orders.map(() => "?").join(",")})
      ORDER BY oi.id ASC`,
    orders.map((o) => o.id)
  )

  const itemsByOrder = new Map()
  for (const { image_url_snapshot, variant_thumbnail, variant_image_url, product_images, ...item } of itemRows) {
    const withImage = {
      ...item,
      is_gift: Boolean(item.is_gift),
      image_url: image_url_snapshot || variant_thumbnail || variant_image_url || firstImage(product_images),
    }
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, [])
    itemsByOrder.get(item.order_id).push(withImage)
  }

  return orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] }))
}

/** Return reserved stock. Caller must hold the order row lock. */
async function releaseStock(conn, orderId) {
  const [items] = await conn.query(
    "SELECT product_variant_id, qty, stock_reserved FROM order_items WHERE order_id = ?",
    [orderId]
  )
  // Ascending id order, same as reservation, to keep lock ordering consistent.
  // Gated on stock_reserved (recorded at order-creation time - see
  // createOrder and migration 039), not on the variant's *current*
  // stock_qty - a variant can be converted from unlimited (NULL) to tracked
  // (a real number) after this order was placed but before it cancels/
  // expires, and re-deriving "was this reserved" from the variant's current
  // state would then credit stock that this order never actually reserved.
  const sorted = items
    .filter((i) => i.product_variant_id !== null && i.stock_reserved)
    .sort((a, b) => a.product_variant_id - b.product_variant_id)

  for (const item of sorted) {
    // The NULL guard is now just a belt-and-suspenders no-op (adding to a
    // NULL column stays NULL either way) - stock_reserved above is what
    // actually decides whether this row credits anything back.
    await conn.query(
      "UPDATE product_variants SET stock_qty = stock_qty + ? WHERE id = ? AND stock_qty IS NOT NULL",
      [item.qty, item.product_variant_id]
    )
  }
  await conn.query("UPDATE orders SET stock_released_at = NOW() WHERE id = ?", [orderId])
}

/**
 * Move an order to a new status. Cancelling returns reserved stock, guarded by
 * stock_released_at so a double cancel - or a cancel racing the expiry sweep -
 * cannot credit the same stock twice.
 *
 * `extra.expectedFromStatus` and `extra.expiredBefore` let a caller that
 * decided to act on a row it read *outside* this transaction re-assert what it
 * saw, now that the row is locked. Both are checked against the freshly locked
 * row and refuse the transition (return false, change nothing) on a mismatch.
 */
async function transitionOrder(id, toStatus, extra = {}) {
  const conn = await db.getConnection()
  let ok = false
  let notifyEmailType = null
  let notifyAddress = null
  try {
    await conn.beginTransaction()

    const [[order]] = await conn.query(
      `SELECT id, status, fulfillment_method, stock_released_at, expires_at, email, payment_proof_url
         FROM orders WHERE id = ? FOR UPDATE`,
      [id]
    )
    if (!order) { await conn.rollback(); return false }

    // Guards the expiry sweep against a race with a concurrent admin confirm.
    if (extra.expectedFromStatus !== undefined && order.status !== extra.expectedFromStatus) {
      await conn.rollback()
      return false
    }

    // Guards against a deadline extended after the sweep's unlocked read.
    if (extra.expiredBefore !== undefined) {
      const expiresAt = order.expires_at === null ? null : new Date(order.expires_at)
      if (expiresAt === null || expiresAt > new Date(extra.expiredBefore)) {
        await conn.rollback()
        return false
      }
    }

    // Guards against proof uploaded after the sweep's unlocked read.
    if (extra.requireNoProof && order.payment_proof_url) {
      await conn.rollback()
      return false
    }

    if (!domain.canTransition(order.status, toStatus, order.fulfillment_method)) {
      await conn.rollback()
      return false
    }

    if (toStatus === "cancelled" && order.stock_released_at === null) {
      await releaseStock(conn, id)
    }

    const sets = ["status = ?"]
    const params = [toStatus]
    if (toStatus === "confirmed") sets.push("confirmed_at = NOW()")
    if (toStatus === "shipped") sets.push("shipped_at = NOW()")
    if (toStatus === "completed") sets.push("completed_at = NOW()")
    if (toStatus === "cancelled") sets.push("cancelled_at = NOW()")
    if (extra.tracking_code !== undefined) { sets.push("tracking_code = ?"); params.push(extra.tracking_code) }
    if (extra.shipping_fee !== undefined) { sets.push("shipping_fee = ?"); params.push(extra.shipping_fee) }
    if (toStatus === "cancelled" && extra.cancel_reason !== undefined) {
      sets.push("cancel_reason = ?"); params.push(extra.cancel_reason)
    }
    params.push(id)

    await conn.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params)
    await conn.commit()
    ok = true

    // Deliberately outside the transaction: a mail failure must never roll
    // back a status change the seller already performed. The connection is
    // released (see finally) before the email is enqueued below, so this
    // does not hold a pool connection while enqueue() borrows another one.
    const emailType = TRANSITION_EMAILS[toStatus]
    if (emailType && extra.notify !== false && order.email) {
      notifyEmailType = emailType
      notifyAddress = order.email
    }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // The email enqueue below runs only after the connection above has been
  // released (see `finally`) - it may not hold a pool connection while
  // doing follow-up work (see commit 58dad02). It is best-effort: a mail
  // failure must never fail or roll back a status change the seller
  // already made.
  if (notifyEmailType) {
    try {
      await emailQueue.enqueue(id, notifyEmailType, notifyAddress)
    } catch (err) {
      console.error("[ORDERS] Không xếp được email:", err.message)
    }
  }

  // Strictly post-commit, and - like the email enqueue above - only after
  // the connection has been released, since it borrows its own. Two reasons
  // it cannot move up into the transaction: an active gacha session must
  // never survive a rolled-back status change, and holding `orders` while
  // taking `gacha_sessions` is the exact inverse of drawForSession's lock
  // order. It runs *after* the enqueue and is best-effort for the same
  // reason the enqueue is: a session-creation hiccup must never fail a
  // confirm the seller already performed, nor swallow the buyer's
  // payment-confirmed email on its way out.
  if (ok && toStatus === "confirmed") {
    try {
      await sessionRepo.startOnlineSessionIfNeeded(id)
    } catch (err) {
      // The order id is part of the message on purpose: this is the one trace
      // of a confirmed gacha order left without a session, and the buyer's own
      // gacha-session read path heals it silently afterwards.
      console.error(`[ORDERS] Không tạo được phiên gacha cho đơn #${id}:`, err.message)
    }
  }

  return ok
}

/**
 * Attaches a buyer's uploaded payment-proof URL, but only if the order is
 * still 'pending' at write time. The route's own image processing/MinIO
 * storage I/O happens before this is called (outside any lock, since that
 * work has no reason to hold a row lock) - without re-checking status right
 * before the write, the worker's expiry sweep could cancel (and release the
 * stock of) this exact order in that window, and this write would silently
 * attach a "successful" proof to an order that's already dead. Taking the
 * same `SELECT ... FOR UPDATE` row lock the sweep's transitionOrder takes
 * serializes the two: whichever acquires the lock first determines the
 * outcome, instead of a plain unconditional UPDATE racing it blind.
 */
async function savePaymentProof(orderId, url) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [[order]] = await conn.query("SELECT status FROM orders WHERE id = ? FOR UPDATE", [orderId])
    if (!order || order.status !== "pending") {
      await conn.rollback()
      return false
    }
    await conn.query(
      "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
      [url, orderId]
    )
    await conn.commit()
    return true
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Corrects an order's contact/address/note fields after it was placed -
 * admin (no requirePending) or the buyer themselves (requirePending: true,
 * only while the order is still 'pending'). Diffs against the row's current
 * values; a no-op diff makes no DB write and enqueues no email.
 *
 * Email is deliberately NOT editable here - `fields.email` is never read,
 * and the notification always goes to the order's own, unchanged address.
 * Allowing an edit to redirect where its own notification goes would defeat
 * the notification's point.
 *
 * Address is written as the full structured set (street/ward/district/
 * province/raw - see AddressFields.jsx for how a stored province/ward name
 * resolves back to that picker's selection on edit), but diffed/shown to
 * the buyer as a single composite entry (old/new address_raw) rather than
 * five separate lines.
 *
 * Mirrors transitionOrder's connection discipline: commit and release the
 * connection before enqueueing the notification email - a mail-layer issue
 * must never hold a pool connection open, and must never roll back a change
 * the caller already made.
 *
 * `actor` ('admin' or 'buyer') is carried into the notification email so it
 * can say who made the change - safe to do now that email is locked to the
 * order's own address (see above), so the real buyer always gets it
 * regardless of who edited.
 */
async function updateBuyerInfo(id, fields, { requirePending = false, actor = "admin" } = {}) {
  let result = null
  let notifyEmail = null
  let notifyChanges = null

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [[order]] = await conn.query("SELECT * FROM orders WHERE id = ? FOR UPDATE", [id])
    if (!order) {
      await conn.rollback()
      return null
    }

    if (requirePending && order.status !== "pending") {
      throw new OrderNotEditableError()
    }

    const buyerName = fields.buyer_name === undefined ? order.buyer_name : String(fields.buyer_name ?? "").trim()
    const phone = fields.phone === undefined ? order.phone : String(fields.phone ?? "").trim()
    const note = fields.note === undefined ? order.note : (String(fields.note ?? "").trim() || null)
    const addressRaw = fields.address_raw === undefined ? order.address_raw : (String(fields.address_raw ?? "").trim() || null)
    const addressStreet = fields.address_street === undefined ? order.address_street : (String(fields.address_street ?? "").trim() || null)
    const addressWard = fields.address_ward === undefined ? order.address_ward : (String(fields.address_ward ?? "").trim() || null)
    const addressDistrict = fields.address_district === undefined ? order.address_district : (String(fields.address_district ?? "").trim() || null)
    const addressProvince = fields.address_province === undefined ? order.address_province : (String(fields.address_province ?? "").trim() || null)

    if (!buyerName) throw new InvalidBuyerInfoError("Cần họ tên")
    if (!phone) throw new InvalidBuyerInfoError("Cần số điện thoại")
    if (order.fulfillment_method === "ship" && !addressRaw) {
      throw new InvalidBuyerInfoError("Cần địa chỉ nhận hàng")
    }

    const diff = []
    const pushIfChanged = (field, oldVal, newVal) => {
      if ((oldVal || "") !== (newVal || "")) diff.push({ field, label: BUYER_INFO_LABELS[field], old: oldVal, new: newVal })
    }
    pushIfChanged("buyer_name", order.buyer_name, buyerName)
    pushIfChanged("phone", order.phone, phone)
    pushIfChanged("note", order.note, note)

    const isShip = order.fulfillment_method === "ship"
    if (isShip) {
      const addressChanged =
        (order.address_raw || "") !== (addressRaw || "") ||
        (order.address_street || "") !== (addressStreet || "") ||
        (order.address_ward || "") !== (addressWard || "") ||
        (order.address_district || "") !== (addressDistrict || "") ||
        (order.address_province || "") !== (addressProvince || "")
      if (addressChanged) {
        diff.push({ field: "address_raw", label: BUYER_INFO_LABELS.address_raw, old: order.address_raw, new: addressRaw })
      }
    }

    if (diff.length === 0) {
      await conn.commit()
      result = { changed: false }
    } else {
      await conn.query(
        `UPDATE orders SET buyer_name = ?, phone = ?, note = ?,
           address_raw = ?, address_street = ?, address_ward = ?, address_district = ?, address_province = ?
         WHERE id = ?`,
        [
          buyerName, phone, note,
          isShip ? addressRaw : order.address_raw,
          isShip ? addressStreet : order.address_street,
          isShip ? addressWard : order.address_ward,
          isShip ? addressDistrict : order.address_district,
          isShip ? addressProvince : order.address_province,
          id,
        ]
      )
      await conn.commit()
      notifyEmail = order.email
      notifyChanges = diff
    }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  if (notifyChanges) {
    try {
      await emailQueue.enqueue(id, "order_updated", notifyEmail, { changes: notifyChanges, actor })
    } catch (err) {
      console.error("[ORDERS] Không xếp được email order_updated:", err.message)
    }
    result = { changed: true, order: await getOrderById(id) }
  }

  return result
}

/**
 * Cancel pending prepaid orders past their deadline. COD orders have a NULL
 * expires_at and are excluded by the query itself, not by a code path that
 * could be forgotten. An order that already has a payment_proof_url is also
 * excluded - the buyer already did their part (paid and uploaded proof) and
 * is now only waiting on the seller to confirm, so the payment deadline no
 * longer applies to them; auto-cancelling here would punish the buyer for
 * the seller's own delay.
 */
async function releaseExpiredOrders(now = new Date()) {
  const [due] = await db.query(
    `SELECT id FROM orders
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
        AND payment_proof_url IS NULL`,
    [now]
  )

  // The rows above were read on the pool with no lock held, so each one may
  // have moved on before we get to it. expectedFromStatus/expiredBefore/
  // requireNoProof make the cancel conditional on the row still being what
  // the query selected.
  let released = 0
  for (const row of due) {
    const cancelled = await transitionOrder(row.id, "cancelled", {
      expectedFromStatus: "pending",
      expiredBefore: now,
      requireNoProof: true,
      cancel_reason: "Đơn hàng tự động hủy do quá hạn chuyển khoản.",
    })
    if (cancelled) released += 1
  }
  return released
}

module.exports = {
  createOrder,
  getOrderByToken,
  getOrderById,
  listOrders,
  listBoothOrdersWithItems,
  transitionOrder,
  updateBuyerInfo,
  savePaymentProof,
  releaseExpiredOrders,
  OutOfStockError,
  VariantNotFoundError,
  EmptyCartError,
  RequestKeyConflictError,
  FulfillmentNotOfferedError,
  CollectionNotActiveError,
  NoCodForDigitalError,
  NoCodForGachaError,
  MixedGachaCartError,
  GachaPoolSoldOutError,
  FulfillmentRequiredError,
  InvalidBuyerInfoError,
  OrderNotEditableError,
}
