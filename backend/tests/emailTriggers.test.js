import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import redis from "../redis.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

const body = (v) => ({
  items: [{ variant_id: v, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "buyer@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

const queued = async () => {
  const [rows] = await db.query("SELECT type, to_email FROM email_queue ORDER BY id ASC")
  return rows
}

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  // The order-creation limiter (10/hour/IP) shares one Redis key across every
  // test in this file since supertest requests all appear to come from the
  // same loopback address.
  const keys = await redis.keys("rl:order:*")
  if (keys.length) await redis.del(...keys)
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("order placed", () => {
  it("queues an email to the buyer", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))

    const rows = await queued()
    expect(rows.some((r) => r.type === "order_placed" && r.to_email === "buyer@example.com")).toBe(true)
  })

  it("queues a copy to the admin when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))

    expect((await queued()).some((r) => r.to_email === "seller@example.com")).toBe(true)
    delete process.env.ADMIN_EMAIL
  })

  it("still creates the order if enqueueing fails", async () => {
    const v = await seedVariant()
    // Renamed rather than dropped-and-restored-via-full-migration-rollback:
    // a full `migrate.rollback(null, true)` unwinds every migration in the
    // batch in ascending (not reverse) order, so any later migration that
    // touches email_queue a second time (e.g. adding a column) has its own
    // rollback fail against an already-dropped table. Renaming sidesteps
    // migration state entirely - enqueue's INSERT still fails the same way
    // (unknown table), and undoing it is just renaming back.
    await db.query("RENAME TABLE email_queue TO email_queue_disabled_for_test")
    try {
      const res = await request(app).post("/api/orders").send(body(v))
      expect(res.status).toBe(201)
    } finally {
      await db.query("RENAME TABLE email_queue_disabled_for_test TO email_queue")
    }
  })
})

describe("lifecycle transitions", () => {
  it("queues payment_confirmed on confirm", async () => {
    const v = await seedVariant()
    const created = await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    expect((await queued()).some((r) => r.type === "payment_confirmed")).toBe(true)
    void created
  })

  it("copies payment_confirmed to the admin when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    try {
      const v = await seedVariant()
      await request(app).post("/api/orders").send(body(v))
      const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
      await db.query("DELETE FROM email_queue") // drop the order_placed copies

      await orders.transitionOrder(o.id, "confirmed")

      const rows = await queued()
      expect(rows.some((r) => r.type === "payment_confirmed" && r.to_email === "buyer@example.com")).toBe(true)
      expect(rows.some((r) => r.type === "payment_confirmed" && r.to_email === "seller@example.com")).toBe(true)
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })

  it("does not copy shipped to the admin, even when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    try {
      const v = await seedVariant()
      await request(app).post("/api/orders").send(body(v))
      const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

      await orders.transitionOrder(o.id, "confirmed")
      await db.query("DELETE FROM email_queue")
      await orders.transitionOrder(o.id, "shipped", { tracking_code: "VTP1" })

      const rows = await queued()
      expect(rows.some((r) => r.type === "shipped" && r.to_email === "buyer@example.com")).toBe(true)
      expect(rows.some((r) => r.to_email === "seller@example.com")).toBe(false)
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })

  it("does not copy cancelled to the admin, even when ADMIN_EMAIL is set", async () => {
    process.env.ADMIN_EMAIL = "seller@example.com"
    try {
      const v = await seedVariant()
      await request(app).post("/api/orders").send(body(v))
      const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
      await db.query("DELETE FROM email_queue")

      await orders.transitionOrder(o.id, "cancelled")

      const rows = await queued()
      expect(rows.some((r) => r.type === "cancelled" && r.to_email === "buyer@example.com")).toBe(true)
      expect(rows.some((r) => r.to_email === "seller@example.com")).toBe(false)
    } finally {
      delete process.env.ADMIN_EMAIL
    }
  })

  it("queues shipped with the order", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped", { tracking_code: "VTP1" })
    expect((await queued()).some((r) => r.type === "shipped")).toBe(true)
  })

  it("queues cancelled", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "cancelled")
    expect((await queued()).some((r) => r.type === "cancelled")).toBe(true)
  })

  it("queues nothing for completed, which needs no buyer email", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")

    await orders.transitionOrder(o.id, "confirmed")
    await db.query("DELETE FROM email_queue")
    await orders.transitionOrder(o.id, "completed")

    expect(await queued()).toHaveLength(0)
  })

  it("queues nothing when a transition is refused", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
    await db.query("DELETE FROM email_queue")

    await orders.transitionOrder(o.id, "shipped") // illegal from pending
    expect(await queued()).toHaveLength(0)
  })

  it("sends no duplicate when the sweep cancels an order", async () => {
    const v = await seedVariant()
    await request(app).post("/api/orders").send(body(v))
    const [[o]] = await db.query("SELECT id FROM orders LIMIT 1")
    await db.query("UPDATE orders SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000), o.id])
    await db.query("DELETE FROM email_queue")

    await orders.releaseExpiredOrders(new Date())
    await orders.releaseExpiredOrders(new Date())

    expect((await queued()).filter((r) => r.type === "cancelled")).toHaveLength(1)
  })
})
