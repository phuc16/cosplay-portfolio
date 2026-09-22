import { describe, it, expect, beforeEach, afterAll, vi } from "vitest"
import db from "../db.js"
import repo from "../shop/orders/orderRepo.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import sessionRepo from "../shop/gacha/sessionRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = {
  buyer_name: "Nguyễn Văn A",
  phone: "0900000000",
  email: "a@example.com",
  address_raw: "1 Đường ABC, Q1, TP.HCM",
}

async function seedVariant(stock, collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { cid, pid, variantId: v.id }
}

async function seedDigitalVariant(stock, deliveryLink = "https://drive.google.com/x", collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({
    collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
    stock_qty: stock, delivery_link: deliveryLink,
  })
  const detail = await catalog.getCollectionDetailById(cid)
  return { cid, pid, variantId: detail.products[0].variant_id }
}

async function seedGachaVariant(prizeQuantity, collectionOver = {}) {
  const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active", ...collectionOver })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  // Temporary shim: catalogRepo.createProduct still coerces every non-digital
  // type to 'physical' and only creates the hidden variant for digital. Task 6
  // teaches it about 'gacha'; until then the seed writes the real type and the
  // hidden variant itself. Redundant no-op once Task 6 lands.
  await db.query("UPDATE products SET type = 'gacha' WHERE id = ?", [pid])
  await catalog.replaceVariants(pid, [{ label: "", stock_qty: null }])
  await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: prizeQuantity }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { cid, pid, variantId: v.id }
}

async function seedGift({ enabled = true, name = "Postcard", minTotal = 100000, deliveryLink = null, imageUrl = null } = {}) {
  await db.query(
    "INSERT INTO gift_settings (enabled, name, min_total, delivery_link, image_url) VALUES (?, ?, ?, ?, ?)",
    [enabled, name, minTotal, deliveryLink, imageUrl]
  )
}

