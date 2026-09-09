const db = require("./../db")
const { slugify, uniqueSlug } = require("./slug")

const PUBLIC_STATUSES = ["active", "closed"]

class VariantInUseError extends Error {
  constructor(labels) {
    super(`Không thể xóa phân loại đang có đơn hàng: ${labels.join(", ")}`)
    this.name = "VariantInUseError"
    this.labels = labels
  }
}

const LIVE_ORDER_STATUSES = ["pending", "confirmed", "shipped"]

/** Variant ids referenced by an order that is not yet finished or cancelled. */
async function variantsWithLiveOrders(variantIds) {
  if (!variantIds.length) return []
  const [rows] = await db.query(
    `SELECT DISTINCT oi.product_variant_id AS id, v.label
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN product_variants v ON v.id = oi.product_variant_id
      WHERE o.status IN (?, ?, ?)
        AND oi.product_variant_id IN (${variantIds.map(() => "?").join(",")})`,
    [...LIVE_ORDER_STATUSES, ...variantIds]
  )
  return rows
}

/** MySQL returns tinyint(1) as 0/1; the API contract is booleans. */
function mapCollection(row) {
  if (!row) return null
  return {
    ...row,
    allow_ship: Boolean(row.allow_ship),
    allow_pickup: Boolean(row.allow_pickup),
  }
}

/** Normalizes a start_at/end_at value to a Date mysql2 can serialize correctly - a raw ISO string with milliseconds/Z (e.g. from .toISOString()) otherwise throws ER_TRUNCATED_WRONG_VALUE. */
function normalizeDatetime(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** products.images is a JSON column; mysql2 may hand back a string or an array. */
function parseImages(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

async function nextSortOrder(table, whereSql = "", params = []) {
  const [[{ next }]] = await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM \`${table}\` ${whereSql}`,
    params
  )
  return next
}

/**
 * Real, persisted transition - not a display-only computed value. Called by
 * every collection-read path below, so the first read after end_at (by
 * anyone - admin or a buyer) is what flips it; there is no separate
 * sweep/cron. The `AND status = 'active'` guard makes concurrent calls
 * from simultaneous requests safely idempotent.
 */
async function closeExpiredCollections(rows) {
  const now = new Date()
  const due = rows.filter((r) => r.status === "active" && r.end_at && new Date(r.end_at) <= now)
  if (!due.length) return rows

  const ids = due.map((r) => r.id)
  await db.query(
    `UPDATE collections SET status = 'closed' WHERE id IN (${ids.map(() => "?").join(",")}) AND status = 'active'`,
    ids
  )
  const dueIds = new Set(ids)
  return rows.map((r) => (dueIds.has(r.id) ? { ...r, status: "closed" } : r))
}

async function listAllCollections() {
  const [rows] = await db.query(
    "SELECT * FROM collections ORDER BY sort_order ASC, id ASC"
  )
  const updated = await closeExpiredCollections(rows)
  return updated.map(mapCollection)
}

async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count,
            EXISTS (SELECT 1 FROM products dp WHERE dp.collection_id = c.id AND dp.type = 'digital') AS has_digital_item
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?)
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  const updated = await closeExpiredCollections(rows)
  // A collection whose start_at hasn't arrived yet is now included (buyers
  // can preview it), flagged here so the frontend can hide ordering - same
  // JS "now" comparison closeExpiredCollections above already uses for
  // end_at, not a UTC_TIMESTAMP() SQL clause, since this is a display flag,
  // not the actual order-time gate (that's createOrder's own independent check).
  const now = new Date()
  return updated.map((r) => ({
    ...mapCollection(r), product_count: Number(r.product_count), has_digital_item: Boolean(r.has_digital_item),
    not_started_yet: Boolean(r.start_at) && new Date(r.start_at) > now,
  }))
}

