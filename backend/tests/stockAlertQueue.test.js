import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import queue from "../shop/stockAlerts/queue.js"
import { resetTables } from "./helpers/db.js"

beforeEach(async () => {
  await resetTables("stock_alert_queue")
})

function row(over = {}) {
  return {
    product_variant_id: 1, email: "a@example.com",
    product_name_snapshot: "Card", variant_label_snapshot: "A1",
    collection_slug_snapshot: "drop", ...over,
  }
}

describe("enqueueMany", () => {
  it("inserts one pending row per subscriber", async () => {
    await queue.enqueueMany(db, [row({ email: "a@example.com" }), row({ email: "b@example.com" })])
    const [rows] = await db.query("SELECT * FROM stock_alert_queue ORDER BY id")
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe("pending")
    expect(rows[1].email).toBe("b@example.com")
  })

  it("does nothing for an empty list", async () => {
    await queue.enqueueMany(db, [])
    const [rows] = await db.query("SELECT * FROM stock_alert_queue")
    expect(rows).toHaveLength(0)
  })
})

describe("claimPending / markSent / markFailed", () => {
  it("returns pending rows and ignores sent ones", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    expect(await queue.claimPending(10)).toHaveLength(1)
    await queue.markSent(r.id)
    expect(await queue.claimPending(10)).toHaveLength(0)
  })

  it("stops retrying after MAX_ATTEMPTS", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(r.id, "smtp down")
    expect(await queue.claimPending(10)).toHaveLength(0)
    const [[after]] = await db.query("SELECT status, attempts FROM stock_alert_queue WHERE id = ?", [r.id])
    expect(after.status).toBe("failed")
    expect(after.attempts).toBe(queue.MAX_ATTEMPTS)
  })

  it("keeps retrying below the cap", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    await queue.markFailed(r.id, "temporary")
    expect(await queue.claimPending(10)).toHaveLength(1)
  })
})

describe("listFailed", () => {
  it("returns only failed rows", async () => {
    await queue.enqueueMany(db, [row()])
    const [[r]] = await db.query("SELECT id FROM stock_alert_queue LIMIT 1")
    for (let i = 0; i < queue.MAX_ATTEMPTS; i += 1) await queue.markFailed(r.id, "boom")
    const failed = await queue.listFailed()
    expect(failed).toHaveLength(1)
    expect(failed[0].last_error).toBe("boom")
  })
})
