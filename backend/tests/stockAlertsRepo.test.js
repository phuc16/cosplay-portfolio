import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import repo from "../shop/stockAlerts/repo.js"
import { resetTables } from "./helpers/db.js"

async function seedVariant(stock_qty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return v.id
}

beforeEach(async () => {
  await resetTables("stock_alerts", "stock_alert_queue", "product_variants", "products", "collections")
})

describe("signUp", () => {
  it("rejects a malformed email", async () => {
    const variantId = await seedVariant(0)
    await expect(repo.signUp({ variant_id: variantId, email: "not-an-email" }))
      .rejects.toThrow(repo.InvalidEmailError)
  })

  it("rejects a variant that does not exist", async () => {
    await expect(repo.signUp({ variant_id: 999999, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotFoundError)
  })

  it("rejects a variant that still has stock", async () => {
    const variantId = await seedVariant(5)
    await expect(repo.signUp({ variant_id: variantId, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotSoldOutError)
  })

  it("rejects an unlimited (stock_qty null) variant - it can never be sold out", async () => {
    const variantId = await seedVariant(null)
    await expect(repo.signUp({ variant_id: variantId, email: "a@example.com" }))
      .rejects.toThrow(repo.VariantNotSoldOutError)
  })

  it("stores a subscription for a sold-out variant", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [rows] = await db.query("SELECT * FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe("a@example.com")
    expect(rows[0].notified_at).toBeNull()
  })

  it("upserts on a repeat signup instead of duplicating the row", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [rows] = await db.query("SELECT * FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(rows).toHaveLength(1)
  })

  it("resets notified_at back to NULL on a resubscribe", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })
    await db.query("UPDATE stock_alerts SET notified_at = UTC_TIMESTAMP() WHERE product_variant_id = ?", [variantId])

    await repo.signUp({ variant_id: variantId, email: "a@example.com" })

    const [[row]] = await db.query("SELECT notified_at FROM stock_alerts WHERE product_variant_id = ?", [variantId])
    expect(row.notified_at).toBeNull()
  })
})

describe("listUnnotified / markNotified", () => {
  it("returns only unnotified subscribers, and markNotified sets notified_at", async () => {
    const variantId = await seedVariant(0)
    await repo.signUp({ variant_id: variantId, email: "a@example.com" })
    await repo.signUp({ variant_id: variantId, email: "b@example.com" })

    const conn = await db.getConnection()
    try {
      const subs = await repo.listUnnotified(conn, variantId)
      expect(subs).toHaveLength(2)
      await repo.markNotified(conn, subs.map((s) => s.id))
    } finally {
      conn.release()
    }

    const remaining = await (async () => {
      const conn2 = await db.getConnection()
      try { return repo.listUnnotified(conn2, variantId) } finally { conn2.release() }
    })()
    expect(remaining).toHaveLength(0)
  })
})
