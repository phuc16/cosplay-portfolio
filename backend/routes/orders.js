const express = require("express")
const repo = require("../shop/orders/orderRepo")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
const { processShopImage, storeShopImage, InvalidImageError } = require("../shop/images")
const { uploadSingleImage } = require("../shop/upload")
const emailQueue = require("../shop/email/queue")
const qr = require("../shop/orders/qr")
const db = require("../db")
const { orderAccess, verifyPin, issueOrderSessionToken } = require("../shop/orders/orderAccess")
const { formatOrderCode } = require("../shop/orders/domain")

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]
const FULFILLMENT = ["ship", "pickup"]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })

// The DB row (and repo.getOrderByToken) carries internal fields the buyer has
// no use for and no business seeing - request_key (the idempotency key) and
// stock_released_at (an internal reservation flag) - plus PII the order page
// doesn't render. Project down to exactly what Order.jsx reads.
function toPublicOrder(order) {
  const {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items,
    // When the current status was reached, so the order page can show a
    // timestamp next to it (e.g. "Đã xác nhận · 14/08/2026, 13:00") instead
    // of leaving the buyer to guess how long ago it happened. Same fields
    // the admin's OrderTimeline already reads - no new data, just exposed
    // here too.
    confirmed_at, shipped_at, completed_at, cancelled_at,
    // Spec (Fulfillment): pickup location/note must be shown on the order
    // page, not just the pre-purchase collection browse page. One entry per
    // collection the order's items actually touch (a cart can span more than
    // one) - same content already public on each collection's own page, no
    // new exposure.
    pickup_locations,
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
    // every visit, not just the one where they uploaded it - same trust
    // boundary as the rest of this response, which already requires the
    // order_token to reach.
    payment_proof_url,
    // Receiver info, so the buyer can double-check who/where this ships to
    // (same "Thông tin nhận hàng" pattern as Shopee's order confirmation) -
    // an earlier phase deliberately kept these off this response as a
    // privacy default; showing them is now an explicit, later decision, not
    // an oversight. The order page's only protection is still the
    // unguessable token in the URL, so this does trade some safety for a
    // buyer being able to catch a typo'd address/phone before it ships.
    buyer_name, phone, address_raw,
    // Shown in place of the generic "save this link" note once an order is
    // cancelled - the buyer lands here wanting to know why, not to be told
    // to bookmark an order that's already dead. Same field the admin's own
    // view and the cancellation email already show.
    cancel_reason,
  } = order
  // The code is only meaningful once the order is actually paid for - an
  // unpaid pending order (or one that got cancelled after confirming) has
  // nothing to hand over, and showing the code that early lets a buyer treat
  // "I placed an order" as "I can collect it" before the seller ever
  // verified payment.
  const paidPickupCode = ["confirmed", "completed"].includes(status) ? pickup_code : null
  // Same trust boundary as pickup_code above - a link that's fixed on the
  // product for every buyer is only worth showing once the seller has
  // actually accepted (confirmed) the order, never for pending/cancelled.
  const showDelivery = ["confirmed", "shipped", "completed"].includes(status)
  const publicItems = (items || []).map((i) => ({
    ...i,
    delivery_link_snapshot: showDelivery ? i.delivery_link_snapshot : null,
  }))
  return {
    id, order_token, status, total, fulfillment_method, tracking_code, created_at, items: publicItems,
    confirmed_at, shipped_at, completed_at, cancelled_at,
    pickup_locations: pickup_locations || [], expires_at, pickup_code: paidPickupCode,
    has_payment_proof: Boolean(payment_proof_url),
    payment_proof_url: payment_proof_url || null,
    buyer_name, phone, address_raw: address_raw || null,
    // The human-readable code shown everywhere else (admin, emails) - the
    // order page never surfaced it before, leaving a buyer with no code to
    // reference when contacting support, only the opaque URL token.
    order_code: formatOrderCode(id, created_at),
    cancel_reason: cancel_reason || null,
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

  // A physical line requires ship/pickup; an all-digital cart may omit it
  // entirely - orderRepo.createOrder is the only place that knows a cart's
  // item types, so it does the real requiredness check and throws
  // FulfillmentRequiredError if a physical line has none.
  if (fulfillment_method !== undefined && fulfillment_method !== null && !FULFILLMENT.includes(fulfillment_method)) {
    return "Hình thức nhận hàng không hợp lệ"
  }
  if (!PAYMENT_METHODS.includes(payment_method)) return "Phương thức thanh toán không hợp lệ"
  // Pickup orders require prepayment - COD only applies when there is a
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

      // Best-effort, after the order (and its stock decrement) is already
      // committed: a mail failure may not fail an order the buyer has
      // already placed. A replayed (reused) request already queued its
      // email the first time around, so it does not do so again.
      if (!order.reused) {
        try {
          await emailQueue.enqueue(order.id, "order_placed", req.body.buyer.email, { access_pin: order.access_pin })
        } catch (err) {
          console.error("[ORDERS] Không xếp được email đơn mới:", err.message)
        }
      }

      // Lets the buyer's own browser skip the PIN gate for the order page it's
      // about to navigate straight to - see orderAccess.js's
      // issueOrderSessionToken for why this is safe (same request/browser
      // that just placed the order, not a link being opened by someone else).
      res.status(201).json({
        order_token: order.order_token,
        total: order.total,
        access_token: issueOrderSessionToken(order.order_token),
      })
    } catch (err) {
      if (err instanceof repo.EmptyCartError) return bad(res, err.message)
      if (err instanceof repo.FulfillmentNotOfferedError) return bad(res, err.message)
      if (err instanceof repo.NoCodForDigitalError) return bad(res, err.message)
      if (err instanceof repo.FulfillmentRequiredError) return bad(res, err.message)
      // A cart line's variant_id matches no row at all (deleted, or a stale
      // cart carrying an id that never existed) - distinct from a real
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
          message: `Rất tiếc, "${err.productName} · ${err.variantLabel}" vừa hết hàng. Đã tự động xóa khỏi giỏ hàng, vui lòng kiểm tra lại và thử lại.`,
          variant_id: err.variantId,
        })
      }
      // A cart line's collection stopped being "active" between add-to-cart
      // and checkout (most commonly: the seller closed the drop, or its
      // scheduled end_at just passed) - a race the client cannot retry
      // unchanged, same as OutOfStockError.
      if (err instanceof repo.CollectionNotActiveError) {
        const reasonText = err.reason === "not_started"
          ? "chưa mở bán"
          : "thuộc một đợt mở bán đã kết thúc"
        return res.status(409).json({
          error: "collection_not_active",
          message: `Rất tiếc, "${err.productName} · ${err.variantLabel}" ${reasonText}. Đã tự động xóa khỏi giỏ hàng, vui lòng kiểm tra lại và thử lại.`,
          variant_id: err.variantId,
        })
      }
      // A colliding request_key belonging to a different buyer: the unique
      // index refused the insert, and the shared key cannot be reused for this
      // buyer's order either - a distinct code so the client does not treat it
      // like an ordinary validation error or retry with the same key.
      if (err instanceof repo.RequestKeyConflictError) {
        return res.status(409).json({ error: "request_key_conflict", message: err.message })
      }
      // Never log the raw err object here: mysql2 embeds the fully
      // interpolated failing SQL (every bound parameter, including the
      // buyer's full name/phone/address/email and the generated
      // order_token) in err.sql, and console.error(err) prints that. Log
      // only the message (plus the code, useful for triage) - never err,
      // err.sql, or anything from req.body.
      console.error("[ORDERS] Lỗi tạo đơn:", err.message, err.code || "")
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Deliberately NOT behind orderAccess - this is how a buyer earns the
  // session token orderAccess checks below. 5 wrong PINs locks this specific
  // order_token for 15 minutes (see orderAccess.js's verifyPin), independent
  // of the general publicLimiter this router already sits behind.
  router.post("/:token/verify-pin", async (req, res) => {
    try {
      const pin = String(req.body?.pin || "").trim()
      if (!/^\d{6}$/.test(pin)) {
        return bad(res, "Mã PIN phải gồm 6 chữ số")
      }

      const result = await verifyPin(req.params.token, pin)
      if (result.notFound) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      if (result.locked) {
        return res.status(429).json({
          error: "too_many_attempts",
          // message is Vietnamese-only, kept for API completeness/logging -
          // the frontend builds its own localized string from
          // retry_after_seconds instead of displaying this verbatim, so an
          // English-language buyer never sees Vietnamese text here.
          message: `Sai mã PIN quá nhiều lần. Thử lại sau ${Math.ceil(result.retryAfterSeconds / 60)} phút.`,
          retry_after_seconds: result.retryAfterSeconds,
        })
      }
      if (!result.ok) {
        return res.status(401).json({ error: "invalid_pin", message: "Mã PIN không đúng" })
      }
      res.json({ access_token: result.sessionToken })
    } catch (err) {
      console.error("[ORDERS] Lỗi xác thực PIN:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/:token", orderAccess, async (req, res) => {
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

  router.get("/:token/payment", orderAccess, async (req, res) => {
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

  router.get("/:token/qr.svg", orderAccess, async (req, res) => {
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
  // banking app can scan it. Built the same way as /qr.svg - locally, on
  // demand, never stored - so the account details never transit a third
  // party image service. 404 when the method isn't bank or the payload
  // could not be built (misconfiguration); the caller falls back to the
  // printed account details in that case.
  router.get("/:token/payment/qr.svg", orderAccess, async (req, res) => {
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

  router.post("/:token/proof", orderAccess, uploadSingleImage(), async (req, res) => {
    try {
      if (!req.file) return bad(res, "Cần ảnh chuyển khoản")

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
      // truncated, too large, or an unsupported format) - always a 400.
      // InvalidImageError's message is written for the buyer (e.g. "too
      // large, max 50MB") and safe to show as-is; any other error is an
      // unexpected sharp failure, so it falls back to a generic message
      // rather than leaking internals. Storage failures below are real
      // server errors and fall through to the outer catch.
      let processed
      try {
        processed = await processShopImage(req.file.buffer)
      } catch (err) {
        return bad(res, err instanceof InvalidImageError ? err.message : "Ảnh không hợp lệ")
      }

      const url = await storeShopImage(`proofs/${order.id}`, processed)

      await db.query(
        "UPDATE orders SET payment_proof_url = ?, payment_proof_uploaded_at = NOW() WHERE id = ?",
        [url, order.id]
      )
      console.log(`[ORDERS] Đã nhận ảnh chuyển khoản cho đơn ${order.id}`)

      // Best-effort, after the proof is already stored: a mail failure must
      // not fail an upload the buyer already completed successfully.
      if (process.env.ADMIN_EMAIL) {
        try {
          await emailQueue.enqueue(order.id, "payment_proof_uploaded", process.env.ADMIN_EMAIL)
        } catch (err) {
          console.error("[ORDERS] Không xếp được email báo admin:", err.message)
        }
      }

      res.status(201).json({ url })
    } catch (err) {
      console.error("[ORDERS] Lỗi tải ảnh chuyển khoản:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/:token/buyer-info", orderAccess, async (req, res) => {
    try {
      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const { buyer_name, phone, email, note, address_raw } = req.body
      const result = await repo.updateBuyerInfo(
        order.id,
        { buyer_name, phone, email, note, address_raw },
        { requirePending: true }
      )
      if (result === null) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(result.changed ? { changed: true, order: toPublicOrder(result.order) } : { changed: false })
    } catch (err) {
      if (err instanceof repo.InvalidBuyerInfoError) return bad(res, err.message)
      if (err instanceof repo.OrderNotEditableError) {
        return res.status(409).json({ error: "not_editable", message: err.message })
      }
      console.error("[ORDERS] Lỗi sửa thông tin đơn hàng:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