const order = (variantId, qty = 1, over = {}) => ({
  items: [{ variant_id: variantId, qty }],
  buyer,
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

async function orderWithBuyer(over = {}) {
  const { variantId } = await seedVariant(5)
  return repo.createOrder(order(variantId, 1, over))
}

beforeEach(async () => {
  await resetTables("email_queue", "gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections", "gift_settings")
})

// gift_settings is a table many other test files don't yet know to reset in
// their own beforeEach - without this, a row left behind by this file's last
// test would silently leak into whichever test file runs next and calls
// createOrder, making every order in that file unexpectedly gift-eligible.
afterAll(async () => {
  await db.query("DELETE FROM gift_settings")
})

describe("createOrder", () => {
  it("reserves stock immediately", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId, 2))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(3)
  })

  it("computes the total server-side from catalog prices", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 3))
    expect(res.total).toBe(105000)
  })

  it("ignores any client-supplied price or total", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder({
      ...order(variantId, 1),
      total: 1,
      items: [{ variant_id: variantId, qty: 1, unit_price_snapshot: 1, price: 1 }],
    })
    expect(res.total).toBe(35000)

    const [[item]] = await db.query("SELECT unit_price_snapshot FROM order_items LIMIT 1")
    expect(item.unit_price_snapshot).toBe(35000)
  })

  it("snapshots the product name and variant label", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId))

    const [[item]] = await db.query("SELECT * FROM order_items LIMIT 1")
    expect(item.product_name_snapshot).toBe("Photocard")
    expect(item.variant_label_snapshot).toBe("A1")
  })

  it("does not decrement unlimited stock", async () => {
    const { variantId } = await seedVariant(null)
    await repo.createOrder(order(variantId, 100))

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBeNull()
  })

  it("refuses to oversell and leaves stock untouched", async () => {
    const { variantId } = await seedVariant(2)
    await expect(repo.createOrder(order(variantId, 3))).rejects.toThrow(repo.OutOfStockError)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(2)
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("carries both the product name and variant label on OutOfStockError, to disambiguate a cart with the same variant label across products", async () => {
    const { variantId } = await seedVariant(2)
    try {
      await repo.createOrder(order(variantId, 3))
      throw new Error("expected createOrder to reject")
    } catch (err) {
      expect(err).toBeInstanceOf(repo.OutOfStockError)
      expect(err.productName).toBe("Photocard")
      expect(err.variantLabel).toBe("A1")
      expect(err.variantId).toBe(variantId)
    }
  })

  it("rejects an empty cart", async () => {
    await expect(repo.createOrder({ ...order(1), items: [] })).rejects.toThrow(repo.EmptyCartError)
  })

  it("rejects a cart referencing a variant_id that does not exist, with a distinct error from OutOfStockError", async () => {
    await expect(repo.createOrder(order(999999))).rejects.toThrow(repo.VariantNotFoundError)
    await expect(repo.createOrder(order(999999))).rejects.not.toThrow(repo.OutOfStockError)
  })

  it("reports exactly which variant_ids were missing, so the client knows what to drop from the cart", async () => {
    const { variantId } = await seedVariant(5)
    try {
      await repo.createOrder({
        ...order(variantId),
        items: [{ variant_id: variantId, qty: 1 }, { variant_id: 999999, qty: 1 }],
      })
      throw new Error("expected createOrder to reject")
    } catch (err) {
      expect(err).toBeInstanceOf(repo.VariantNotFoundError)
      expect(err.missingVariantIds).toEqual([999999])
    }
  })

  it("rolls back everything if one line of a multi-item order is short", async () => {
    const { pid, variantId } = await seedVariant(5)
    await catalog.replaceVariants(pid, [
      { label: "A1", stock_qty: 5 },
      { label: "A2", stock_qty: 1 },
    ])
    const [rows] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
    const a1 = rows.find((r) => r.label === "A1")
    const a2 = rows.find((r) => r.label === "A2")

    await expect(repo.createOrder({
      ...order(a1.id),
      items: [{ variant_id: a1.id, qty: 1 }, { variant_id: a2.id, qty: 5 }],
    })).rejects.toThrow(repo.OutOfStockError)

    const [after] = await db.query("SELECT label, stock_qty FROM product_variants ORDER BY label")
    expect(after.map((r) => r.stock_qty)).toEqual([5, 1])
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
    void variantId
  })

  it("sets an expiry for prepaid orders", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    const [[o]] = await db.query("SELECT expires_at FROM orders WHERE id = ?", [res.id])
    expect(o.expires_at).not.toBeNull()
  })

  it("never sets an expiry for COD", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1, { payment_method: "cod" }))
    const [[o]] = await db.query("SELECT expires_at, cod_amount FROM orders WHERE id = ?", [res.id])
    expect(o.expires_at).toBeNull()
    expect(o.cod_amount).toBe(35000)
  })

  it("uses the collection's own payment_deadline_hours override for the expiry, not the system default", async () => {
    const { variantId } = await seedVariant(5, { payment_deadline_hours: 6 })
    const before = Date.now()
    const res = await repo.createOrder(order(variantId))
    const [[o]] = await db.query("SELECT expires_at FROM orders WHERE id = ?", [res.id])

    const hoursAhead = (new Date(o.expires_at).getTime() - before) / (60 * 60 * 1000)
    expect(hoursAhead).toBeGreaterThan(5.9)
    expect(hoursAhead).toBeLessThan(6.1)
  })

  it("falls back to the system default expiry when the collection has no override", async () => {
    const { variantId } = await seedVariant(5)
    const before = Date.now()
    const res = await repo.createOrder(order(variantId))
    const [[o]] = await db.query("SELECT expires_at FROM orders WHERE id = ?", [res.id])

    const hoursAhead = (new Date(o.expires_at).getTime() - before) / (60 * 60 * 1000)
    expect(hoursAhead).toBeGreaterThan(47.9)
    expect(hoursAhead).toBeLessThan(48.1)
  })

  it("reuses the existing order when the same request_key is replayed", async () => {
    const { variantId } = await seedVariant(5)
    const first = await repo.createOrder(order(variantId, 1, { request_key: "abc123" }))
    const second = await repo.createOrder(order(variantId, 1, { request_key: "abc123" }))

    expect(second.reused).toBe(true)
    expect(second.order_token).toBe(first.order_token)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(1)
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(4) // reserved once, not twice
  })

  it("never hands a different buyer's order back when they reuse a request_key", async () => {
    const { variantId } = await seedVariant(5)
    const first = await repo.createOrder(order(variantId, 1, { request_key: "shared-key" }))

    const stranger = {
      buyer_name: "Trần Thị B",
      phone: "0911111111",
      email: "b@example.com",
      address_raw: "9 Đường XYZ, Q3, TP.HCM",
    }
    await expect(
      repo.createOrder(order(variantId, 1, { request_key: "shared-key", buyer: stranger }))
    ).rejects.toThrow(repo.RequestKeyConflictError)

    // No second order, and above all no leak of the first buyer's token.
    const [orders] = await db.query("SELECT id, email, order_token FROM orders")
    expect(orders).toHaveLength(1)
    expect(orders[0].email).toBe("a@example.com")
    expect(orders[0].order_token).toBe(first.order_token)

    // The refused attempt rolled back the stock it had already reserved.
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(4)
  })

  it("never hands a stranger's order back when both buyers submit a blank email with the same request_key", async () => {
    const { variantId } = await seedVariant(5)
    const first = await repo.createOrder(order(variantId, 1, {
      request_key: "blank-email-key",
      buyer: { ...buyer, email: "" },
    }))

    const stranger = {
      buyer_name: "Trần Thị B",
      phone: "0911111111",
      email: "",
      address_raw: "9 Đường XYZ, Q3, TP.HCM",
    }

    let second
    try {
      second = await repo.createOrder(order(variantId, 1, {
        request_key: "blank-email-key",
        buyer: stranger,
      }))
    } catch (err) {
      expect(err).toBeInstanceOf(repo.RequestKeyConflictError)
      second = null
    }

    if (second) {
      // Only acceptable outcome besides the conflict error: the second buyer
      // got their OWN order, never the first buyer's token.
      expect(second.order_token).not.toBe(first.order_token)
    }
  })

  it("refuses a pickup order for a ship-only collection", async () => {
    const { variantId } = await seedVariant(5, { allow_ship: true, allow_pickup: false })
    await expect(
      repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    ).rejects.toThrow(repo.FulfillmentNotOfferedError)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5) // rejected before any stock was touched
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("refuses a ship order for a pickup-only collection", async () => {
    const { variantId } = await seedVariant(5, { allow_ship: false, allow_pickup: true })
    await expect(
      repo.createOrder(order(variantId, 1, { fulfillment_method: "ship" }))
    ).rejects.toThrow(repo.FulfillmentNotOfferedError)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  // A cart item can be added while its collection is "active" and then
  // outlive that - the seller closes the drop before the buyer checks out.
  // Without this guard, createOrder never looked at collection.status at
  // all, so a stale cart could still place an order against an ended drop.
  it("refuses an order for a closed collection, leaving stock untouched", async () => {
    const { variantId } = await seedVariant(5, { status: "closed" })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("refuses an order for a draft collection (defense in depth - never publicly listed anyway)", async () => {
    const { variantId } = await seedVariant(5, { status: "draft" })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)
  })

  it("refuses an order for an archived collection", async () => {
    const { variantId } = await seedVariant(5, { status: "archived" })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)
  })

  it("rejects an order once the collection's end_at has passed, even if status is still 'active' in the DB", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { end_at: past })

    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)

    const [[row]] = await db.query(
      "SELECT c.status FROM product_variants v JOIN products p ON p.id = v.product_id JOIN collections c ON c.id = p.collection_id WHERE v.id = ?",
      [variantId]
    )
    expect(row.status).toBe("active") // createOrder itself never writes the transition - see Task 2 for that
  })

  it("still allows an order when end_at is in the future", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { end_at: future })

    await expect(repo.createOrder(order(variantId, 1))).resolves.toMatchObject({ reused: false })
  })

  it("rejects an order on a collection whose start_at hasn't arrived yet, even with a valid variant_id in hand", async () => {
    const future = new Date(Date.now() + 15 * 60 * 1000)
    const { variantId } = await seedVariant(5, { start_at: future })

    await expect(repo.createOrder(order(variantId, 1))).rejects.toThrow(repo.CollectionNotActiveError)
  })

  it("tags CollectionNotActiveError with reason 'not_started' for a not-yet-started collection, distinct from 'ended'/'inactive'", async () => {
    const future = new Date(Date.now() + 15 * 60 * 1000)
    const { variantId } = await seedVariant(5, { start_at: future })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toMatchObject({ reason: "not_started" })
  })

  it("tags CollectionNotActiveError with reason 'ended' once end_at has passed", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { end_at: past })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toMatchObject({ reason: "ended" })
  })

  it("tags CollectionNotActiveError with reason 'inactive' for a closed collection with no start_at/end_at involved", async () => {
    const { variantId } = await seedVariant(5, { status: "closed" })
    await expect(repo.createOrder(order(variantId, 1))).rejects.toMatchObject({ reason: "inactive" })
  })

  it("still allows an order once start_at has passed", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const { variantId } = await seedVariant(5, { start_at: past })

    await expect(repo.createOrder(order(variantId, 1))).resolves.toMatchObject({ reused: false })
  })

  it("carries the product name and variant label on CollectionNotActiveError, to identify which cart line is stuck", async () => {
    const { variantId } = await seedVariant(5, { status: "closed" })
    try {
      await repo.createOrder(order(variantId, 1))
      throw new Error("expected createOrder to reject")
    } catch (err) {
      expect(err).toBeInstanceOf(repo.CollectionNotActiveError)
      expect(err.productName).toBe("Photocard")
      expect(err.variantLabel).toBe("A1")
      expect(err.variantId).toBe(variantId)
    }
  })

  it("rejects a multi-item cart if any single line's collection is closed, even when the other line's collection is active", async () => {
    const { variantId: activeId } = await seedVariant(5)
    const closedCid = await catalog.createCollection({ title: "Closed Drop", status: "closed" })
    const closedPid = await catalog.createProduct({ collection_id: closedCid, name: "Poster", price: 20000 })
    await catalog.replaceVariants(closedPid, [{ label: "B1", stock_qty: 5 }])
    const [[closedVariant]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [closedPid])

    await expect(repo.createOrder({
      ...order(activeId),
      items: [{ variant_id: activeId, qty: 1 }, { variant_id: closedVariant.id, qty: 1 }],
    })).rejects.toThrow(repo.CollectionNotActiveError)

    const [orders] = await db.query("SELECT id FROM orders")
    expect(orders).toHaveLength(0)
  })

  it("still allows pickup for a collection that offers both ship and pickup", async () => {
    const { variantId } = await seedVariant(5, { allow_ship: true, allow_pickup: true })
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    expect(res.total).toBe(35000)
  })

  it("treats a replay as the same buyer regardless of email case and padding", async () => {
    const { variantId } = await seedVariant(5)
    const first = await repo.createOrder(order(variantId, 1, { request_key: "abc123" }))
    const second = await repo.createOrder(order(variantId, 1, {
      request_key: "abc123",
      buyer: { ...buyer, email: "  A@Example.COM " },
    }))

    expect(second.reused).toBe(true)
    expect(second.order_token).toBe(first.order_token)
  })
})

