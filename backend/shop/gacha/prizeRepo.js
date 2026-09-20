const db = require("./../../db")
const { PUBLIC_STATUSES } = require("./../catalogRepo")

class GachaPrizeQuantityError extends Error {
  constructor(name) {
    super(`Không thể lưu: "${name}" có số lượng thấp hơn số đã quay, hoặc đã có lượt quay nhưng bị xóa khỏi danh sách`)
    this.name = "GachaPrizeQuantityError"
  }
}

async function listPrizes(productId) {
  const [rows] = await db.query(
    "SELECT * FROM gacha_prizes WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
    [productId]
  )
  return rows
}

/**
 * The public half of listPrizes. listPrizes itself stays ungated because the
 * admin prize editor and the booth kiosk legitimately manage a draft/unlisted
 * product; anything reachable without auth must instead go through this,
 * which gates on the owning collection exactly the way catalogRepo's public
 * reads do - PUBLIC_STATUSES only, no start_at clause, since a not-yet-started
 * collection is deliberately previewable (see listPublicCollections) and the
 * practice spin is part of that preview. Returns [] for a draft/archived
 * product so a caller can 404 without distinguishing "wrong id" from
 * "unpublished id".
 */
async function listPublicPrizes(productId) {
  const [rows] = await db.query(
    `SELECT gp.* FROM gacha_prizes gp
       JOIN products p ON p.id = gp.product_id
       JOIN collections c ON c.id = p.collection_id
      WHERE gp.product_id = ? AND c.status IN (?, ?)
      ORDER BY gp.sort_order ASC, gp.id ASC`,
    [productId, ...PUBLIC_STATUSES]
  )
  return rows
}

/**
 * Replaces a product's full prize list, mirroring catalogRepo's
 * replaceVariants contract: rows carrying an id are updated in place (so
 * gacha_draws' FK and drawn history survive), rows without an id are
 * inserted, and any existing row missing from the new list is deleted -
 * but only if nothing has ever been drawn from it (quantity_total -
 * quantity_remaining === 0), matching the delete-guard philosophy already
 * used for variants with live orders. Editable at any time otherwise,
 * including increasing quantity_total on a prize that already has draws.
 */
async function replacePrizes(productId, prizes) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    const [existingRows] = await conn.query(
      "SELECT id, name, quantity_total, quantity_remaining FROM gacha_prizes WHERE product_id = ? ORDER BY id ASC FOR UPDATE",
      [productId]
    )
    const existingById = new Map(existingRows.map((r) => [r.id, r]))
    const keepIds = new Set(prizes.filter((p) => p.id).map((p) => Number(p.id)))

    for (const row of existingRows) {
      if (keepIds.has(row.id)) continue
      if (row.quantity_total - row.quantity_remaining > 0) {
        throw new GachaPrizeQuantityError(row.name)
      }
      await conn.query("DELETE FROM gacha_prizes WHERE id = ?", [row.id])
    }

    let sortOrder = 0
    for (const p of prizes) {
      const quantityTotal = Number(p.quantity_total)
      const existing = p.id ? existingById.get(Number(p.id)) : null
      if (existing) {
        const drawn = existing.quantity_total - existing.quantity_remaining
        if (quantityTotal < drawn) throw new GachaPrizeQuantityError(existing.name)
        const newRemaining = existing.quantity_remaining + (quantityTotal - existing.quantity_total)
        await conn.query(
          `UPDATE gacha_prizes
             SET name = ?, description = ?, image_url = ?, tier = ?, display_price = ?,
                 quantity_total = ?, quantity_remaining = ?, sort_order = ?
           WHERE id = ?`,
          [p.name, p.description || null, p.image_url || null, p.tier, Number(p.display_price) || 0,
            quantityTotal, newRemaining, sortOrder, existing.id]
        )
      } else {
        await conn.query(
          `INSERT INTO gacha_prizes
             (product_id, name, description, image_url, tier, display_price, quantity_total, quantity_remaining, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, p.name, p.description || null, p.image_url || null, p.tier, Number(p.display_price) || 0,
            quantityTotal, quantityTotal, sortOrder]
        )
      }
      sortOrder += 1
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

module.exports = { listPrizes, listPublicPrizes, replacePrizes, GachaPrizeQuantityError }
