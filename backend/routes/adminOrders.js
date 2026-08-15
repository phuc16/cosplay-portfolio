const express = require("express")
const repo = require("../shop/orders/orderRepo")
const domain = require("../shop/orders/domain")
const paymentSettings = require("../shop/payments/settingsRepo")
const { buildInstructions } = require("../shop/payments/instructions")

const STATUSES = ["pending", "confirmed", "shipped", "completed", "cancelled"]

// A griefed drop is at most a few dozen orders; this is generous headroom
// while still bounding how many DB transactions + email enqueues one request
// can trigger. Shared by bulk-cancel and bulk-complete — same reasoning
// applies to both.
const BULK_ACTION_MAX = 100

// The legal next-statuses for a given order, per the real canTransition state
// machine — the single source of truth. Sent to the frontend so it never needs
// its own copy of TRANSITIONS/the pickup-shipped exclusion rule.
const TRANSITION_TARGETS = ["confirmed", "shipped", "completed", "cancelled"]
function withAllowedTransitions(order) {
  if (!order) return order
  // order_token is the buyer's bearer credential for their own public,
  // unauthenticated order page (GET /api/orders/:token) and payment QR —
  // stripped here rather than never selected, since repo.getOrderById is
  // also the shared lookup for internal uses that DO need it (e.g. the
  // email sender building the order URL). This is the only chokepoint
  // both admin-facing routes (list, detail) serialize an order through.
  const { order_token, ...rest } = order
  return {
    ...rest,
    // Computed here rather than sent as a separate lookup: the admin list/
    // detail views show this instead of the raw id (see AdminOrders.jsx),
    // and it's a pure function of fields the row already has.
    order_code: domain.formatOrderCode(order.id, order.created_at),
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
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        search: req.query.search,
      })
      res.json(orders.map(withAllowedTransitions))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn") }
  })

  // Backs the admin QR scanner: it only ever extracts a token from the
  // buyer's public order URL, so the lookup has to happen server-side here
  // rather than the admin's browser matching against order_token client-side
  // (which is why order_token isn't in the list/detail response at all —
  // see withAllowedTransitions above). Registered before "/orders/:id" so
  // Express doesn't swallow "by-token" as an :id value.
  router.get("/orders/by-token/:token", async (req, res) => {
    try {
      const order = await repo.getOrderByToken(req.params.token)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(withAllowedTransitions(order))
    } catch (err) { oops(res, err, "Lỗi tra cứu đơn theo mã QR") }
  })

  router.get("/orders/:id", async (req, res) => {
    try {
      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      res.json(withAllowedTransitions(order))
    } catch (err) { oops(res, err, "Lỗi lấy đơn") }
  })

  // Backs the payment-instructions panel in the admin order detail view —
  // the same buildInstructions() the buyer's own public page uses, but
  // looked up by numeric id under admin auth rather than the admin's
  // browser calling the buyer's public /api/orders/:token/payment route
  // directly (which is why order_token isn't in the admin response either).
  router.get("/orders/:id/payment", async (req, res) => {
    try {
      const order = await repo.getOrderById(req.params.id)
      if (!order) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      const settings = await paymentSettings.getSettings()
      res.json(buildInstructions(order, settings))
    } catch (err) { oops(res, err, "Lỗi lấy hướng dẫn thanh toán") }
  })

  router.post("/orders/:id/transition", async (req, res) => {
    try {
      const { to, tracking_code, shipping_fee, cancel_reason } = req.body
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
      // Only meaningful alongside to === "cancelled"; transitionOrder itself
      // already guards writing it to any other target status.
      if (to === "cancelled" && typeof cancel_reason === "string" && cancel_reason.trim()) {
        extra.cancel_reason = cancel_reason.trim().slice(0, 500)
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

  // Bulk cancel — the abuse-resistance mitigation for a griefed drop: lets the
  // admin clear a batch of orders in one request. Cancels each order through
  // the same transitionOrder() used everywhere else (stock release, the
  // double-release guard, and the cancellation email all live there), one
  // order per call, so one order's failure never stops the others.
  router.post("/orders/bulk-cancel", async (req, res) => {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "ids phải là mảng khác rỗng" })
      }
      if (ids.length > BULK_ACTION_MAX) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể huỷ tối đa ${BULK_ACTION_MAX} đơn mỗi lần`,
        })
      }

      const results = []
      for (const rawId of ids) {
        const id = Number(rawId)
        if (!Number.isInteger(id) || id <= 0) {
          results.push({ id: rawId, ok: false, error: "invalid_input", message: "ID đơn hàng không hợp lệ" })
          continue
        }

        try {
          const order = await repo.getOrderById(id)
          if (!order) {
            results.push({ id, ok: false, error: "not_found", message: "Không tìm thấy đơn hàng" })
            continue
          }

          const ok = await repo.transitionOrder(id, "cancelled")
          results.push(ok
            ? { id, ok: true }
            : {
                id, ok: false, error: "invalid_transition",
                message: `Không thể chuyển từ "${order.status}" sang "cancelled"`,
              })
        } catch (err) {
          console.error(`[ADMIN/ORDERS] Lỗi huỷ đơn ${id} trong huỷ hàng loạt:`, err)
          results.push({ id, ok: false, error: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }

      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi huỷ hàng loạt đơn") }
  })

  // Bulk complete — lets staff who verified pickup buyers offline (via the
  // printed roster's pickup_code, when event-venue connectivity was too weak
  // for the live QR-scan flow) batch-apply the completed status once
  // connectivity returns, instead of one order at a time. Mirrors
  // bulk-cancel exactly: same transitionOrder() call per order, same
  // per-order error isolation, same cap.
  router.post("/orders/bulk-complete", async (req, res) => {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "ids phải là mảng khác rỗng" })
      }
      if (ids.length > BULK_ACTION_MAX) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể hoàn tất tối đa ${BULK_ACTION_MAX} đơn mỗi lần`,
        })
      }

      const results = []
      for (const rawId of ids) {
        const id = Number(rawId)
        if (!Number.isInteger(id) || id <= 0) {
          results.push({ id: rawId, ok: false, error: "invalid_input", message: "ID đơn hàng không hợp lệ" })
          continue
        }

        try {
          const order = await repo.getOrderById(id)
          if (!order) {
            results.push({ id, ok: false, error: "not_found", message: "Không tìm thấy đơn hàng" })
            continue
          }

          const ok = await repo.transitionOrder(id, "completed")
          results.push(ok
            ? { id, ok: true }
            : {
                id, ok: false, error: "invalid_transition",
                message: `Không thể chuyển từ "${order.status}" sang "completed"`,
              })
        } catch (err) {
          console.error(`[ADMIN/ORDERS] Lỗi hoàn tất đơn ${id} trong hoàn tất hàng loạt:`, err)
          results.push({ id, ok: false, error: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }

      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi hoàn tất hàng loạt đơn") }
  })

  return router
}