describe("createOrder: access_pin", () => {
  it("returns a 6-digit plaintext access_pin, and stores only its hash", async () => {
    const { variantId } = await seedVariant(5)
    const created = await repo.createOrder(order(variantId, 1))

    expect(created.access_pin).toMatch(/^\d{6}$/)

    const [[row]] = await db.query("SELECT access_pin_hash FROM orders WHERE id = ?", [created.id])
    expect(row.access_pin_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.access_pin_hash).not.toContain(created.access_pin)
  })

  it("the stored hash actually verifies against the returned plaintext PIN", async () => {
    const { variantId } = await seedVariant(5)
    const created = await repo.createOrder(order(variantId, 1))

    const [[row]] = await db.query("SELECT access_pin_hash FROM orders WHERE id = ?", [created.id])
    const domain = (await import("../shop/orders/domain.js")).default
    expect(domain.verifyAccessPin(created.access_pin, row.access_pin_hash)).toBe(true)
  })

  it("every order gets its own independent PIN", async () => {
    const { variantId: v1 } = await seedVariant(5)
    const { variantId: v2 } = await seedVariant(5)
    const a = await repo.createOrder(order(v1, 1))
    const b = await repo.createOrder(order(v2, 1))
    expect(a.access_pin).not.toBe(b.access_pin)
  })
})

describe("createOrder: pickup_code", () => {
  it("sets a 6-digit pickup_code for a pickup order", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const created = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))

    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [created.id])
    expect(row.pickup_code).toMatch(/^\d{6}$/)
  })

  it("leaves pickup_code null for a ship order", async () => {
    const { variantId } = await seedVariant(5)
    const created = await repo.createOrder(order(variantId, 1))

    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [created.id])
    expect(row.pickup_code).toBeNull()
  })
})

describe("createOrder locking", () => {
  it("locks the variant row it is reserving", async () => {
    const { variantId } = await seedVariant(5)
    const holder = await db.getConnection()
    const pending = (async () => {
      await holder.beginTransaction()
      await holder.query("SELECT id FROM product_variants WHERE id = ? FOR UPDATE", [variantId])
      return repo.createOrder(order(variantId, 1))
    })()

    let settled = false
    const create = pending.then(
      (r) => { settled = true; return r },
      (e) => { settled = true; throw e }
    )
    create.catch(() => {})

    await new Promise((r) => setTimeout(r, 500))
    expect(settled).toBe(false) // still waiting on the variant row lock

    await holder.rollback()
    holder.release()
    expect((await create).total).toBe(35000)
  }, 20000)

  it("does not lock the parent product row", async () => {
    const { pid, variantId } = await seedVariant(5)
    const holder = await db.getConnection()
    await holder.beginTransaction()
    await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [pid])

    const create = repo.createOrder(order(variantId, 1))
    create.catch(() => {})
    try {
      const res = await Promise.race([
        create,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("createOrder blocked on the parent product row")), 4000)
        ),
      ])
      expect(res.total).toBe(35000)
    } finally {
      await holder.rollback()
      holder.release()
      await create.catch(() => {})
    }
  }, 20000)
})

