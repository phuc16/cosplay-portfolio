const express = require("express")
const repo = require("../shop/orders/orderRepo")
const catalogCache = require("../shop/catalogCache")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
const emailQueue = require("../shop/email/queue")
const qr = require("../shop/orders/qr")
const db = require("../db")

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]
const FULFILLMENT = ["ship", "pickup"]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })

// The DB row (and repo.getOrderByToken) carries internal fields the buyer has
// no use for and no business seeing — request_key (the idempotency key) and
// stock_released_at (an internal reservation flag) — plus PII the order page
// doesn't render. Project down to exactly what Order.jsx reads.
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. Sourced from
    // the order's own collection (joined in getOrderByToken), same content
    // that is already public on the collection page — no new exposure.
    pickup_location, pickup_note,
    // Spec (Buyer Onboarding, Phase 6): the payment deadline the reservation
    // and the expiry sweep already enforce, but never told to the buyer
    // before now. NULL for COD (domain.computeExpiry never sets a deadline
    // for it). This is the only line this phase adds to this allowlist.
    expires_at,
    // Spec (Event Pickup Verification): a pickup-only code the buyer can
    // read aloud/show staff, verifiable against the printed roster without
    // network. Always null for a ship order.
    pickup_code,
    // The proof screenshot itself, so the buyer sees what they uploaded on
    // every visit, not just the one where they uploaded it — same trust
    // boundary as the rest of this response, which already requires the
    // order_token to reach.
    payment_proof_url,
  } = order
  // The code is only meaningful once the order is actually paid for — an
  // unpaid pending order (or one that got cancelled after confirming) has
  // nothing to hand over, and showing the code that early lets a buyer treat
  // "I placed an order" as "I can collect it" before the seller ever
  // verified payment.
  const paidPickupCode = ["confirmed", "completed"].includes(status) ? pickup_code : null
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    pickup_location, pickup_note, expires_at, pickup_code: paidPickupCode,
    has_payment_proof: Boolean(payment_proof_url),
    payment_proof_url: payment_proof_url || null,
  }
}

function validate(body) {
  const { items, buyer, fulfillment_method, payment_method } = body

  if (!Array.isArray(items) || items.length === 0) return "Giỏ hàng trống"
  for (const item of items) {
    if (!Number.isInteger(Number(item.variant_id))) return "Sản phẩm không hợp lệ"
    const qty = Number(item.qty)
    if (!Number.isInteger(qty) || qty <= 0) return "Số lượng không hợp lệ"
  }

  if (!FULFILLMENT.includes(fulfillment_method)) return "Hình thức nhận hàng không hợp lệ"
  if (!PAYMENT_METHODS.includes(payment_method)) return "Phương thức thanh toán không hợp lệ"
  // Pickup orders require prepayment — COD only applies when there is a
  // delivery to collect cash at. A crafted request could otherwise bypass
  // the checkout UI's own filter (added alongside this).
  if (payment_method === "cod" && fulfillment_method === "pickup") {
    return "COD không áp dụng cho đơn nhận tại sự kiện"
  }

  if (!buyer) return "Thiếu thông tin người mua"
  if (!buyer.buyer_name?.trim()) return "Cần họ tên"
  if (!buyer.phone?.trim()) return "Cần số điện thoại"
  if (!buyer.email?.trim() || !EMAIL_RE.test(buyer.email)) return "Email không hợp lệ"

  // Pickup collects no address; shipping cannot go anywhere without one.
  if (fulfillment_method === "ship" && !buyer.address_raw?.trim() && !buyer.address_street?.trim()) {
    return "Cần địa chỉ nhận hàng"
  }
  return null
}

