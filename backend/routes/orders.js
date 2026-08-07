const express = require("express")
const repo = require("../shop/orders/orderRepo")

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]
const FULFILLMENT = ["ship", "pickup"]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })

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

      const order = await repo.createOrder(req.body)
      res.status(201).json({ order_token: order.order_token, total: order.total })
    } catch (err) {
      if (err instanceof repo.EmptyCartError) return bad(res, err.message)
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

      res.json(order)
    } catch (err) {
      console.error("[ORDERS] Lỗi lấy đơn:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