describe("transitionOrder", () => {
  it("releases stock when cancelled", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("does not release stock twice when cancelled twice", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    await repo.transitionOrder(res.id, "cancelled")
    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("does not release unlimited stock", async () => {
    const { variantId } = await seedVariant(null)
    const res = await repo.createOrder(order(variantId, 3))
    await repo.transitionOrder(res.id, "cancelled")

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBeNull()
  })

  it("does not credit stock to a variant converted from unlimited to tracked after the order was placed (would otherwise oversell)", async () => {
    // Order placed while the variant is unlimited (stock_qty NULL) - no
    // decrement happens for it (see createOrder's own guard), so
    // order_items.stock_reserved is recorded false for this line.
    const { variantId } = await seedVariant(null)
    const res = await repo.createOrder(order(variantId, 3))

    // Seller later converts the variant to tracked stock, seeding real
    // inventory - unrelated to this old order, which never actually
    // reserved any of it.
    await db.query("UPDATE product_variants SET stock_qty = 10 WHERE id = ?", [variantId])

    await repo.transitionOrder(res.id, "cancelled")

    // If this credited the old order's qty (3) on top, stock_qty would read
    // 13 - overselling by 3 against real, tracked inventory.
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(10)
  })

  it("stores an admin-supplied cancel_reason", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "cancelled", { cancel_reason: "Hết hàng thực tế" })

    const [[o]] = await db.query("SELECT cancel_reason FROM orders WHERE id = ?", [res.id])
    expect(o.cancel_reason).toBe("Hết hàng thực tế")
  })

  it("leaves cancel_reason null when none is given", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "cancelled")

    const [[o]] = await db.query("SELECT cancel_reason FROM orders WHERE id = ?", [res.id])
    expect(o.cancel_reason).toBeNull()
  })

  it("ignores a cancel_reason passed for a non-cancelling transition", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "confirmed", { cancel_reason: "should not be stored" })

    const [[o]] = await db.query("SELECT cancel_reason FROM orders WHERE id = ?", [res.id])
    expect(o.cancel_reason).toBeNull()
  })

  it("refuses an illegal transition", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    expect(await repo.transitionOrder(res.id, "shipped")).toBe(false)
  })

  it("refuses to ship a pickup order", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    await repo.transitionOrder(res.id, "confirmed")
    expect(await repo.transitionOrder(res.id, "shipped")).toBe(false)
    expect(await repo.transitionOrder(res.id, "completed")).toBe(true)
  })

  it("stamps confirmed_at on confirmation", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "confirmed")

    const [[o]] = await db.query("SELECT confirmed_at FROM orders WHERE id = ?", [res.id])
    expect(o.confirmed_at).not.toBeNull()
  })

  it("stamps shipped_at on shipping and leaves completed_at/cancelled_at null", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "confirmed")
    await repo.transitionOrder(res.id, "shipped")

    const [[o]] = await db.query(
      "SELECT shipped_at, completed_at, cancelled_at FROM orders WHERE id = ?", [res.id]
    )
    expect(o.shipped_at).not.toBeNull()
    expect(o.completed_at).toBeNull()
    expect(o.cancelled_at).toBeNull()
  })

  it("stamps completed_at on completion and leaves shipped_at/cancelled_at null", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    await repo.transitionOrder(res.id, "confirmed")
    await repo.transitionOrder(res.id, "completed")

    const [[o]] = await db.query(
      "SELECT shipped_at, completed_at, cancelled_at FROM orders WHERE id = ?", [res.id]
    )
    expect(o.completed_at).not.toBeNull()
    expect(o.shipped_at).toBeNull()
    expect(o.cancelled_at).toBeNull()
  })

  it("stamps cancelled_at on cancellation and leaves shipped_at/completed_at null", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))
    await repo.transitionOrder(res.id, "cancelled")

    const [[o]] = await db.query(
      "SELECT shipped_at, completed_at, cancelled_at FROM orders WHERE id = ?", [res.id]
    )
    expect(o.cancelled_at).not.toBeNull()
    expect(o.shipped_at).toBeNull()
    expect(o.completed_at).toBeNull()
  })

  it("leaves all three new timestamps null on a freshly created pending order", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId))

    const [[o]] = await db.query(
      "SELECT shipped_at, completed_at, cancelled_at FROM orders WHERE id = ?", [res.id]
    )
    expect(o.shipped_at).toBeNull()
    expect(o.completed_at).toBeNull()
    expect(o.cancelled_at).toBeNull()
  })

  it("refuses the transition when expectedFromStatus no longer matches", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await repo.transitionOrder(res.id, "confirmed")

    // confirmed -> cancelled is legal for an admin, but not for a caller that
    // decided to cancel because it saw 'pending'.
    expect(await repo.transitionOrder(res.id, "cancelled", { expectedFromStatus: "pending" }))
      .toBe(false)

    const [[o]] = await db.query("SELECT status, stock_released_at FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("confirmed")
    expect(o.stock_released_at).toBeNull()
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(3)
  })

  it("refuses the transition when the order is no longer expired", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    expect(await repo.transitionOrder(res.id, "cancelled", { expiredBefore: new Date() }))
      .toBe(false)

    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("pending")
  })
})

describe("releaseExpiredOrders", () => {
  it("cancels overdue prepaid orders and returns their stock", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    const count = await repo.releaseExpiredOrders(new Date())
    expect(count).toBe(1)

    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("cancelled")
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5)
  })

  it("records a cancel_reason explaining the auto-cancel, for the buyer's email", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    await repo.releaseExpiredOrders(new Date())

    const [[o]] = await db.query("SELECT cancel_reason FROM orders WHERE id = ?", [res.id])
    expect(o.cancel_reason).toMatch(/quá hạn chuyển khoản/)
  })

  it("never touches COD orders", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2, { payment_method: "cod" }))

    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("pending")
  })

  it("never touches confirmed orders even if overdue", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await repo.transitionOrder(res.id, "confirmed")
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
  })

  it("does not cancel an order that is confirmed while the sweep waits for its lock", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1000), res.id])

    // An admin's confirm holds the row lock, uncommitted.
    const admin = await db.getConnection()
    await admin.beginTransaction()
    await admin.query("SELECT id FROM orders WHERE id = ? FOR UPDATE", [res.id])
    await admin.query("UPDATE orders SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?",
      [res.id])

    // The sweep still sees 'pending' on its unlocked read, then blocks.
    const sweep = repo.releaseExpiredOrders(new Date())
    sweep.catch(() => {})
    await new Promise((r) => setTimeout(r, 400))

    await admin.commit()
    admin.release()

    expect(await sweep).toBe(0)

    const [[o]] = await db.query("SELECT status, stock_released_at FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("confirmed")
    expect(o.stock_released_at).toBeNull()
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(3) // the paid order's reservation survives
  }, 20000)

  it("leaves orders that have not yet expired alone", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId, 2))
    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
  })

  it("does not cancel an overdue order that already has a submitted payment proof", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))
    await db.query(
      "UPDATE orders SET expires_at = ?, payment_proof_url = ? WHERE id = ?",
      [new Date(Date.now() - 1000), "https://x/proof.jpg", res.id]
    )

    expect(await repo.releaseExpiredOrders(new Date())).toBe(0)
    const [[o]] = await db.query("SELECT status FROM orders WHERE id = ?", [res.id])
    expect(o.status).toBe("pending")
  })
})

describe("listOrders date filter", () => {
  it("includes an order created within the range and excludes one outside it", async () => {
    const { variantId } = await seedVariant(5)
    const inRange = await repo.createOrder(order(variantId, 1))
    const { variantId: v2 } = await seedVariant(5)
    const outOfRange = await repo.createOrder(order(v2, 1))

    // Push the second order's created_at outside the window we'll filter on.
    await db.query("UPDATE orders SET created_at = '2020-01-01 00:00:00' WHERE id = ?", [outOfRange.id])

    const rows = await repo.listOrders({ date_from: "2025-01-01", date_to: "2030-01-01" })
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(inRange.id)
    expect(ids).not.toContain(outOfRange.id)
  })

  it("treats date_to as inclusive of the whole day", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    const today = new Date().toISOString().slice(0, 10)

    const rows = await repo.listOrders({ date_to: today })
    expect(rows.map((r) => r.id)).toContain(res.id)
  })

  it("ignores a malformed date rather than throwing", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))

    const rows = await repo.listOrders({ date_from: "not-a-date", date_to: "also-not-a-date" })
    expect(rows.map((r) => r.id)).toContain(res.id)
  })
})

