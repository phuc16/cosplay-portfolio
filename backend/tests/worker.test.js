import { describe, it, expect, beforeEach, vi } from "vitest"
import nodemailer from "nodemailer"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import queue from "../shop/email/queue.js"
import settings from "../shop/payments/settingsRepo.js"
import { run, dispatchEmails, sendPaymentReminders } from "../worker.js"
import { resetTables } from "./helpers/db.js"

// Same nodemailer-mocking gotcha documented in sender.test.js: mutate the
// shared module object rather than vi.mock, or this hangs on a real SMTP
// connection attempt.
let sendMailMock
nodemailer.createTransport = () => ({
  sendMail: (...args) => sendMailMock(...args),
})

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
  await resetTables(
    "email_queue", "order_items", "orders", "product_variants", "products", "collections"
  )
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })

  process.env.SMTP_HOST = "smtp.example.com"
  process.env.SMTP_USER = "user@example.com"
  process.env.SMTP_PASS = "secret"

  sendMailMock = vi.fn()
})

describe("worker run(): overlapping ticks", () => {
  // setInterval(run, 5000) fires on a fixed wall-clock schedule with no
  // regard for how long the previous tick is taking. claimPending() is a
  // bare SELECT with no lease, so if two ticks' dispatchEmails ran at once
  // they would both claim the same still-pending row and both call sendMail
  // on it. The in-flight `running` guard in worker.js is what is supposed to
  // stop that: a second run() call while the first is still in progress
  // must be a no-op, not a second pass over the same queue.
  it("does not double-send a queued email when run() is called again before the first call finishes", async () => {
    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    let resolveSend
    sendMailMock.mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve })
    )

    const first = run()
    // Let the first tick get past its own DB work (now including the
    // payment-reminder sweep ahead of dispatchEmails) and into the mocked
    // SMTP call, so it is genuinely still in-flight (running === true) when
    // the second call is made.
    await new Promise((r) => setTimeout(r, 400))

    // Fires while `first` is still pending. If the overlap guard is missing
    // (or guards only dispatchEmails and not the whole tick), this starts a
    // second claimPending() over the same pending row.
    const second = run()
    await second

    expect(sendMailMock).toHaveBeenCalledTimes(1) // second call was a no-op

    resolveSend({})
    await first

    expect(sendMailMock).toHaveBeenCalledTimes(1) // still just the one send
    const [[row]] = await db.query("SELECT status, attempts FROM email_queue LIMIT 1")
    expect(row.status).toBe("sent")
    expect(row.attempts).toBe(0)
  }, 20000)
})

describe("worker run(): payment reminders", () => {
  it("queues and sends a reminder for a pending order inside the lead window", async () => {
    const o = await seedOrder()
    await db.query(
      "UPDATE orders SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() + 6 * 60 * 60 * 1000), o.id] // 6h out, inside the default 12h lead
    )

    await run()

    const [[order]] = await db.query("SELECT payment_reminder_sent_at FROM orders WHERE id = ?", [o.id])
    expect(order.payment_reminder_sent_at).not.toBeNull()
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const [subject] = sendMailMock.mock.calls[0]
    expect(subject.subject).toContain("sắp hết hạn thanh toán")
  })

  it("does nothing for an order far from its deadline", async () => {
    const o = await seedOrder()
    // Default RESERVATION_HOURS (48h) already leaves this order well outside
    // the default 12h lead window with no further changes needed.
    const sent = await sendPaymentReminders()
    expect(sent).toBe(0)
    const [[order]] = await db.query("SELECT payment_reminder_sent_at FROM orders WHERE id = ?", [o.id])
    expect(order.payment_reminder_sent_at).toBeNull()
  })
})

describe("worker dispatchEmails(): SMTP unconfigured", () => {
  // sendQueued() no-ops entirely when SMTP isn't set - it never touches the
  // queue, so without this warning email_queue silently grows forever and
  // the seller has zero signal that mail is stuck.
  it("logs a warning when SMTP is unconfigured and mail is pending", async () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS

    const o = await seedOrder()
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await dispatchEmails()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("SMTP chưa cấu hình"))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1"))
    } finally {
      warnSpy.mockRestore()
    }

    const [[row]] = await db.query("SELECT status FROM email_queue LIMIT 1")
    expect(row.status).toBe("pending")
  })

  it("stays silent when SMTP is unconfigured and the queue is empty", async () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await dispatchEmails()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
