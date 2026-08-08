import { describe, it, expect, beforeEach, vi } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import catalog from "../shop/catalogRepo.js"
import cache from "../shop/catalogCache.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stock = 5) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stock }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (v) => ({
  items: [{ variant_id: v, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "buyer@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

const stockInCache = async (slug = "drop") => {
  const detail = await cache.getCollection(slug)
  return detail.products[0].variants[0].stock_qty
}

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await cache.invalidate()
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("storefront cache invalidation on stock changes", () => {
  it("shows fresh stock after an order decrements it, instead of the stale cached value", async () => {
    const v = await seedVariant(5)
    expect(await stockInCache()).toBe(5) // warms the cache with pre-order stock

    await request(app).post("/api/orders").send(body(v))

    expect(await stockInCache()).toBe(4)
  })

  it("shows restored stock after a cancel releases it back", async () => {
    const v = await seedVariant(5)
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    expect(await stockInCache()).toBe(4) // warm the cache post-order

    await orders.transitionOrder(o.id, "cancelled")

    expect(await stockInCache()).toBe(5)
  })

  it("shows restored stock after the expiry sweep releases it back", async () => {
    const v = await seedVariant(5)
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])

    expect(await stockInCache()).toBe(4)

    await orders.releaseExpiredOrders(new Date())

    expect(await stockInCache()).toBe(5)
  })

  it("does not invalidate the cache when an order is only replayed (no new stock decrement)", async () => {
    const v = await seedVariant(5)
    await request(app).post("/api/orders").send({ ...body(v), request_key: "same-key" })
    expect(await stockInCache()).toBe(4)

    const spy = vi.spyOn(cache, "invalidate")
    await request(app).post("/api/orders").send({ ...body(v), request_key: "same-key" })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("still commits the order even if the cache invalidation fails (best-effort, not transactional)", async () => {
    const v = await seedVariant(5)
    const spy = vi.spyOn(cache, "invalidate").mockRejectedValueOnce(new Error("redis down"))

    const res = await request(app).post("/api/orders").send(body(v))
    expect(res.status).toBe(201)

    const [[row]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [v])
    expect(row.stock_qty).toBe(4) // the DB write committed despite the cache failure

    spy.mockRestore()
  })

  it("still commits a cancel even if the cache invalidation fails (best-effort, not transactional)", async () => {
    const v = await seedVariant(5)
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    const spy = vi.spyOn(cache, "invalidate").mockRejectedValueOnce(new Error("redis down"))
    const ok = await orders.transitionOrder(o.id, "cancelled")
    expect(ok).toBe(true)

    const [[row]] = await db.query("SELECT status, stock_released_at FROM orders WHERE id = ?", [o.id])
    expect(row.status).toBe("cancelled")
    expect(row.stock_released_at).not.toBeNull()

    spy.mockRestore()
  })

  it("does not invalidate the cache on a transition that releases no stock", async () => {
    const v = await seedVariant(5)
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    const spy = vi.spyOn(cache, "invalidate")
    await orders.transitionOrder(o.id, "confirmed")
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
