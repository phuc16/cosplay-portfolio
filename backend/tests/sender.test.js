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
// NOT intercept that require - it was tried once and produced a genuine ~20s
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
// Do not reintroduce vi.mock("nodemailer", ...) - it will hang for ~20s.
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

describe("sendQueued: order QR gating", () => {
  it("ship order: has the QR image/attachment with a plain caption, no pickup instructions", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).toContain("Mã QR đơn hàng")
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
    expect(sentArg.html).not.toContain("Mã xác nhận")
    expect(sentArg.attachments).toHaveLength(1)
    expect(sentArg.attachments[0]).toMatchObject({ filename: "order-qr.png", cid: "orderqr" })
  })

  it("confirmed (paid) ship order: still just the plain caption, no pickup instructions leak in", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).toContain("Mã QR đơn hàng")
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
  })

  it("cancelled ship order: still includes the QR image/attachment (order page is still worth a look)", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.attachments).toHaveLength(1)
  })

  it("pickup order: has the QR image and attachment even while still pending", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.attachments).toHaveLength(1)
    expect(sentArg.attachments[0]).toMatchObject({ filename: "order-qr.png", cid: "orderqr" })
  })

  it("pending pickup order: email does NOT include the pickup_code or the pickup caption yet (unpaid)", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("Mã xác nhận")
    // "Bring this code at pickup" is premature instruction before the seller
    // has actually confirmed the payment - same gate as the code itself.
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
  })

  it("confirmed (paid) pickup order: email includes the pickup_code and the pickup caption", async () => {
    const o = await seedOrder("pickup")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    const [[row]] = await db.query("SELECT pickup_code FROM orders WHERE id = ?", [o.id])
    expect(sentArg.html).toContain(row.pickup_code)
    expect(sentArg.html).toContain("nhận hàng tại sự kiện")
  })

  it("cancelled pickup order: includes the QR image/attachment, but no pickup caption (nothing to collect)", async () => {
    const o = await seedOrder("pickup")
    // transitionOrder already auto-enqueues the "cancelled" email itself
    // (TRANSITION_EMAILS) - no need to enqueue a second one here.
    await orders.transitionOrder(o.id, "cancelled")

    await sender.sendQueued()

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("cid:orderqr")
    expect(sentArg.html).not.toContain("nhận hàng tại sự kiện")
    expect(sentArg.attachments).toHaveLength(1)
  })

  it("cancelled order: includes the admin's cancel_reason when present", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled", { cancel_reason: "Hết hàng thực tế" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("Lý do hủy")
    expect(sentArg.html).toContain("Hết hàng thực tế")
  })

  it("cancelled order: omits the reason block entirely when no reason was given", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("Lý do hủy")
  })

  it("places cancel_reason right after the greeting, ahead of the item list/total - not down by the QR/link", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled", { cancel_reason: "Hết hàng thực tế" })

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    const greetingIndex = html.indexOf("đã bị hủy")
    const reasonIndex = html.indexOf("Hết hàng thực tế")
    const itemsIndex = html.indexOf("Tổng cộng")
    const linkIndex = html.indexOf("Xem đơn hàng")
    expect(reasonIndex).toBeGreaterThan(greetingIndex)
    expect(reasonIndex).toBeLessThan(itemsIndex)
    expect(reasonIndex).toBeLessThan(linkIndex)
  })

  it("cancelled order: escapes HTML in an admin-supplied cancel_reason", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled", { cancel_reason: "<script>alert(1)</script>" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("<script>")
    expect(sentArg.html).toContain("&lt;script&gt;")
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

describe("sendQueued: receiver info and order code on every lifecycle email", () => {
  it("shows the order code, buyer name, phone, and address in order_placed", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Mã đơn hàng")
    expect(html).toContain("Thông tin nhận hàng")
    expect(html).toContain(">A<")
    expect(html).toContain("09")
    expect(html).toContain("x")
  })

  it("also shows receiver info in payment_confirmed, not just order_placed", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Thông tin nhận hàng")
  })

  it("also shows receiver info in cancelled", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "cancelled")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Thông tin nhận hàng")
  })

  it("omits the address line for a pickup order's receiver info", async () => {
    const o = await seedOrder("pickup")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Thông tin nhận hàng")
    expect(html).not.toContain("Địa chỉ nhận hàng")
  })

  it("shows the pickup location and note for a pickup order, in receiver info", async () => {
    const cid = await catalog.createCollection({
      title: "Drop", status: "active", allow_ship: true, allow_pickup: true,
      pickup_location: "Comic Fest, Booth 12", pickup_note: "9am-6pm, both days",
    })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants LIMIT 1")
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer: { buyer_name: "A", phone: "09", email: "a@example.com" },
      fulfillment_method: "pickup", payment_method: "bank",
    })
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Địa điểm nhận")
    expect(html).toContain("Comic Fest, Booth 12")
    expect(html).toContain("Ghi chú nhận hàng")
    expect(html).toContain("9am-6pm, both days")
  })

  it("labels each location with its collection title for an order spanning two pickup collections", async () => {
    const cid1 = await catalog.createCollection({
      title: "Comic Fest", status: "active", allow_pickup: true, pickup_location: "Booth 12", allow_ship: true,
    })
    const cid2 = await catalog.createCollection({
      title: "Anime Day", status: "active", allow_pickup: true, pickup_location: "Booth 7", allow_ship: true,
    })
    const p1 = await catalog.createProduct({ collection_id: cid1, name: "Card A", price: 35000 })
    const p2 = await catalog.createProduct({ collection_id: cid2, name: "Card B", price: 35000 })
    await catalog.replaceVariants(p1, [{ label: "A1", stock_qty: 5 }])
    await catalog.replaceVariants(p2, [{ label: "A1", stock_qty: 5 }])
    const [[v1]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [p1])
    const [[v2]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [p2])
    const o = await orders.createOrder({
      items: [{ variant_id: v1.id, qty: 1 }, { variant_id: v2.id, qty: 1 }],
      buyer: { buyer_name: "A", phone: "09", email: "a@example.com" },
      fulfillment_method: "pickup", payment_method: "bank",
    })
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("Comic Fest")
    expect(html).toContain("Booth 12")
    expect(html).toContain("Anime Day")
    expect(html).toContain("Booth 7")
  })
})