describe("listOrders collection filter", () => {
  it("matches an order whose items span multiple collections under EITHER collection's filter", async () => {
    const { cid: cidA, variantId: variantA } = await seedVariant(5)
    const { cid: cidB, variantId: variantB } = await seedVariant(5)
    const mixed = await repo.createOrder({
      items: [{ variant_id: variantA, qty: 1 }, { variant_id: variantB, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const rowsA = await repo.listOrders({ collection_id: cidA })
    const rowsB = await repo.listOrders({ collection_id: cidB })
    expect(rowsA.map((r) => r.id)).toContain(mixed.id)
    expect(rowsB.map((r) => r.id)).toContain(mixed.id)
  })

  it("excludes an order that touches neither collection", async () => {
    const { cid: cidA, variantId: variantA } = await seedVariant(5)
    const { cid: cidOther } = await seedVariant(5)
    const o = await repo.createOrder(order(variantA, 1))

    const rows = await repo.listOrders({ collection_id: cidOther })
    expect(rows.map((r) => r.id)).not.toContain(o.id)
  })
})

describe("listOrders fulfillment_method filter", () => {
  it("returns only booth-cash gacha orders when filtered to fulfillment_method 'booth'", async () => {
    const { variantId } = await seedVariant(5)
    const shipOrder = await repo.createOrder(order(variantId, 1))

    const cid = await catalog.createCollection({ title: "Gacha Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
    await prizeRepo.replacePrizes(pid, [{ name: "R", tier: "common", display_price: 999999, quantity_total: 10 }])
    const { orderId: boothOrderId } = await sessionRepo.startBoothSession({ productId: pid, buyerName: "Khách", turnsTotal: 1 })

    const rows = await repo.listOrders({ fulfillment_method: "booth" })
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(boothOrderId)
    expect(ids).not.toContain(shipOrder.id)
    expect(rows.every((r) => r.fulfillment_method === "booth")).toBe(true)
  })
})

describe("listOrders has_digital_item", () => {
  it("flags a mixed ship+digital order, whose fulfillment_method is still 'ship'", async () => {
    const { variantId: shipVariant } = await seedVariant(5)
    const { variantId: digitalVariant } = await seedDigitalVariant(5)
    const o = await repo.createOrder({
      items: [{ variant_id: shipVariant, qty: 1 }, { variant_id: digitalVariant, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const found = (await repo.listOrders({})).find((r) => r.id === o.id)
    expect(found.fulfillment_method).toBe("ship")
    expect(found.has_digital_item).toBe(true)
  })

  it("is false for a purely physical order", async () => {
    const { variantId } = await seedVariant(5)
    const o = await repo.createOrder(order(variantId, 1))

    const found = (await repo.listOrders({})).find((r) => r.id === o.id)
    expect(found.has_digital_item).toBe(false)
  })
})

describe("listOrders has_incomplete_gacha_session", () => {
  const confirmedGachaOrder = async (turns, prizeQuantity) => {
    const { variantId } = await seedGachaVariant(prizeQuantity)
    const o = await repo.createOrder(order(variantId, turns, { payment_method: "bank", fulfillment_method: "ship" }))
    await repo.transitionOrder(o.id, "confirmed")
    return o
  }

  it("flags a confirmed gacha order whose buyer has not drawn every turn yet", async () => {
    const o = await confirmedGachaOrder(2, 10)

    const found = (await repo.listOrders({})).find((r) => r.id === o.id)
    expect(found.has_incomplete_gacha_session).toBe(true)
  })

  it("stops flagging once the session's last turn is drawn", async () => {
    const o = await confirmedGachaOrder(2, 10)
    const session = await sessionRepo.getSessionByOrderId(o.id)
    await sessionRepo.drawForSession(session.id, { drawKey: "k1" })

    const partway = (await repo.listOrders({})).find((r) => r.id === o.id)
    expect(partway.has_incomplete_gacha_session).toBe(true)

    await sessionRepo.drawForSession(session.id, { drawKey: "k2" })

    const done = (await repo.listOrders({})).find((r) => r.id === o.id)
    expect(done.has_incomplete_gacha_session).toBe(false)
  })

  it("is false for a non-gacha order and for a gacha order still pending payment", async () => {
    const { variantId } = await seedVariant(5)
    const physical = await repo.createOrder(order(variantId, 1))
    const { variantId: gachaVariantId } = await seedGachaVariant(10)
    const unpaid = await repo.createOrder(order(gachaVariantId, 1, { payment_method: "bank", fulfillment_method: "ship" }))

    const rows = await repo.listOrders({})
    expect(rows.find((r) => r.id === physical.id).has_incomplete_gacha_session).toBe(false)
    expect(rows.find((r) => r.id === unpaid.id).has_incomplete_gacha_session).toBe(false)
  })
})

describe("listOrders search", () => {
  it("matches an exact numeric id, not just as a substring of something else", async () => {
    const { variantId: v1 } = await seedVariant(5)
    const match = await repo.createOrder(order(v1, 1))
    const { variantId: v2 } = await seedVariant(5)
    await repo.createOrder(order(v2, 1))

    const rows = await repo.listOrders({ search: String(match.id) })
    expect(rows.map((r) => r.id)).toEqual([match.id])
  })

  it("matches a phone/email/name substring case-insensitively when the term isn't numeric", async () => {
    const { variantId } = await seedVariant(5)
    const match = await repo.createOrder(order(variantId, 1, {
      buyer: { ...buyer, buyer_name: "Trần Thị B", phone: "0911222333", email: "tranthib@example.com" },
    }))
    const { variantId: v2 } = await seedVariant(5)
    await repo.createOrder(order(v2, 1, { buyer: { ...buyer, buyer_name: "Someone Else", phone: "0900000001", email: "other@example.com" } }))

    expect((await repo.listOrders({ search: "trần" })).map((r) => r.id)).toEqual([match.id])
    expect((await repo.listOrders({ search: "1222" })).map((r) => r.id)).toEqual([match.id])
    expect((await repo.listOrders({ search: "tranthib" })).map((r) => r.id)).toEqual([match.id])
  })

  it("returns nothing rather than every order when the term matches no one", async () => {
    const { variantId } = await seedVariant(5)
    await repo.createOrder(order(variantId, 1))

    expect(await repo.listOrders({ search: "nobody-has-this-name" })).toEqual([])
  })

  it("ignores a blank/whitespace-only search rather than matching nothing", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))

    const rows = await repo.listOrders({ search: "   " })
    expect(rows.map((r) => r.id)).toContain(res.id)
  })

  it("caps an excessively long search term instead of running it unbounded", async () => {
    const { variantId } = await seedVariant(5)
    const match = await repo.createOrder(order(variantId, 1, {
      buyer: { ...buyer, buyer_name: "A".repeat(100), phone: "0911222333", email: "long@example.com" },
    }))

    // A search term over the 100-char cap must still resolve (truncated, not
    // rejected) rather than erroring or scanning an unbounded LIKE pattern.
    const rows = await repo.listOrders({ search: "A".repeat(500) })
    expect(rows.map((r) => r.id)).toEqual([match.id])
  })
})

describe("getOrderByToken", () => {
  it("returns the order with its items", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 2))

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.total).toBe(70000)
    expect(found.items).toHaveLength(1)
    expect(found.items[0].variant_label_snapshot).toBe("A1")
  })

  it("returns null for an unknown token", async () => {
    expect(await repo.getOrderByToken("deadbeef".repeat(4))).toBeNull()
  })

  it("exposes the joined product_type per item, so the confirmation email knows a line is a gacha purchase", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].product_type).toBe("physical")
  })

  it("still reads correctly after its variant is deleted", async () => {
    const { pid, variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    await db.query("DELETE FROM product_variants WHERE id = ?", [variantId])

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].product_name_snapshot).toBe("Photocard")
    expect(found.items[0].unit_price_snapshot).toBe(35000)
    void pid
  })

  it("keeps the item photo after its variant is deleted - the live join degrades to null, but the snapshot taken at order time does not", async () => {
    const { pid, variantId } = await seedVariant(5)
    await catalog.replaceVariants(pid, [{ id: variantId, label: "A1", image_url: "/api/storage/shop/variants/a1.webp", stock_qty: 5 }])
    const res = await repo.createOrder(order(variantId, 1))
    await db.query("DELETE FROM product_variants WHERE id = ?", [variantId])

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].image_url).toBe("/api/storage/shop/variants/a1.webp")
  })

  it("includes the variant's own photo on each item", async () => {
    const { pid, variantId } = await seedVariant(5)
    await catalog.replaceVariants(pid, [{ id: variantId, label: "A1", image_url: "/api/storage/shop/variants/a1.webp", stock_qty: 5 }])
    const res = await repo.createOrder(order(variantId, 1))

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].image_url).toBe("/api/storage/shop/variants/a1.webp")
  })

  it("falls back to the product's photo when the variant has none of its own", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Photocard", price: 35000, images: ["/api/storage/shop/products/p1.webp"] })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])

    const res = await repo.createOrder(order(v.id, 1))
    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].image_url).toBe("/api/storage/shop/products/p1.webp")
  })
})

