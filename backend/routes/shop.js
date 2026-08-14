const express = require("express")
const cache = require("../shop/catalogCache")
const paymentSettings = require("../shop/payments/settingsRepo")
const vnAddress = require("../shop/vnAddress")

/**
 * Public storefront routes. `publicLimiter` is applied by the caller so the
 * rate-limit configuration stays in one place in server.js.
 */
module.exports = function shopRoutes() {
  const router = express.Router()

  router.get("/collections", async (req, res) => {
    try {
      res.json(await cache.getCollections())
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/collections/:slug", async (req, res) => {
    try {
      const collection = await cache.getCollection(req.params.slug)
      if (!collection) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      }
      res.json(collection)
    } catch (err) {
      console.error("[SHOP] Lỗi lấy collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Only the method names and a free-text note. Account details are served
  // per-order (see /api/orders/:token/payment) so they are not broadcast.
  router.get("/payment-methods", async (req, res) => {
    try {
      const s = await paymentSettings.getSettings()
      res.json({ methods: paymentSettings.enabledMethods(s), payment_note: s.payment_note || null })
    } catch (err) {
      console.error("[SHOP] Lỗi lấy phương thức thanh toán:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Static-ish reference data (Vietnam's 34 provinces + wards), not a live
  // per-keystroke autocomplete — cached 30 days server-side (vnAddress.js)
  // so this almost never actually reaches the third party.
  router.get("/provinces", async (req, res) => {
    try {
      res.json(await vnAddress.getProvinces())
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách tỉnh/thành:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/wards/:provinceCode", async (req, res) => {
    try {
      res.json(await vnAddress.getWards(req.params.provinceCode))
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách phường/xã:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