/** Nests a collection row with its products and each product's variants. */
async function nestCollectionDetail(collection) {
  if (!collection) return null

  const [products] = await db.query(
    "SELECT * FROM products WHERE collection_id = ? ORDER BY sort_order ASC, id ASC",
    [collection.id]
  )

  let variants = []
  if (products.length) {
    const ids = products.map((p) => p.id)
    const [rows] = await db.query(
      `SELECT * FROM product_variants
        WHERE product_id IN (${ids.map(() => "?").join(",")})
        ORDER BY sort_order ASC, id ASC`,
      ids
    )
    variants = rows
  }

  const byProduct = new Map()
  for (const v of variants) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, [])
    byProduct.get(v.product_id).push({ ...v, images: parseImages(v.images) })
  }

  return {
    ...mapCollection(collection),
    products: products.map((p) => {
      const productVariants = byProduct.get(p.id) || []
      // Digital products have no variant list in any UI - the one hidden
      // variant they do have is flattened onto the product itself here so
      // nothing downstream needs to know it secretly exists.
      if (p.type === "digital") {
        const hidden = productVariants[0] || null
        return {
          ...p,
          images: parseImages(p.images),
          variants: [],
          variant_id: hidden?.id ?? null,
          stock_qty: hidden?.stock_qty ?? null,
          delivery_link: hidden?.delivery_link ?? null,
          thumbnail_image: hidden?.thumbnail_image ?? null,
        }
      }
      return {
        ...p,
        images: parseImages(p.images),
        variants: productVariants,
      }
    }),
  }
}

async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) LIMIT 1",
    [slug, ...PUBLIC_STATUSES]
  )
  if (!collection) return null
  const [updated] = await closeExpiredCollections([collection])
  // Same not_started_yet flag as listPublicCollections, computed the same
  // way - see that function's comment for why this is a JS "now" comparison
  // rather than a SQL clause.
  const notStartedYet = Boolean(updated.start_at) && new Date(updated.start_at) > new Date()
  const detail = await nestCollectionDetail(updated)
  // delivery_link is only trustworthy once an order is confirmed/shipped/completed
  // (see routes/orders.js and email templates.js) - nestCollectionDetail is shared
  // with the admin-only getCollectionDetailById, which legitimately needs the link,
  // so it is stripped here, on the public path only. stock_qty stays: buyers
  // legitimately need to see stock/sold-out state before ever placing an order.
  return {
    ...detail,
    not_started_yet: notStartedYet,
    products: detail.products.map(({ delivery_link, ...rest }) => rest),
  }
}

/** Admin-only: full nested detail by id, regardless of status (draft/archived included). */
async function getCollectionDetailById(id) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE id = ? LIMIT 1",
    [id]
  )
  if (!collection) return null
  const [updated] = await closeExpiredCollections([collection])
  return nestCollectionDetail(updated)
}

async function createCollection(data, attempt = 0) {
  const [rows] = await db.query("SELECT slug FROM collections")
  const slug = uniqueSlug(slugify(data.title), rows.map((r) => r.slug))
  const sortOrder = await nextSortOrder("collections")

  try {
    return await insertCollection(data, slug, sortOrder)
  } catch (err) {
    // Read-then-insert is a TOCTOU race: two concurrent creates of the same
    // title both compute the same slug and one loses on the unique index.
    // Retrying re-reads, so the loser now sees the winner and picks -2.
    if (err.code === "ER_DUP_ENTRY" && attempt < 5) {
      return createCollection(data, attempt + 1)
    }
    throw err
  }
}