describe("createOrder - digital items", () => {
  it("rejects COD when the cart has any digital item", async () => {
    const { variantId } = await seedDigitalVariant(10)
    await expect(
      repo.createOrder(order(variantId, 1, { payment_method: "cod", fulfillment_method: "digital" }))
    ).rejects.toThrow(repo.NoCodForDigitalError)
  })

  it("rejects COD on a mixed cart (physical + digital)", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10)
    const { variantId: physicalId } = await seedVariant(5)
    await expect(
      repo.createOrder({
        items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
        buyer,
        fulfillment_method: "ship",
        payment_method: "cod",
      })
    ).rejects.toThrow(repo.NoCodForDigitalError)
  })

  it("forces fulfillment_method to 'digital' and skips address for an all-digital cart", async () => {
    const { variantId } = await seedDigitalVariant(10)
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer,
      payment_method: "bank",
    })

    const [[row]] = await db.query("SELECT fulfillment_method, address_raw FROM orders WHERE id = ?", [res.id])
    expect(row.fulfillment_method).toBe("digital")
    expect(row.address_raw).toBeNull()
  })

  it("still requires ship/pickup for a mixed cart", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10)
    const { variantId: physicalId } = await seedVariant(5)
    await expect(
      repo.createOrder({
        items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
        buyer,
        payment_method: "bank",
      })
    ).rejects.toThrow(repo.FulfillmentRequiredError)
  })

  it("snapshots delivery_link_snapshot on the digital line, null on physical lines", async () => {
    const { variantId: digitalId } = await seedDigitalVariant(10, "https://drive.google.com/y")
    const { variantId: physicalId } = await seedVariant(5)
    await repo.createOrder({
      items: [{ variant_id: digitalId, qty: 1 }, { variant_id: physicalId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const [rows] = await db.query(
      "SELECT product_variant_id, delivery_link_snapshot FROM order_items ORDER BY id ASC"
    )
    expect(rows.find((r) => r.product_variant_id === digitalId).delivery_link_snapshot).toBe("https://drive.google.com/y")
    expect(rows.find((r) => r.product_variant_id === physicalId).delivery_link_snapshot).toBeNull()
  })

  it("decrements a digital product's stock_qty like any other variant", async () => {
    const { variantId } = await seedDigitalVariant(3)
    await repo.createOrder({ items: [{ variant_id: variantId, qty: 2 }], buyer, payment_method: "bank" })

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(1)
  })
})

describe("createOrder: free gift", () => {
  it("adds no gift line when nothing is configured", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ?", [res.id])
    expect(items).toHaveLength(1)
    expect(Boolean(items[0].is_gift)).toBe(false)
  })

  it("adds no gift line when disabled, even if the total qualifies", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: false, minTotal: 1 })
    const res = await repo.createOrder(order(variantId, 1))
    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ?", [res.id])
    expect(items).toHaveLength(1)
  })

  it("adds no gift line when the total is below the threshold", async () => {
    const { variantId } = await seedVariant(5) // price 35000
    await seedGift({ enabled: true, minTotal: 100000 })
    const res = await repo.createOrder(order(variantId, 1))
    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ?", [res.id])
    expect(items).toHaveLength(1)
  })

  it("adds a physical gift line at 0đ when the total meets the threshold", async () => {
    const { variantId } = await seedVariant(5) // price 35000 * 3 = 105000
    await seedGift({ enabled: true, name: "Postcard", minTotal: 100000, imageUrl: "https://x/gift.png" })
    const res = await repo.createOrder(order(variantId, 3))

    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", [res.id])
    expect(items).toHaveLength(2)
    const gift = items[1]
    expect(Boolean(gift.is_gift)).toBe(true)
    expect(gift.product_variant_id).toBeNull()
    expect(gift.product_name_snapshot).toBe("Postcard")
    expect(gift.variant_label_snapshot).toBe("")
    expect(gift.unit_price_snapshot).toBe(0)
    expect(gift.qty).toBe(1)
    expect(gift.image_url_snapshot).toBe("https://x/gift.png")
    expect(gift.delivery_link_snapshot).toBeNull()
    expect(res.total).toBe(105000) // gift never adds to the charged total
  })

  it("normalizes is_gift to a real boolean on read (mysql2 returns TINYINT(1) as a JS number, not a boolean, with no typeCast configured)", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: true, name: "Postcard", minTotal: 100000, imageUrl: "https://x/gift.png" })
    const res = await repo.createOrder(order(variantId, 3))

    const fetched = await repo.getOrderById(res.id)
    const [paidItem, giftItem] = fetched.items

    expect(paidItem.is_gift).toBe(false)
    expect(giftItem.is_gift).toBe(true)
    expect(typeof paidItem.is_gift).toBe("boolean")
    expect(typeof giftItem.is_gift).toBe("boolean")
  })

  it("adds a digital gift line carrying its delivery_link snapshot", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: true, name: "Wallpaper", minTotal: 35000, deliveryLink: "https://drive.google.com/gift" })
    const res = await repo.createOrder(order(variantId, 1))

    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", [res.id])
    const gift = items[1]
    expect(Boolean(gift.is_gift)).toBe(true)
    expect(gift.delivery_link_snapshot).toBe("https://drive.google.com/gift")
  })

  it("adds exactly one gift unit regardless of how far over the threshold the order is", async () => {
    const { variantId } = await seedVariant(20)
    await seedGift({ enabled: true, minTotal: 10000 })
    const res = await repo.createOrder(order(variantId, 20)) // 700000, way over
    const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ? AND is_gift = 1", [res.id])
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(1)
  })

  it("does not touch stock for the gift - it has none to reserve", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: true, minTotal: 1 })
    await repo.createOrder(order(variantId, 1))
    // No error, and the paid variant's own stock is the only thing decremented.
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(4)
  })

  it("forces fulfillment_method to be required for an all-digital cart that qualifies for a physical gift", async () => {
    const { variantId } = await seedDigitalVariant(5)
    await seedGift({ enabled: true, minTotal: 1 }) // physical (no delivery_link)
    await expect(
      repo.createOrder({
        items: [{ variant_id: variantId, qty: 1 }],
        buyer,
        payment_method: "bank",
        // fulfillment_method omitted, as an all-digital cart would normally send
      })
    ).rejects.toThrow(repo.FulfillmentRequiredError)
  })

  it("does not require fulfillment_method for an all-digital cart when the qualifying gift is itself digital", async () => {
    const { variantId } = await seedDigitalVariant(5)
    await seedGift({ enabled: true, minTotal: 1, deliveryLink: "https://drive.google.com/gift" })
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer,
      payment_method: "bank",
    })
    expect(res.reused).toBe(false)
  })

  it("succeeds with a valid fulfillment_method for an all-digital cart forced physical by the gift", async () => {
    const { variantId } = await seedDigitalVariant(5)
    await seedGift({ enabled: true, minTotal: 1 })
    const res = await repo.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer,
      payment_method: "bank",
      fulfillment_method: "ship",
    })
    const [[savedOrder]] = await db.query("SELECT fulfillment_method, address_raw FROM orders WHERE id = ?", [res.id])
    expect(savedOrder.fulfillment_method).toBe("ship")
    expect(savedOrder.address_raw).toBe("1 Đường ABC, Q1, TP.HCM")
  })

  it("does not block COD for a paid all-physical cart just because the qualifying gift is digital", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: true, minTotal: 1, deliveryLink: "https://drive.google.com/gift" })
    const res = await repo.createOrder(order(variantId, 1, { payment_method: "cod" }))
    expect(res.reused).toBe(false)
  })

  it("still rejects COD for a cart with a paid digital item, gift notwithstanding", async () => {
    const { variantId } = await seedDigitalVariant(5)
    await seedGift({ enabled: true, minTotal: 1 })
    await expect(
      repo.createOrder({
        items: [{ variant_id: variantId, qty: 1 }],
        buyer, payment_method: "cod", fulfillment_method: "ship",
      })
    ).rejects.toThrow(repo.NoCodForDigitalError)
  })

  it("does not subject the gift to the paid items' collection's allow_ship/allow_pickup restriction", async () => {
    const { variantId } = await seedVariant(5, { allow_ship: false, allow_pickup: true })
    await seedGift({ enabled: true, minTotal: 1 })
    // Collection only allows pickup - ship must still be rejected for the
    // real paid item, proving the gift did not silently relax that check.
    await expect(
      repo.createOrder(order(variantId, 1, { fulfillment_method: "ship" }))
    ).rejects.toThrow(repo.FulfillmentNotOfferedError)
  })

  it("cancelling a gift-bearing order restocks only the paid variant, not the gift (which has none)", async () => {
    const { variantId } = await seedVariant(5)
    await seedGift({ enabled: true, minTotal: 1 })
    const res = await repo.createOrder(order(variantId, 2))

    const ok = await repo.transitionOrder(res.id, "cancelled")
    expect(ok).toBe(true)

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [variantId])
    expect(v.stock_qty).toBe(5) // fully restored - the gift row had no stock to touch
  })
})

