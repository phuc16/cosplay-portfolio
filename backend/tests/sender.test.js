import { describe, it, expect, beforeEach, vi } from "vitest"
import nodemailer from "nodemailer"
import db from "../db.js"
import sender from "../shop/email/sender.js"
import queue from "../shop/email/queue.js"
import templates from "../shop/email/templates.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

// --- nodemailer mocking gotcha ---------------------------------------------
// sender.js does `const nodemailer = require("nodemailer")` (CommonJS) and
// lazily memoizes a real `nodemailer.createTransport(...)` transport on first
// send. A bare `vi.mock("nodemailer", factory)` from this ESM test file does
// NOT intercept that require — it was tried once and produced a genuine ~20s
// SMTP connection timeout, because vi.mock only patches the module graph
// vitest resolves for *this* file, not the separate CJS require cache entry
// sender.js reads from.
//
// The fix: `import nodemailer from "nodemailer"` here resolves, via Node's
// CJS/ESM interop, to the exact same module object instance that
// `require("nodemailer")` returns inside sender.js (verified empirically:
// `nodemailer === require("nodemailer")` is true under vitest/vite-node for
// this CJS dependency). So mutating `nodemailer.createTransport` here mutates
// the only copy that exists, before sender.js's own getTransport() ever runs.
// Do not reintroduce vi.mock("nodemailer", ...) — it will hang for ~20s.
let sendMailMock
nodemailer.createTransport = () => ({
  sendMail: (...args) => sendMailMock(...args),
})

async function seedOrder(fulfillment_method = "ship") {
  const cid = await catalog.createCollection({
    title: "Drop", status: "active", allow_ship: true, allow_pickup: true,
  })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
  return orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
    fulfillment_method, payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables(
    "email_queue", "email_templates", "order_items", "orders",
    "product_variants", "products", "collections"
  )
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })

  // sender.js only builds a transport (and thus only sends) when SMTP env
  // vars look configured; the test env otherwise leaves it unconfigured.
  process.env.SMTP_HOST = "smtp.example.com"
  process.env.SMTP_USER = "user@example.com"
  process.env.SMTP_PASS = "secret"

  sendMailMock = vi.fn().mockResolvedValue({})
})

describe("sendQueued: batch isolation", () => {
  it("a template-less row failing does not stop a valid row queued after it", async () => {
    const o = await seedOrder()
    // Enqueued first (lower id => claimed/processed first): guaranteed to fail,
    // since "no_such_type" has no matching template (sender.js's own check).
    await queue.enqueue(o.id, "no_such_type", "bad@example.com")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    const result = await sender.sendQueued()

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(1)

    const [rows] = await db.query("SELECT type, status, attempts FROM email_queue ORDER BY id ASC")
    expect(rows[0].type).toBe("no_such_type")
    expect(rows[0].status).toBe("pending")
    expect(rows[0].attempts).toBe(1)
    expect(rows[1].type).toBe("order_placed")
    expect(rows[1].status).toBe("sent")
  })

  it("a template-less row failing after a valid row does not undo the valid send", async () => {
    const o = await seedOrder()
    // Reverse order: valid row claimed/processed first this time.
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    await queue.enqueue(o.id, "no_such_type", "bad@example.com")

    const result = await sender.sendQueued()

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false })

    const [rows] = await db.query("SELECT type, status, attempts FROM email_queue ORDER BY id ASC")
    expect(rows[0].type).toBe("order_placed")
    expect(rows[0].status).toBe("sent")
    expect(rows[1].type).toBe("no_such_type")
    expect(rows[1].status).toBe("pending")
    expect(rows[1].attempts).toBe(1)
  })

  it("a genuinely failing send (rejected sendMail) does not stop the next row from sending", async () => {
    const o1 = await seedOrder()
    const o2 = await seedOrder()
    await queue.enqueue(o1.id, "order_placed", "bad@example.com")
    await queue.enqueue(o2.id, "order_placed", "a@example.com")

    sendMailMock
      .mockRejectedValueOnce(new Error("bad address"))
      .mockResolvedValue({})

    const result = await sender.sendQueued()

    expect(result).toEqual({ sent: 1, failed: 1, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(2)

    const [rows] = await db.query("SELECT order_id, status, attempts FROM email_queue ORDER BY id ASC")
    expect(rows[0].order_id).toBe(o1.id)
    expect(rows[0].status).toBe("pending")
    expect(rows[0].attempts).toBe(1)
    expect(rows[1].order_id).toBe(o2.id)
    expect(rows[1].status).toBe("sent")
  })
})