async function insertCollection(data, slug, sortOrder) {
  const [res] = await db.query(
    `INSERT INTO collections
       (title, slug, description, cover_image, thumbnail_image, status,
        allow_ship, allow_pickup, pickup_location, pickup_note, payment_deadline_hours,
        start_at, end_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      slug,
      data.description || null,
      data.cover_image || null,
      data.thumbnail_image || null,
      data.status || "draft",
      data.allow_ship === undefined ? true : Boolean(data.allow_ship),
      Boolean(data.allow_pickup),
      data.pickup_location || null,
      data.pickup_note || null,
      data.payment_deadline_hours || null,
      normalizeDatetime(data.start_at),
      normalizeDatetime(data.end_at),
      sortOrder,
    ]
  )
  return res.insertId
}

async function updateCollection(id, data, attempt = 0) {
  // The slug is re-derived from the title on every edit (not just at
  // creation) so a renamed collection's URL always matches its current
  // name - otherwise a copy renamed away from "X (Copy)" would keep the
  // stale "-copy" slug forever. Other collections' slugs are the collision
  // set; excluding this row's own current slug means an unchanged title
  // never gets needlessly bumped to "-2".
  const [rows] = await db.query("SELECT slug FROM collections WHERE id != ?", [id])
  const slug = uniqueSlug(slugify(data.title), rows.map((r) => r.slug))

  try {
    const [res] = await db.query(
      `UPDATE collections
          SET title = ?, slug = ?, description = ?, cover_image = ?, thumbnail_image = ?, status = ?,
              allow_ship = ?, allow_pickup = ?, pickup_location = ?, pickup_note = ?, payment_deadline_hours = ?,
              start_at = ?, end_at = ?
        WHERE id = ?`,
      [
        data.title,
        slug,
        data.description || null,
        data.cover_image || null,
        data.thumbnail_image || null,
        data.status || "draft",
        data.allow_ship === undefined ? true : Boolean(data.allow_ship),
        Boolean(data.allow_pickup),
        data.pickup_location || null,
        data.pickup_note || null,
        data.payment_deadline_hours || null,
        normalizeDatetime(data.start_at),
        normalizeDatetime(data.end_at),
        id,
      ]
    )
    return res.affectedRows > 0
  } catch (err) {
    // Same TOCTOU race as createCollection: two concurrent renames landing
    // on the same slug both read it as free and one loses on the unique index.
    if (err.code === "ER_DUP_ENTRY" && attempt < 5) {
      return updateCollection(id, data, attempt + 1)
    }
    throw err
  }
}

/**
 * Duplicate a collection along with every product and variant inside it -
 * saves re-entering a large photocard sheet from scratch for a similar
 * drop. The copy always starts as `draft` regardless of the source's
 * status, since it still needs review/edits (dates, title) before it should
 * be orderable. Images are referenced, not re-uploaded - both collections
 * point at the same MinIO objects.
 */
async function copyCollection(id) {
  const source = await getCollectionDetailById(id)
  if (!source) return null

  const newId = await createCollection({
    title: `${source.title} (Copy)`,
    description: source.description,
    cover_image: source.cover_image,
    thumbnail_image: source.thumbnail_image,
    status: "draft",
    allow_ship: source.allow_ship,
    allow_pickup: source.allow_pickup,
    pickup_location: source.pickup_location,
    pickup_note: source.pickup_note,
    payment_deadline_hours: source.payment_deadline_hours,
  })

  for (const p of source.products) {
    const newProductId = await createProduct({
      collection_id: newId,
      name: p.name,
      description: p.description,
      price: p.price,
      images: p.images,
      type: p.type,
      stock_qty: p.stock_qty,
      delivery_link: p.delivery_link,
      thumbnail_image: p.thumbnail_image,
    })
    if (p.type !== "digital" && p.variants.length) {
      await replaceVariants(
        newProductId,
        p.variants.map((v) => ({
          label: v.label, image_url: v.image_url, images: v.images,
          thumbnail_image: v.thumbnail_image, description: v.description, stock_qty: v.stock_qty,
          delivery_link: v.delivery_link,
        }))
      )
    }
  }

  return newId
}

/**
 * Guards a cascading DELETE against silently wiping variants (and nulling
 * their order_items) still referenced by a live order - same shape as the
 * live-order check in replaceVariants, run on the same connection/transaction
 * that holds the row locks so a concurrent checkout can't slip in between.
 */
async function blockedVariantsOnConn(conn, variantIds) {
  if (!variantIds.length) return []
  const [rows] = await conn.query(
    `SELECT DISTINCT oi.product_variant_id AS id, v.label
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN product_variants v ON v.id = oi.product_variant_id
      WHERE o.status IN (?, ?, ?)
        AND oi.product_variant_id IN (${variantIds.map(() => "?").join(",")})`,
    [...LIVE_ORDER_STATUSES, ...variantIds]
  )
  return rows
}

async function deleteCollection(id) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [variants] = await conn.query(
      `SELECT v.id, v.label FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE p.collection_id = ? ORDER BY v.id ASC FOR UPDATE`,
      [id]
    )
    const blocked = await blockedVariantsOnConn(conn, variants.map((v) => v.id))
    if (blocked.length) throw new VariantInUseError(blocked.map((b) => b.label))

    const [res] = await conn.query("DELETE FROM collections WHERE id = ?", [id])
    await conn.commit()
    return res.affectedRows > 0
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const type = data.type === "digital" ? "digital" : "physical"
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      type,
      sortOrder,
    ]
  )
  const productId = res.insertId
  // Digital products have no admin-managed variant list - this single
  // hidden row (no label) carries stock_qty/delivery_link through the same
  // variant_id-based cart/order_items/stock-decrement pipeline unchanged.
  if (type === "digital") {
    await replaceVariants(productId, [{
      label: "",
      stock_qty: data.stock_qty,
      delivery_link: data.delivery_link,
      thumbnail_image: data.thumbnail_image,
    }])
  }
  return productId
}

async function updateProduct(id, data) {
  const [[existing]] = await db.query("SELECT type FROM products WHERE id = ?", [id])
  if (!existing) return false

  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ? WHERE id = ?",
    [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), id]
  )

  if (existing.type === "digital") {
    // Reuses the hidden variant's own id - replaceVariants must UPDATE it,
    // never delete-and-recreate: order_items.product_variant_id would SET
    // NULL on every edit, and a live order referencing it would make
    // replaceVariants throw VariantInUseError on an ordinary product edit.
    const [[currentVariant]] = await db.query(
      "SELECT id, stock_qty, delivery_link, thumbnail_image FROM product_variants WHERE product_id = ? LIMIT 1",
      [id]
    )
    // A field omitted from the request body (undefined) falls back to the
    // current value instead of being coerced to null by replaceVariants - an
    // explicit null/"" is still honored as "clear the field". Otherwise a
    // partial-payload caller (a script, a future partial-update form) would
    // silently blank the product's entire deliverable.
    await replaceVariants(id, [{
      id: currentVariant ? currentVariant.id : undefined,
      label: "",
      stock_qty: data.stock_qty !== undefined ? data.stock_qty : currentVariant?.stock_qty,
      delivery_link: data.delivery_link !== undefined ? data.delivery_link : currentVariant?.delivery_link,
      thumbnail_image: data.thumbnail_image !== undefined ? data.thumbnail_image : currentVariant?.thumbnail_image,
    }])
  }

  return res.affectedRows > 0
}

async function deleteProduct(id) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [variants] = await conn.query(
      "SELECT id, label FROM product_variants WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [id]
    )
    const blocked = await blockedVariantsOnConn(conn, variants.map((v) => v.id))
    if (blocked.length) throw new VariantInUseError(blocked.map((b) => b.label))

    const [res] = await conn.query("DELETE FROM products WHERE id = ?", [id])
    await conn.commit()
    return res.affectedRows > 0
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Persist a drag-and-drop reorder of a collection's products. Scoped by
 * `collection_id` in the WHERE (not just `id IN (...)`) so a stale/forged
 * id list can never touch another collection's rows.
 */
async function reorderProducts(collectionId, productIds) {
  const cases = productIds.map(() => "WHEN ? THEN ?").join(" ")
  const caseParams = productIds.flatMap((id, index) => [id, index])
  const idPlaceholders = productIds.map(() => "?").join(",")
  await db.query(
    `UPDATE products SET sort_order = CASE id ${cases} END WHERE collection_id = ? AND id IN (${idPlaceholders})`,
    [...caseParams, collectionId, ...productIds]
  )
}

/**
 * Make the product's variants match `variants` exactly: update those carrying
 * an id, insert those without, delete any existing row not in the list.
 * stock_qty === null is preserved as NULL (unlimited), not coerced to 0.
 */
async function replaceVariants(productId, variants) {
  const list = Array.isArray(variants) ? variants : []
  const keepIds = list.map((v) => v.id).filter(Boolean)

  // Transactional: this deletes before it inserts, so a failure partway
  // through an untransacted version would wipe a product's entire stock list.
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Lock the product's full current variant set before deciding what to
    // remove. Row locks acquired in ascending id order, same convention as
    // orderRepo.createOrder's `FOR UPDATE OF v` - so a concurrent checkout
    // locking the same variant rows (also ascending) can never grab them in
    // the opposite order and deadlock against this save.
    const [current] = await conn.query(
      "SELECT id FROM product_variants WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [productId]
    )
    const keeping = new Set(keepIds)
    const removing = current.map((r) => r.id).filter((id) => !keeping.has(id))

    // A variant holding a live reservation must not be deleted: order_items
    // uses SET NULL so the history survives, but the reserved stock could
    // then never be returned when that order is cancelled. Running this
    // check on `conn`, inside the same transaction that now holds the row
    // locks above, closes the TOCTOU race where a checkout could commit a
    // new order against one of `removing` between an earlier unlocked check
    // and this transaction's delete.
    if (removing.length) {
      const [blocked] = await conn.query(
        `SELECT DISTINCT oi.product_variant_id AS id, v.label
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN product_variants v ON v.id = oi.product_variant_id
          WHERE o.status IN (?, ?, ?)
            AND oi.product_variant_id IN (${removing.map(() => "?").join(",")})`,
        [...LIVE_ORDER_STATUSES, ...removing]
      )
      if (blocked.length) throw new VariantInUseError(blocked.map((b) => b.label))
    }

    if (keepIds.length) {
      await conn.query(
        `DELETE FROM product_variants
          WHERE product_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`,
        [productId, ...keepIds]
      )
    } else {
      await conn.query("DELETE FROM product_variants WHERE product_id = ?", [productId])
    }

    for (const [index, v] of list.entries()) {
      const stock = v.stock_qty === null || v.stock_qty === undefined || v.stock_qty === ""
        ? null
        : Number(v.stock_qty)

      // `images` is the additive gallery; `image_url` stays its first entry
      // so any code still reading the single-photo column keeps working.
      const images = Array.isArray(v.images) ? v.images.filter(Boolean) : []
      const imageUrl = images[0] || v.image_url || null

      if (v.id) {
        // The product_id guard stops one product's request editing another's variant.
        // If `id` does not belong to `productId`, this matches zero rows and the
        // variant is silently dropped from the result - this is intentional
        // isolation between products' variant lists, not a bug, but callers must
        // not rely on this update succeeding without checking product ownership
        // themselves.
        await conn.query(
          "UPDATE product_variants SET label = ?, image_url = ?, images = ?, thumbnail_image = ?, description = ?, stock_qty = ?, delivery_link = ?, sort_order = ? WHERE id = ? AND product_id = ?",
          [v.label, imageUrl, JSON.stringify(images), v.thumbnail_image || null, v.description || null, stock, v.delivery_link || null, index, v.id, productId]
        )
      } else {
        await conn.query(
          "INSERT INTO product_variants (product_id, label, image_url, images, thumbnail_image, description, stock_qty, delivery_link, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [productId, v.label, imageUrl, JSON.stringify(images), v.thumbnail_image || null, v.description || null, stock, v.delivery_link || null, index]
        )
      }
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

module.exports = {
  listAllCollections,
  listPublicCollections,
  getPublicCollectionBySlug,
  getCollectionDetailById,
  createCollection,
  updateCollection,
  copyCollection,
  deleteCollection,
  createProduct,
  updateProduct,
  deleteProduct,
  reorderProducts,
  replaceVariants,
  VariantInUseError,
  variantsWithLiveOrders,
}
