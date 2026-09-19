import { describe, it, expect, beforeEach, vi } from "vitest"
import nodemailer from "nodemailer"
import db from "../db.js"
import stockNotify from "../shop/stockNotify.js"
import catalog from "../shop/catalogRepo.js"
import { resetTables } from "./helpers/db.js"

// See tests/sender.test.js for why this must mutate the real nodemailer
// module object rather than vi.mock("nodemailer", ...) (a bare vi.mock does
// not intercept sender.js's own separate CJS require - it hangs ~20s on a
// real SMTP connection attempt instead).
let sendMailMock
nodemailer.createTransport = () => ({
  sendMail: (...args) => sendMailMock(...args),
})

async function seedVariant(stockQty) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_ship: true })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Postcard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: stockQty }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  return v.id
}

async function pendingRequest(variantId, email) {
  const [[row]] = await db.query(
    "SELECT * FROM stock_notify_requests WHERE product_variant_id = ? AND email = ?",
    [variantId, email]
  )
  return row
}

beforeEach(async () => {
  await resetTables("stock_notify_requests", "product_variants", "products", "collections")

  process.env.SMTP_HOST = "smtp.example.com"
  process.env.SMTP_USER = "user@example.com"
  process.env.SMTP_PASS = "secret"

  sendMailMock = vi.fn().mockResolvedValue({})
})

describe("requestNotify", () => {
  it("rejects an invalid email", async () => {
    const variantId = await seedVariant(0)
    await expect(stockNotify.requestNotify(variantId, "not-an-email")).rejects.toThrow("invalid_email")
  })

  it("rejects a non-existent variant", async () => {
    await expect(stockNotify.requestNotify(999999, "a@example.com")).rejects.toThrow(stockNotify.VariantNotFoundError)
  })

  it("rejects a variant with positive stock", async () => {
    const variantId = await seedVariant(5)
    await expect(stockNotify.requestNotify(variantId, "a@example.com")).rejects.toThrow(stockNotify.NotSoldOutError)
  })

  it("rejects an unlimited-stock variant", async () => {
    const variantId = await seedVariant(null)
    await expect(stockNotify.requestNotify(variantId, "a@example.com")).rejects.toThrow(stockNotify.NotSoldOutError)
  })

  it("stores a request for a sold-out variant, lowercased and trimmed", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "  A@Example.com  ")
    const row = await pendingRequest(variantId, "a@example.com")
    expect(row).toBeTruthy()
    expect(row.notified_at).toBeNull()
  })

  it("is a no-op (not a second row) on a repeat sign-up while still pending", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await stockNotify.requestNotify(variantId, "a@example.com")
    const [rows] = await db.query(
      "SELECT id FROM stock_notify_requests WHERE product_variant_id = ? AND email = ?",
      [variantId, "a@example.com"]
    )
    expect(rows).toHaveLength(1)
  })

  it("re-arms a request that was already notified", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await db.query(
      "UPDATE stock_notify_requests SET notified_at = NOW() WHERE product_variant_id = ? AND email = ?",
      [variantId, "a@example.com"]
    )
    await stockNotify.requestNotify(variantId, "a@example.com")
    const row = await pendingRequest(variantId, "a@example.com")
    expect(row.notified_at).toBeNull()
  })
})

describe("sendPendingNotifications", () => {
  it("sends nothing when SMTP isn't configured", async () => {
    delete process.env.SMTP_HOST
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await db.query("UPDATE product_variants SET stock_qty = 5 WHERE id = ?", [variantId])

    const res = await stockNotify.sendPendingNotifications()
    expect(res.sent).toBe(0)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it("skips a request whose variant is still sold out", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")

    const res = await stockNotify.sendPendingNotifications()
    expect(res.sent).toBe(0)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it("sends and marks notified_at once the variant restocks", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await db.query("UPDATE product_variants SET stock_qty = 5 WHERE id = ?", [variantId])

    const res = await stockNotify.sendPendingNotifications()
    expect(res.sent).toBe(1)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0].to).toBe("a@example.com")

    const row = await pendingRequest(variantId, "a@example.com")
    expect(row.notified_at).toBeTruthy()
  })

  it("also sends when the variant is flipped to unlimited stock", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await db.query("UPDATE product_variants SET stock_qty = NULL WHERE id = ?", [variantId])

    const res = await stockNotify.sendPendingNotifications()
    expect(res.sent).toBe(1)
  })

  it("does not send twice for the same request", async () => {
    const variantId = await seedVariant(0)
    await stockNotify.requestNotify(variantId, "a@example.com")
    await db.query("UPDATE product_variants SET stock_qty = 5 WHERE id = ?", [variantId])

    await stockNotify.sendPendingNotifications()
    const res = await stockNotify.sendPendingNotifications()
    expect(res.sent).toBe(0)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it("continues past one send failure to process the rest of the batch", async () => {
    const v1 = await seedVariant(0)
    const v2 = await seedVariant(0)
    await stockNotify.requestNotify(v1, "a@example.com")
    await stockNotify.requestNotify(v2, "b@example.com")
    await db.query("UPDATE product_variants SET stock_qty = 5 WHERE id IN (?, ?)", [v1, v2])

    sendMailMock
      .mockRejectedValueOnce(new Error("smtp rejected"))
      .mockResolvedValueOnce({})

    const res = await stockNotify.sendPendingNotifications()
    expect(sendMailMock).toHaveBeenCalledTimes(2)
    expect(res.sent).toBe(1)

    const failedRow = await pendingRequest(v1, "a@example.com")
    const sentRow = await pendingRequest(v2, "b@example.com")
    expect(failedRow.notified_at).toBeNull()
    expect(sentRow.notified_at).toBeTruthy()
  })
})
