const express = require("express")
const repo = require("../shop/orders/orderRepo")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")
const { processShopImage, storeShopImage } = require("../shop/images")
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
  const { id, order_token, status, total, fulfillment_method, tracking_code, created_at, items } = order
  return { id, order_token, status, total, fulfillment_method, tracking_code, created_at, items }
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
      res.status(201).json({ order_token: order.order_token, total: order.total })
    } catch (err) {
      if (err instanceof repo.EmptyCartError) return bad(res, err.message)
      if (err instanceof repo.FulfillmentNotOfferedError) return bad(res, err.message)
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
      console.error("[ORDERS] Lỗi tạo đơn:", err)
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
      // truncated, or an unsupported format) — always a 400, regardless of
      // sharp's exact error message. Storage failures below are real server
      // errors and fall through to the outer catch.
      let processed
      try {
        processed = await processShopImage(Buffer.from(base64, "base64"))
      } catch {
        return bad(res, "Ảnh không hợp lệ")
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
