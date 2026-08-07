const express = require("express")
const repo = require("../shop/orders/orderRepo")

const STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"]

module.exports = function adminOrderRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/ORDERS] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  router.get("/orders", async (req, res) => {
    try {
      res.json(await repo.listOrders({
        status: req.query.status,
        collection_id: req.query.collection_id,
      }))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn") }
  })

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(order)
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
      if (shipping_fee !== undefined) extra.shipping_fee = Number(shipping_fee) || null

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