describe("updateBuyerInfo", () => {
  it("updates changed fields and returns the diff-driven changed:true result", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: "Nguyễn Văn B", phone: "0911111111",
      note: "Giao giờ hành chính", address_raw: "2 Đường XYZ, Phường Bến Nghé, TP.HCM",
    })
    expect(result.changed).toBe(true)
    expect(result.order.buyer_name).toBe("Nguyễn Văn B")
    expect(result.order.phone).toBe("0911111111")
    expect(result.order.note).toBe("Giao giờ hành chính")
    expect(result.order.address_raw).toBe("2 Đường XYZ, Phường Bến Nghé, TP.HCM")
  })

  it("ignores an email field even if the caller sends one - email is never editable", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone, email: "attacker@example.com",
    })
    expect(result).toEqual({ changed: false })
    const [[row]] = await db.query("SELECT email FROM orders WHERE id = ?", [res.id])
    expect(row.email).toBe(buyer.email)
  })

  it("writes the full structured address (street/ward/district/province), not just address_raw", async () => {
    const res = await orderWithBuyer()
    await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone,
      address_raw: "2 Đường XYZ, Phường Bến Nghé, TP.HCM",
      address_street: "2 Đường XYZ", address_ward: "Phường Bến Nghé", address_district: null, address_province: "TP.HCM",
    })

    const [[row]] = await db.query("SELECT * FROM orders WHERE id = ?", [res.id])
    expect(row.address_raw).toBe("2 Đường XYZ, Phường Bến Nghé, TP.HCM")
    expect(row.address_street).toBe("2 Đường XYZ")
    expect(row.address_ward).toBe("Phường Bến Nghé")
    expect(row.address_province).toBe("TP.HCM")
  })

  it("reports the address change as a single composite diff entry even when only a structured sub-field (not address_raw) differs", async () => {
    const { variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1, {
      buyer: { ...buyer, address_ward: "Phường Cũ" },
    }))
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone, address_raw: buyer.address_raw,
      address_ward: "Phường Mới",
    })
    expect(result.changed).toBe(true)
    const [[row]] = await db.query("SELECT payload FROM email_queue WHERE order_id = ? AND type = 'order_updated'", [res.id])
    const payload = JSON.parse(row.payload)
    expect(payload.changes.filter((c) => c.field === "address_raw")).toHaveLength(1)
  })

  it("ignores an address_raw submitted for a pickup order - no ship address ever applies to it", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone, address_raw: "Địa chỉ không nên được lưu",
    })
    expect(result).toEqual({ changed: false })
    const [[row]] = await db.query("SELECT address_raw FROM orders WHERE id = ?", [res.id])
    expect(row.address_raw).toBeNull()
  })

  it("does not require an address for a pickup order", async () => {
    const { variantId } = await seedVariant(5, { allow_pickup: true })
    const res = await repo.createOrder(order(variantId, 1, { fulfillment_method: "pickup" }))
    const result = await repo.updateBuyerInfo(res.id, { buyer_name: "Đổi tên", phone: buyer.phone })
    expect(result.changed).toBe(true)
  })

  it("still requires an address for a ship order", async () => {
    const res = await orderWithBuyer()
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: buyer.buyer_name, phone: buyer.phone, address_raw: "" })
    ).rejects.toThrow(repo.InvalidBuyerInfoError)
  })

  it("does nothing and reports changed:false when the submitted values are identical to what's stored", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, {
      buyer_name: buyer.buyer_name, phone: buyer.phone,
      note: null, address_raw: buyer.address_raw,
    })
    expect(result).toEqual({ changed: false })

    const [rows] = await db.query("SELECT id FROM email_queue")
    expect(rows).toHaveLength(0)
  })

  it("enqueues an order_updated email to the order's own (unchanged) email address, carrying the diff as payload", async () => {
    const res = await orderWithBuyer()
    await repo.updateBuyerInfo(res.id, {
      buyer_name: "Nguyễn Văn B", phone: buyer.phone,
      note: null, address_raw: buyer.address_raw,
    })

    const [[row]] = await db.query("SELECT * FROM email_queue WHERE order_id = ? AND type = 'order_updated'", [res.id])
    expect(row).toBeTruthy()
    expect(row.to_email).toBe(buyer.email)
    const payload = JSON.parse(row.payload)
    expect(payload.changes.some((c) => c.field === "buyer_name" && c.old === buyer.buyer_name && c.new === "Nguyễn Văn B")).toBe(true)
    expect(payload.changes.some((c) => c.field === "phone")).toBe(false) // unchanged
    expect(payload.changes.some((c) => c.field === "email")).toBe(false) // email is never editable/diffed
  })

  it("defaults the notification's actor to 'admin' when the caller passes none", async () => {
    const res = await orderWithBuyer()
    await repo.updateBuyerInfo(res.id, { buyer_name: "Nguyễn Văn B", phone: buyer.phone })

    const [[row]] = await db.query("SELECT * FROM email_queue WHERE order_id = ? AND type = 'order_updated'", [res.id])
    expect(JSON.parse(row.payload).actor).toBe("admin")
  })

  it("carries the caller's actor ('buyer') through to the notification payload", async () => {
    const res = await orderWithBuyer()
    await repo.updateBuyerInfo(
      res.id,
      { buyer_name: "Nguyễn Văn B", phone: buyer.phone },
      { requirePending: true, actor: "buyer" }
    )

    const [[row]] = await db.query("SELECT * FROM email_queue WHERE order_id = ? AND type = 'order_updated'", [res.id])
    expect(JSON.parse(row.payload).actor).toBe("buyer")
  })

  it("rejects a blank buyer_name", async () => {
    const res = await orderWithBuyer()
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: "  ", phone: "09" })
    ).rejects.toThrow(repo.InvalidBuyerInfoError)
  })

  it("returns null for a non-existent order id", async () => {
    const result = await repo.updateBuyerInfo(999999, { buyer_name: "A", phone: "09" })
    expect(result).toBeNull()
  })

  it("allows the admin call (no requirePending) to edit a cancelled order", async () => {
    const res = await orderWithBuyer()
    await repo.transitionOrder(res.id, "cancelled")
    const result = await repo.updateBuyerInfo(res.id, { buyer_name: "Sửa sau khi hủy", phone: "09" })
    expect(result.changed).toBe(true)
  })

  it("rejects the buyer path (requirePending: true) once the order is no longer pending", async () => {
    const res = await orderWithBuyer()
    await repo.transitionOrder(res.id, "confirmed")
    await expect(
      repo.updateBuyerInfo(res.id, { buyer_name: "A", phone: "09" }, { requirePending: true })
    ).rejects.toThrow(repo.OrderNotEditableError)

    // The double-rollback bug fix: rejecting via requirePending must still
    // leave the transaction in a clean, single-rollback state - not throw
    // a second error from an already-closed transaction.
    const [[row]] = await db.query("SELECT buyer_name FROM orders WHERE id = ?", [res.id])
    expect(row.buyer_name).toBe(buyer.buyer_name)
  })

  it("allows the buyer path while the order is still pending", async () => {
    const res = await orderWithBuyer()
    const result = await repo.updateBuyerInfo(res.id, { buyer_name: "Sửa bởi khách", phone: "09" }, { requirePending: true })
    expect(result.changed).toBe(true)
  })
})

