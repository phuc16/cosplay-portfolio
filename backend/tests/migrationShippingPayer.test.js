import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("orders.shipping_payer", () => {
  it("defaults to 'buyer' on a freshly created order", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])

    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [o.id])
    expect(row.shipping_payer).toBe("buyer")
  })

  it("can be updated to 'seller'", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await db.query("UPDATE orders SET shipping_payer = 'seller' WHERE id = ?", [o.id])
    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [o.id])
    expect(row.shipping_payer).toBe("seller")
  })

  it("rejects a value outside the enum", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await expect(
      db.query("UPDATE orders SET shipping_payer = 'nobody' WHERE id = ?", [o.id])
    ).rejects.toThrow()
  })
})
