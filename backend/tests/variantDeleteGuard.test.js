import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }, { label: "A2", stock_qty: 5 }])
  const [rows] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
  return { pid, a1: rows[0], a2: rows[1] }
}

const place = (variantId) => orders.createOrder({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("variant deletion guard", () => {
  it("refuses to delete a variant with a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)

    const [rows] = await db.query("SELECT id FROM product_variants")
    expect(rows).toHaveLength(2) // nothing removed
  })

  it("allows deletion once the order is cancelled", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "cancelled")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("allows deletion once the order is completed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("still allows editing a variant that has a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await catalog.replaceVariants(pid, [
      { id: a1.id, label: "A1", stock_qty: 99 },
      { id: a2.id, label: "A2", stock_qty: 5 },
    ])
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [a1.id])
    expect(v.stock_qty).toBe(99)
  })

  it("blocks a confirmed order too, since its stock is still committed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)
  })
})