describe("createOrder - gacha", () => {
  it("rejects COD for a gacha cart", async () => {
    const { variantId } = await seedGachaVariant(10)
    await expect(repo.createOrder(order(variantId, 2, { payment_method: "cod" }))).rejects.toThrow(repo.NoCodForGachaError)
  })

  it("rejects mixing a gacha item with a non-gacha item in the same cart", async () => {
    const { variantId: gachaVariantId } = await seedGachaVariant(10)
    const { variantId: physicalVariantId } = await seedVariant(10)
    const mixed = {
      items: [{ variant_id: gachaVariantId, qty: 1 }, { variant_id: physicalVariantId, qty: 1 }],
      buyer, payment_method: "bank", fulfillment_method: "ship",
    }
    await expect(repo.createOrder(mixed)).rejects.toThrow(repo.MixedGachaCartError)
  })

  // The enforcement point is now `rows.length > 1`, not a gacha-vs-gacha
  // product-id comparison: ANY second line item in a gacha cart is rejected,
  // which makes the "same gacha product, two variants" case structurally
  // impossible to reach (and impossible to construct via the catalog, which
  // only ever gives a gacha product one hidden variant).
  it("rejects a cart holding two gacha line items", async () => {
    const { variantId: firstGachaVariantId } = await seedGachaVariant(10)
    const { variantId: secondGachaVariantId } = await seedGachaVariant(10)
    const twoGacha = {
      items: [{ variant_id: firstGachaVariantId, qty: 1 }, { variant_id: secondGachaVariantId, qty: 1 }],
      buyer, payment_method: "bank", fulfillment_method: "ship",
    }
    await expect(repo.createOrder(twoGacha)).rejects.toThrow(repo.MixedGachaCartError)
  })

  it("rejects buying more turns than the prize pool has remaining", async () => {
    const { variantId } = await seedGachaVariant(2)
    await expect(repo.createOrder(order(variantId, 3, { payment_method: "bank", fulfillment_method: "ship" })))
      .rejects.toThrow(repo.GachaPoolSoldOutError)
  })

  it("creates a normal ship-fulfilled order for a valid gacha cart", async () => {
    const { variantId } = await seedGachaVariant(10)
    const result = await repo.createOrder(order(variantId, 3, { payment_method: "bank", fulfillment_method: "ship" }))
    expect(result.total).toBe(60000)
  })
})

describe("transitionOrder - gacha", () => {
  it("creates a gacha session once the order is confirmed", async () => {
    const { variantId } = await seedGachaVariant(10)
    const result = await repo.createOrder(order(variantId, 2, { payment_method: "bank", fulfillment_method: "ship" }))
    await repo.transitionOrder(result.id, "confirmed")

    const session = await sessionRepo.getSessionByOrderId(result.id)
    expect(session).not.toBeNull()
    expect(session.turns_total).toBe(2)
    expect(session.source).toBe("online")
  })

  it("still confirms and queues the buyer email when session creation throws", async () => {
    const { variantId } = await seedVariant(5)
    const result = await repo.createOrder(order(variantId, 1))

    const spy = vi.spyOn(sessionRepo, "startOnlineSessionIfNeeded").mockRejectedValue(new Error("boom"))
    try {
      await expect(repo.transitionOrder(result.id, "confirmed")).resolves.toBe(true)
    } finally {
      spy.mockRestore()
    }

    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [result.id])
    expect(row.status).toBe("confirmed")
    const [queued] = await db.query("SELECT type FROM email_queue WHERE order_id = ?", [result.id])
    expect(queued.map((r) => r.type)).toContain("payment_confirmed")
  })
})
