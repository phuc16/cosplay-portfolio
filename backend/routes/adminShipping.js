const express = require("express")
const db = require("../db")
const orders = require("../shop/orders/orderRepo")
const { LOAI_HANG_HOA_VALUES, orderCode } = require("../shop/shipping/vtpMapping")
const { buildExportWorkbook } = require("../shop/shipping/vtpWorkbook")

module.exports = function adminShippingRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/SHIPPING] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  // Ship orders ready to book: confirmed, ship fulfillment, no tracking code yet.
  router.get("/shipping/export/orders", async (req, res) => {
    try {
      const rows = await orders.listOrders({ status: "confirmed" })
      const eligible = rows.filter((o) => o.fulfillment_method === "ship" && !o.tracking_code)
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: orderCode(o.id),
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
      })))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn cần xuất") }
  })

  router.patch("/shipping/export/orders/:id/payer", async (req, res) => {
    try {
      const { shipping_payer: shippingPayer } = req.body
      if (!["buyer", "seller"].includes(shippingPayer)) {
        return res.status(400).json({ error: "invalid_input", message: "shipping_payer phải là 'buyer' hoặc 'seller'" })
      }
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      const [result] = await db.query(
        "UPDATE orders SET shipping_payer = ? WHERE id = ?", [shippingPayer, id]
      )
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi cập nhật người trả cước") }
  })

  router.post("/shipping/export", async (req, res) => {
    try {
      const { order_ids: orderIds, batch } = req.body
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "order_ids phải là mảng khác rỗng" })
      }
      if (!batch || !batch.ten_hang_hoa || !batch.trong_luong || !batch.loai_hang_hoa || !batch.thoi_gian_hen_lay) {
        return res.status(400).json({
          error: "invalid_input",
          message: "Thiếu thông tin lô hàng (tên hàng hóa, trọng lượng, loại hàng hóa, thời gian hẹn lấy)",
        })
      }
      if (!LOAI_HANG_HOA_VALUES.includes(batch.loai_hang_hoa)) {
        return res.status(400).json({ error: "invalid_input", message: "Loại hàng hóa không hợp lệ" })
      }

      // Re-fetch and re-check eligibility server-side rather than trusting
      // the client's snapshot — an order may have been cancelled or already
      // exported by another admin action between listing and generating.
      // Rejects here are attributed into the same `excluded` array as
      // mapOrderToRow's rejects (never dropped silently) — a seller who
      // submits 30 order_ids must always be able to reconcile
      // exported_count + excluded.length back to 30, or a raced/unknown
      // order vanishes with only a smaller count as the only clue, and a
      // buyer never gets a parcel.
      const ids = orderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      const eligible = []
      const preExcluded = []
      for (const id of ids) {
        const order = await orders.getOrderById(id)
        if (!order) {
          preExcluded.push({ order_id: id, reason: "not_found", message: `${orderCode(id)}: không tìm thấy đơn hàng` })
          continue
        }
        if (order.status === "confirmed" && order.fulfillment_method === "ship" && !order.tracking_code) {
          eligible.push(order)
        } else {
          preExcluded.push({
            order_id: order.id,
            reason: "not_eligible",
            message: `${orderCode(order.id)}: đơn không còn đủ điều kiện xuất (đã hủy, đổi trạng thái, hoặc đã có mã vận đơn)`,
          })
        }
      }

      const { buffer, exported, excluded } = await buildExportWorkbook(eligible, batch)
      res.json({
        file_base64: buffer.toString("base64"),
        filename: `vtp-xuat-don-${new Date().toISOString().slice(0, 10)}.xlsx`,
        exported_count: exported.length,
        excluded: [...preExcluded, ...excluded],
      })
    } catch (err) { oops(res, err, "Lỗi xuất file ViettelPost") }
  })

  return router
}
