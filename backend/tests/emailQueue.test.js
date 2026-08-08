import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import queue from "../shop/email/queue.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method: "ship", payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("enqueue", () => {
  it("queues a pending message", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    const [[row]] = await db.query("SELECT * FROM email_queue LIMIT 1")
    expect(row.status).toBe("pending")
    expect(row.attempts).toBe(0)
  })
})

describe("claimPending", () => {
  it("returns pending messages", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })

  it("ignores sent messages", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")
    await queue.markSent(row.id)
    expect(await queue.claimPending(10)).toHaveLength(0)
  })

  it("stops retrying after MAX_ATTEMPTS", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(row.id, "smtp down")

    expect(await queue.claimPending(10)).toHaveLength(0)
    const [[after]] = await db.query("SELECT status, attempts, last_error FROM email_queue WHERE id = ?", [row.id])
    expect(after.status).toBe("failed")
    expect(after.attempts).toBe(queue.MAX_ATTEMPTS)
    expect(after.last_error).toContain("smtp")
  })

  it("keeps retrying below the limit", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    await queue.markFailed(row.id, "temporary")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })
})

describe("failure isolation", () => {
  it("a queued email never affects the order it belongs to", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")
    await queue.markFailed(row.id, "boom")

    const [[order]] = await db.query("SELECT status FROM orders WHERE id = ?", [o.id])
    expect(order.status).toBe("pending") // order untouched by mail failure
  })

  it("deleting an order clears its queued mail", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    await db.query("DELETE FROM orders WHERE id = ?", [o.id])

    const [rows] = await db.query("SELECT id FROM email_queue")
    expect(rows).toHaveLength(0)
  })
})
