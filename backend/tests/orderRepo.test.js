import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/orders/orderRepo.js"
import catalog from "../shop/catalogRepo.js"
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
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return { cid, pid, variantId: v.id }
}

const order = (variantId, qty = 1, over = {}) => ({
  items: [{ variant_id: variantId, qty }],
  buyer,
  fulfillment_method: "ship",
  payment_method: "bank",
  ...over,
})

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
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

  it("still reads correctly after its variant is deleted", async () => {
    const { pid, variantId } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    await db.query("DELETE FROM product_variants WHERE id = ?", [variantId])

    const found = await repo.getOrderByToken(res.order_token)
    expect(found.items[0].product_name_snapshot).toBe("Photocard")
    expect(found.items[0].unit_price_snapshot).toBe(35000)
    void pid
  })
})
