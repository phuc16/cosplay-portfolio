const db = require("./../db")
const { slugify, uniqueSlug } = require("./slug")

const PUBLIC_STATUSES = ["active", "closed"]

/** MySQL returns tinyint(1) as 0/1; the API contract is booleans. */
function mapCollection(row) {
  if (!row) return null
  return {
    ...row,
    allow_ship: Boolean(row.allow_ship),
    allow_pickup: Boolean(row.allow_pickup),
  }
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

async function listAllCollections() {
  const [rows] = await db.query(
    "SELECT * FROM collections ORDER BY sort_order ASC, id ASC"
  )
  return rows.map(mapCollection)
}

async function listPublicCollections() {
  const [rows] = await db.query(
    `SELECT c.*, COUNT(p.id) AS product_count
       FROM collections c
       LEFT JOIN products p ON p.collection_id = c.id
      WHERE c.status IN (?, ?)
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC`,
    PUBLIC_STATUSES
  )
  return rows.map((r) => ({ ...mapCollection(r), product_count: Number(r.product_count) }))
}

async function getPublicCollectionBySlug(slug) {
  const [[collection]] = await db.query(
    "SELECT * FROM collections WHERE slug = ? AND status IN (?, ?) LIMIT 1",
    [slug, ...PUBLIC_STATUSES]
  )
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
    byProduct.get(v.product_id).push(v)
  }

  return {
    ...mapCollection(collection),
    products: products.map((p) => ({
      ...p,
      images: parseImages(p.images),
      variants: byProduct.get(p.id) || [],
    })),
  }
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
        allow_ship, allow_pickup, pickup_location, pickup_note, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      sortOrder,
    ]
  )
  return res.insertId
}

async function updateCollection(id, data) {
  const [res] = await db.query(
    `UPDATE collections
        SET title = ?, description = ?, cover_image = ?, thumbnail_image = ?, status = ?,
            allow_ship = ?, allow_pickup = ?, pickup_location = ?, pickup_note = ?
      WHERE id = ?`,
    [
      data.title,
      data.description || null,
      data.cover_image || null,
      data.thumbnail_image || null,
      data.status || "draft",
      data.allow_ship === undefined ? true : Boolean(data.allow_ship),
      Boolean(data.allow_pickup),
      data.pickup_location || null,
      data.pickup_note || null,
      id,
    ]
  )
  return res.affectedRows > 0
}

async function deleteCollection(id) {
  const [res] = await db.query("DELETE FROM collections WHERE id = ?", [id])
  return res.affectedRows > 0
}

async function createProduct(data) {
  const sortOrder = await nextSortOrder("products", "WHERE collection_id = ?", [data.collection_id])
  const [res] = await db.query(
    `INSERT INTO products (collection_id, name, description, price, images, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.collection_id,
      data.name,
      data.description || null,
      Number(data.price) || 0,
      JSON.stringify(data.images || []),
      sortOrder,
    ]
  )
  return res.insertId
}

async function updateProduct(id, data) {
  const [res] = await db.query(
    "UPDATE products SET name = ?, description = ?, price = ?, images = ? WHERE id = ?",
    [data.name, data.description || null, Number(data.price) || 0, JSON.stringify(data.images || []), id]
  )
  return res.affectedRows > 0
}

async function deleteProduct(id) {
  const [res] = await db.query("DELETE FROM products WHERE id = ?", [id])
  return res.affectedRows > 0
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

      if (v.id) {
        // The product_id guard stops one product's request editing another's variant.
        await conn.query(
          "UPDATE product_variants SET label = ?, image_url = ?, stock_qty = ?, sort_order = ? WHERE id = ? AND product_id = ?",
          [v.label, v.image_url || null, stock, index, v.id, productId]
        )
      } else {
        await conn.query(
          "INSERT INTO product_variants (product_id, label, image_url, stock_qty, sort_order) VALUES (?, ?, ?, ?, ?)",
          [productId, v.label, v.image_url || null, stock, index]
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
  createCollection,
  updateCollection,
  deleteCollection,
  createProduct,
  updateProduct,
  deleteProduct,
  replaceVariants,
}