describe("sendQueued: retry-cap respect", () => {
  it("never claims (or sends) a pending row already at MAX_ATTEMPTS", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    // Edge state: attempts already at the cap but status never flipped to
    // 'failed' (e.g. a race). claimPending's WHERE attempts < MAX_ATTEMPTS
    // must exclude it regardless of status.
    await db.query("UPDATE email_queue SET attempts = ? WHERE id = ?", [queue.MAX_ATTEMPTS, row.id])

    const result = await sender.sendQueued()

    expect(result).toEqual({ sent: 0, failed: 0, skipped: false })
    expect(sendMailMock).not.toHaveBeenCalled()

    const [[after]] = await db.query("SELECT status, attempts FROM email_queue WHERE id = ?", [row.id])
    expect(after.status).toBe("pending")
    expect(after.attempts).toBe(queue.MAX_ATTEMPTS)
  })

  it("stops sending a row after it accumulates failures, and a later call does not retry it", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")
    const [[row]] = await db.query("SELECT id FROM email_queue LIMIT 1")

    sendMailMock.mockRejectedValue(new Error("smtp down"))

    const actualFailuresBeforeMarkedFailed = queue.MAX_ATTEMPTS
    for (let i = 0; i < actualFailuresBeforeMarkedFailed; i += 1) {
      const result = await sender.sendQueued()
      expect(result).toEqual({ sent: 0, failed: 1, skipped: false })
    }

    const [[afterMarkedFailed]] = await db.query("SELECT status, attempts FROM email_queue WHERE id = ?", [row.id])
    expect(afterMarkedFailed.status).toBe("failed")
    expect(afterMarkedFailed.attempts).toBe(actualFailuresBeforeMarkedFailed)
    expect(sendMailMock).toHaveBeenCalledTimes(actualFailuresBeforeMarkedFailed)

    const nextResult = await sender.sendQueued()
    expect(nextResult).toEqual({ sent: 0, failed: 0, skipped: false })
    expect(sendMailMock).toHaveBeenCalledTimes(actualFailuresBeforeMarkedFailed) // no further attempt
  })
})

describe("sendQueued: send-time template rendering", () => {
  it("renders using the template as it is at send time, not at enqueue time", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    // Edit the template AFTER enqueue, BEFORE send: proves no render happened
    // (and got cached) back at enqueue time.
    const marker = "MARKER_" + Math.random().toString(36).slice(2)
    await templates.upsertTemplate("order_placed", {
      subject: `Đơn hàng #{{order_id}} ${marker}`,
      body_html: `<p>${marker} {{buyer_name}}</p>`,
    })

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain(marker)
    expect(sentArg.subject).toContain(marker)

    const [[row]] = await db.query("SELECT status FROM email_queue LIMIT 1")
    expect(row.status).toBe("sent")
  })
})

describe("sendQueued: pickup QR gating", () => {
  it("ship order: no QR image or attachment", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
    expect(sentArg.attachments).toEqual([])
  })

  it("pickup order: has the QR image and attachment", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).toContain("nhận hàng tại sự kiện")
    expect(sentArg.attachments).toHaveLength(1)
    expect(sentArg.attachments[0]).toMatchObject({ filename: "order-qr.png", cid: "orderqr" })
  })

  it("pending pickup order: email does NOT include the pickup_code yet (unpaid)", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("Mã xác nhận")
  })

  it("confirmed (paid) pickup order: email includes the pickup_code", async () => {
    const o = await seedOrder("pickup")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [o.id])
    expect(sentArg.html).toContain(row.pickup_code)
  })

  it("cancelled pickup order: no QR image, attachment, or pickup caption at all", async () => {
    const o = await seedOrder("pickup")
    // transitionOrder already auto-enqueues the "cancelled" email itself
    // (TRANSITION_EMAILS) — no need to enqueue a second one here.
    await orders.transitionOrder(o.id, "cancelled")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
    expect(sentArg.attachments).toEqual([])
  })

  it("confirmed pickup order with a null pickup_code (legacy order predating the migration): QR still renders, no 'Mã xác nhận' / literal 'null'", async () => {
    const o = await seedOrder("pickup")
    await orders.transitionOrder(o.id, "confirmed")
    await db.query("UPDATE orders SET pickup_code = NULL WHERE id = ?", [o.id])
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("Mã xác nhận")
    expect(sentArg.html).not.toContain("null")
  })
})

describe("sendQueued: no real network connection", () => {
  it("actually goes through the mocked transport (mock invoked, not bypassed)", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({ to: "a@example.com" })
  })
})