describe("sendQueued: admin-audience emails skip buyer-only blocks", () => {
  it("renders payment_proof_uploaded with no PIN reminder and no QR attachment", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "payment_proof_uploaded", "seller@example.com")

    await sender.sendQueued()

    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).not.toContain("Nếu trang yêu cầu mã PIN")
    expect(call.html).not.toContain("Mã QR đơn hàng")
    expect(call.attachments.some((a) => a.cid === "orderqr")).toBe(false)
  })

  it("still gives order_placed its PIN block and QR attachment (unaffected by the new gating)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "buyer@example.com", { access_pin: "123456" })

    await sender.sendQueued()

    const call = sendMailMock.mock.calls[0][0]
    expect(call.html).toContain("123456")
    expect(call.attachments.some((a) => a.cid === "orderqr")).toBe(true)
  })
})

describe("sendQueued: PIN reminder on later lifecycle emails", () => {
  it("reminds the buyer the PIN was already emailed, on payment_confirmed", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).toContain("mã PIN")
  })

  it("still omits any PIN mention on the admin's own order_placed copy (no payload)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "admin@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).not.toContain("PIN")
  })
})

describe("sendQueued: access PIN in order_placed", () => {
  it("appends the plaintext PIN from the queue row's payload, not from the order (which only has the hash)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com", { access_pin: "482913" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("482913")
    expect(sentArg.html).toContain("Mã PIN")
  })

  it("omits the PIN block entirely when the row carries no payload (e.g. the admin's own copy)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("Mã PIN")
  })

  it("places the PIN inside the same card as the 'Xem đơn hàng' link, not in a separate block after it", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com", { access_pin: "482913" })

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    const linkIndex = html.indexOf("Xem đơn hàng")
    const pinIndex = html.indexOf("482913")
    // The PIN must appear after the link (same reading order as the card)...
    expect(pinIndex).toBeGreaterThan(linkIndex)
    // ...but before the card's own closing </div>, i.e. still inside it - not
    // appended after the whole rendered HTML like the QR/footer blocks. The
    // link itself sits inside its own centered <div>, so the card's real
    // close is the SECOND </div> after the link text, not the first.
    const linkDivClose = html.indexOf("</div>", linkIndex)
    const cardCloseAfterLink = html.indexOf("</div>", linkDivClose + 1)
    expect(pinIndex).toBeLessThan(cardCloseAfterLink)
  })

  it("does not append a PIN block for a non-order_placed email even if somehow enqueued with a payload", async () => {
    const o = await seedOrder("ship")
    await orders.transitionOrder(o.id, "confirmed")
    await queue.enqueue(o.id, "payment_confirmed", "a@example.com", { access_pin: "482913" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("482913")
  })
})

describe("sendQueued: footer (automated-email notice)", () => {
  it("renders the notice after the QR block, not before it", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html.indexOf("cid:orderqr")).toBeLessThan(html.indexOf("email tự động"))
  })

  it("no longer renders any social-link badges - cut per explicit feedback (fake-looking letter badges were worse than none)", async () => {
    const o = await seedOrder("ship")
    await queue.enqueue(o.id, "order_placed", "a@example.com")

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    expect(html).not.toContain("border-radius:50%")
    expect(html).toContain("email tự động")
  })
})

describe("sendQueued: order_updated changed-fields list", () => {
  it("splices in every changed field from the payload, right after the greeting", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).toContain("Tên người nhận")
    expect(sentArg.html).toContain("Nguyễn Văn B")
  })

  it("does not mention a field that did not change", async () => {
    // "Số điện thoại" alone also appears unconditionally in the receiver-info
    // block (wrap()'s {{receiver_info}}, always rendered), so the changes
    // list's own row format (`<strong>{label}:</strong> ...`, with a colon)
    // is the only marker distinguishing "this field is in the changed list"
    // from "this field is just part of the standard receiver-info block".
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("Số điện thoại:")
  })

  it("escapes HTML in a changed value", async () => {
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "<script>alert(1)</script>", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const sentArg = sendMailMock.mock.calls[0][0]
    expect(sentArg.html).not.toContain("<script>")
    expect(sentArg.html).toContain("&lt;script&gt;")
  })

  it("places the changes list ahead of the link, same as cancel_reason", async () => {
    // Anchor on "Tên người nhận:" (with colon - the changes-list row format),
    // not the bare new value: send-time rendering means {{buyer_name}} in the
    // static greeting itself already resolves to the *new* name ("Chào
    // Nguyễn Văn B, ..."), so a plain indexOf("Nguyễn Văn B") would find that
    // first occurrence instead of the spliced block.
    const o = await seedOrder("ship")
    await orders.updateBuyerInfo(o.id, { buyer_name: "Nguyễn Văn B", phone: "09", email: "a@example.com", address_raw: "x" })

    await sender.sendQueued()

    const html = sendMailMock.mock.calls[0][0].html
    const greetingIndex = html.indexOf("vừa được cập nhật")
    const changeIndex = html.indexOf("Tên người nhận:")
    const linkIndex = html.indexOf("Xem đơn hàng")
    expect(changeIndex).toBeGreaterThan(greetingIndex)
    expect(changeIndex).toBeLessThan(linkIndex)
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
