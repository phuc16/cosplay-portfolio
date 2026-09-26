import { describe, it, expect, beforeEach, vi } from "vitest"
import nodemailer from "nodemailer"
import db from "../db.js"
import stockAlertQueue from "../shop/stockAlerts/queue.js"
import stockAlertSender from "../shop/stockAlerts/sender.js"
import { resetTables } from "./helpers/db.js"

// See tests/sender.test.js's header comment: mutating the real
// nodemailer.createTransport here, before this module is imported anywhere
// else, is what lets stockAlerts/sender.js's reuse of email/sender.js's
// memoized transport singleton pick up the mock instead of a real SMTP
// connection. Do not switch this to vi.mock("nodemailer", ...).
let sendMailMock
nodemailer.createTransport = () => ({
  sendMail: (...args) => sendMailMock(...args),
})

beforeEach(async () => {
  await resetTables("stock_alert_queue")
  process.env.SMTP_HOST = "smtp.example.com"
  process.env.SMTP_USER = "user@example.com"
  process.env.SMTP_PASS = "secret"
  sendMailMock = vi.fn().mockResolvedValue({})
})

function row(over = {}) {
  return {
    product_variant_id: 1, email: "a@example.com",
    product_name_snapshot: "Card", variant_label_snapshot: "A1",
    collection_slug_snapshot: "drop", ...over,
  }
}

describe("sendQueuedStockAlerts", () => {
  it("no-ops when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST
    await stockAlertQueue.enqueueMany(db, [row()])
    const result = await stockAlertSender.sendQueuedStockAlerts()
    expect(result).toEqual({ sent: 0, failed: 0, skipped: true })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it("sends a queued alert and marks it sent", async () => {
    await stockAlertQueue.enqueueMany(db, [row()])
    const result = await stockAlertSender.sendQueuedStockAlerts()
    expect(result).toEqual({ sent: 1, failed: 0, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const call = sendMailMock.mock.calls[0][0]
    expect(call.to).toBe("a@example.com")
    expect(call.subject).toContain("Card")
    expect(call.html).toContain("A1")
    expect(call.html).toContain("/merchandise/drop")
    const [[after]] = await db.query("SELECT status FROM stock_alert_queue LIMIT 1")
    expect(after.status).toBe("sent")
  })

  it("isolates a failing row from the rest of the batch", async () => {
    await stockAlertQueue.enqueueMany(db, [row({ email: "bad@example.com" }), row({ email: "good@example.com" })])
    sendMailMock.mockRejectedValueOnce(new Error("bad address")).mockResolvedValue({})

    const result = await stockAlertSender.sendQueuedStockAlerts()

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false })
  })

  it("stops retrying a row once it exhausts MAX_ATTEMPTS", async () => {
    await stockAlertQueue.enqueueMany(db, [row()])
    sendMailMock.mockRejectedValue(new Error("smtp down"))

    for (let i = 0; i < stockAlertQueue.MAX_ATTEMPTS; i += 1) {
      const result = await stockAlertSender.sendQueuedStockAlerts()
      expect(result).toEqual({ sent: 0, failed: 1, skipped: false })
    }

    const again = await stockAlertSender.sendQueuedStockAlerts()
    expect(again).toEqual({ sent: 0, failed: 0, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(stockAlertQueue.MAX_ATTEMPTS)
  })

  it("omits garbage text when collection_slug_snapshot is null (deleted collection)", async () => {
    await stockAlertQueue.enqueueMany(db, [row({ collection_slug_snapshot: null })])
    await stockAlertSender.sendQueuedStockAlerts()
    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).not.toContain("undefined")
    expect(call.html).not.toContain(">null<")
  })
})