module.exports = function orderRoutes() {
  const router = express.Router()

  router.post("/", async (req, res) => {
    try {
      const invalid = validate(req.body)
      if (invalid) return bad(res, invalid)

      // A method the seller has switched off must not be orderable, even if a
      // stale page or a crafted request still offers it.
      const settings = await paymentSettings.getSettings()
      if (!paymentSettings.enabledMethods(settings).includes(req.body.payment_method)) {
        return bad(res, "Phương thức thanh toán chưa được bật")
      }

      const order = await repo.createOrder(req.body)

      // Both best-effort, after the order (and its stock decrement) is
      // already committed: neither a Redis nor a mail failure may fail an
      // order the buyer has already placed. A replayed (reused) request
      // reserved no new stock and already queued its email the first time
      // around, so it does neither again.
      if (!order.reused) {
        try {
          await catalogCache.invalidate()
        } catch (err) {
          console.error("[ORDERS] Không xoá được cache catalog:", err.message)
        }

        try {
          await emailQueue.enqueue(order.id, "order_placed", req.body.buyer.email)
          if (process.env.ADMIN_EMAIL) {
            await emailQueue.enqueue(order.id, "order_placed", process.env.ADMIN_EMAIL)
          }
        } catch (err) {
          console.error("[ORDERS] Không xếp được email đơn mới:", err.message)
        }
      }

      res.status(201).json({ order_token: order.order_token, total: order.total })
    } catch (err) {
      if (err instanceof repo.EmptyCartError) return bad(res, err.message)
      if (err instanceof repo.FulfillmentNotOfferedError) return bad(res, err.message)
      // A cart line's variant_id matches no row at all (deleted, or a stale
      // cart carrying an id that never existed) — distinct from a real
      // OutOfStockError, which always has an actual product label to quote.
      if (err instanceof repo.VariantNotFoundError) {
        return res.status(409).json({
          error: "variant_not_found",
          message: "Rất tiếc, một sản phẩm trong giỏ hàng không còn tồn tại. Đã tự động xóa khỏi giỏ hàng, vui lòng kiểm tra lại và thử lại.",
          variant_ids: err.missingVariantIds,
        })
      }
      if (err instanceof repo.OutOfStockError) {
        return res.status(409).json({
          error: "out_of_stock",
          message: `Rất tiếc, "${err.variantLabel}" vừa hết hàng. Vui lòng chọn lại.`,
        })
      }
      // A colliding request_key belonging to a different buyer: the unique
      // index refused the insert, and the shared key cannot be reused for this
      // buyer's order either — a distinct code so the client does not treat it
      // like an ordinary validation error or retry with the same key.
      if (err instanceof repo.RequestKeyConflictError) {
        return res.status(409).json({ error: "request_key_conflict", message: err.message })
      }
      // Never log the raw err object here: mysql2 embeds the fully
      // interpolated failing SQL (every bound parameter, including the
      // buyer's full name/phone/address/email and the generated
      // order_token) in err.sql, and console.error(err) prints that. Log
      // only the message (plus the code, useful for triage) — never err,
      // err.sql, or anything from req.body.
      console.error("[ORDERS] Lỗi tạo đơn:", err.message, err.code || "")
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/:token", async (req, res) => {
    try {
      // The token is a bearer credential; keep these pages out of search results.
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      res.json(toPublicOrder(order))
    } catch (err) {
      console.error("[ORDERS] Lỗi lấy đơn:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/:token/payment", async (req, res) => {
    try {
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const settings = await paymentSettings.getSettings()
      res.json(buildInstructions(order, settings))
    } catch (err) {
      console.error("[ORDERS] Lỗi lấy hướng dẫn thanh toán:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/:token/qr.svg", async (req, res) => {
    try {
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      res.type("image/svg+xml").send(await qr.qrSvg(qr.orderUrl(order.order_token)))
    } catch (err) {
      console.error("[ORDERS] Lỗi tạo QR:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Renders the VietQR payload (not the order URL) as an SVG so the buyer's
  // banking app can scan it. Built the same way as /qr.svg — locally, on
  // demand, never stored — so the account details never transit a third
  // party image service. 404 when the method isn't bank or the payload
  // could not be built (misconfiguration); the caller falls back to the
  // printed account details in that case.
  router.get("/:token/payment/qr.svg", async (req, res) => {
    try {
      res.set("X-Robots-Tag", "noindex, nofollow")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const settings = await paymentSettings.getSettings()
      const { vietqr_payload } = buildInstructions(order, settings)
      if (!vietqr_payload) {
        return res.status(404).json({ error: "not_found", message: "Không tạo được mã QR" })
      }

      res.type("image/svg+xml").send(await qr.qrSvg(vietqr_payload))
    } catch (err) {
      console.error("[ORDERS] Lỗi tạo QR thanh toán:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.post("/:token/proof", async (req, res) => {
    try {
      const { base64 } = req.body
      if (!base64) return bad(res, "Cần ảnh chuyển khoản")

      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      // Once confirmed there is nothing left to prove, and accepting an upload
      // would let anyone with the link overwrite the evidence after the fact.
      if (order.status !== "pending") {
        return res.status(409).json({
          error: "invalid_state",
          message: "Đơn hàng đã được xử lý, không cần tải ảnh nữa",
        })
      }

      // Decoding/processing failures mean the input itself is bad (corrupt,
      // truncated, too large, or an unsupported format) — always a 400.
      // InvalidImageError's message is written for the buyer (e.g. "too
      // large, max 50MB") and safe to show as-is; any other error is an
      // unexpected sharp failure, so it falls back to a generic message
      // rather than leaking internals. Storage failures below are real
      // server errors and fall through to the outer catch.
      let processed
      try {
        processed = await processShopImage(Buffer.from(base64, "base64"))
      } catch (err) {
        return bad(res, err instanceof InvalidImageError ? err.message : "Ảnh không hợp lệ")
      }

      const url = await storeShopImage(`proofs/${order.id}`, processed)

      await db.query(
        "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
        [url, order.id]
      )
      console.log(`[ORDERS] Đã nhận ảnh chuyển khoản cho đơn ${order.id}`)
      res.status(201).json({ url })
    } catch (err) {
      console.error("[ORDERS] Lỗi tải ảnh chuyển khoản:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
