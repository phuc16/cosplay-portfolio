import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { sweepExpiredOrders } from "../worker.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedOrder(paymentMethod = "bank") {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 2 }],
    buyer, fulfillment_method: "ship", payment_method: paymentMethod,
  })
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("sweepExpiredOrders", () => {
  it("cancels an overdue prepaid order and returns its stock", async () => {
    const o = await seedOrder()
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])

    expect(await sweepExpiredOrders()).toBe(1)

    const [[row]] = await db.query("SELECT status FROM orders WHERE id = ?", [o.id])
    expect(row.status).toBe("cancelled")
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5)
  })

  it("never expires a COD order", async () => {
    await seedOrder("cod")
    expect(await sweepExpiredOrders()).toBe(0)
  })

  it("is safe to run repeatedly", async () => {
    const o = await seedOrder()
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])

    await sweepExpiredOrders()
    await sweepExpiredOrders()
    await sweepExpiredOrders()

    const [[v]] = await db.query("SELECT stock_qty FROM product_variants LIMIT 1")
    expect(v.stock_qty).toBe(5) // credited once, not three times
  })

  it("does nothing when there is nothing due", async () => {
    await seedOrder()
    expect(await sweepExpiredOrders()).toBe(0)
  })
})
