const express = require("express")
const repo = require("../shop/orders/orderRepo")
const domain = require("../shop/orders/domain")

const STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"]

// The legal next-statuses for a given order, per the real canTransition state
// machine — the single source of truth. Sent to the frontend so it never needs
// its own copy of TRANSITIONS/the pickup-shipped exclusion rule.
const TRANSITION_TARGETS = ["confirmed", "shipped", "completed", "cancelled"]
function withAllowedTransitions(order) {
  if (!order) return order
  return {
    ...order,
    allowed_transitions: TRANSITION_TARGETS.filter((to) =>
      domain.canTransition(order.status, to, order.fulfillment_method)
    ),
  }
}

module.exports = function adminOrderRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/ORDERS] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  router.get("/orders", async (req, res) => {
    try {
      const orders = await repo.listOrders({
        status: req.query.status,
        collection_id: req.query.collection_id,
      })
      res.json(orders.map(withAllowedTransitions))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn") }
  })

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(withAllowedTransitions(order))
    } catch (err) { oops(res, err, "Lỗi lấy đơn") }
  })

  router.post("/orders/:id/transition", async (req, res) => {
    try {
      const { to, tracking_code, shipping_fee } = req.body
      if (!STATUSES.includes(to)) {
        return res.status(400).json({ error: "invalid_input", message: "Trạng thái không hợp lệ" })
      }

      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })

      const extra = {}
      if (tracking_code !== undefined) extra.tracking_code = tracking_code
      if (shipping_fee !== undefined) {
        const n = Number(shipping_fee)
        extra.shipping_fee = Number.isFinite(n) ? n : null
      }

      const ok = await repo.transitionOrder(Number(req.params.id), to, extra)
      if (!ok) {
        return res.status(409).json({
          error: "invalid_transition",
          message: `Không thể chuyển từ "${order.status}" sang "${to}"`,
        })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi đổi trạng thái đơn") }
  })

  return router
}
