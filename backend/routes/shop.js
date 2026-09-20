const express = require("express")
const catalogRepo = require("../shop/catalogRepo")
const paymentSettings = require("../shop/payments/settingsRepo")
const giftSettings = require("../shop/giftSettings")
const discountCodes = require("../shop/discountCodes")
const vnAddress = require("../shop/vnAddress")

/**
 * Public storefront routes. `publicLimiter` is applied by the caller so the
 * rate-limit configuration stays in one place in server.js.
 */
module.exports = function shopRoutes() {
  const router = express.Router()

  router.get("/collections", async (req, res) => {
    try {
      res.json(await catalogRepo.listPublicCollections())
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách collection:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.get("/collections/:slug", async (req, res) => {
    try {
      const collection = await catalogRepo.getPublicCollectionBySlug(req.params.slug)
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

  // Buyer-facing gift config - no delivery_link (see giftSettings.js's
  // publicSettings for why), just enough for the Cart/Checkout pages to show
  // a progress hint and decide whether a physical gift forces the shipping
  // section open for an otherwise-all-digital cart.
  router.get("/gift-settings", async (req, res) => {
    try {
      res.json(giftSettings.publicSettings(await giftSettings.getSettings()))
    } catch (err) {
      console.error("[SHOP] Lỗi lấy cấu hình quà tặng:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Client-side "Apply" feedback only - a client-side estimate, cosmetic
  // only, exactly like the free gift's own public read. Never locks or
  // increments used_count; createOrder is the sole authority and re-checks
  // everything for real, under its own row lock, at order-creation time.
  router.post("/discount-preview", async (req, res) => {
    try {
      const subtotal = Number(req.body?.subtotal)
      if (!Number.isFinite(subtotal) || subtotal < 0) {
        return res.status(400).json({ error: "invalid_input", message: "Giá trị đơn hàng không hợp lệ" })
      }

      const result = await discountCodes.previewCode(req.body?.code, subtotal)
      if (!result.ok) {
        return res.json({ valid: false, message: discountCodes.REASON_MESSAGES[result.reason] || "Mã giảm giá không hợp lệ" })
      }
      res.json({ valid: true, amount: result.amount, type: result.row.type, value: result.row.value })
    } catch (err) {
      console.error("[SHOP] Lỗi kiểm tra mã giảm giá:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Static-ish reference data (Vietnam's 34 provinces + wards), not a live
  // per-keystroke autocomplete - cached 30 days server-side (vnAddress.js)
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
    // Vietnam province codes are short numeric strings - reject anything
    // else before it reaches the outbound fetch URL or the Redis cache key.
    if (!/^\d{1,3}$/.test(req.params.provinceCode)) {
      return res.status(400).json({ error: "invalid_input", message: "Mã tỉnh/thành không hợp lệ" })
    }
    try {
      res.json(await vnAddress.getWards(req.params.provinceCode))
    } catch (err) {
      console.error("[SHOP] Lỗi lấy danh sách phường/xã:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Street/house-number search, debounced (not per-keystroke) from
  // AddressFields.jsx, and only once the buyer has picked both ward and
  // province - that keeps every query scoped and cheap enough to run per
  // typing pause, and resolves a short, ambiguous street name to the right
  // area instead of a same-named street elsewhere in the country. Proxied
  // server-side (key never reaches the browser) with its own addressLimiter
  // (server.js) as defense in depth against a script hitting this directly
  // instead of through the debounce.
  router.get("/address-search", async (req, res) => {
    const goongApiKey = process.env.GOONG_API_KEY || ""
    const input = String(req.query.input || "").trim()
    const ward = String(req.query.ward || "").trim()
    const province = String(req.query.province || "").trim()
    if (input.length < 3) return res.json({ predictions: [] })
    if (!goongApiKey) return res.json({ predictions: [] })

    try {
      const query = [input, ward, province].filter(Boolean).join(", ")
      const url = new URL("https://rsapi.goong.io/v2/place/autocomplete")
      url.searchParams.set("api_key", goongApiKey)
      url.searchParams.set("input", query)
      url.searchParams.set("limit", "5")
      url.searchParams.set("more_compound", "true")

      const goongRes = await fetch(url)
      if (!goongRes.ok) {
        console.warn(`[SHOP] Goong autocomplete trả về ${goongRes.status}`)
        return res.json({ predictions: [] })
      }
      const data = await goongRes.json()
      res.json({ predictions: data.predictions || [] })
    } catch (err) {
      // Never surfaces as an error to the buyer - the search button just
      // shows no results, same as an empty response.
      console.error("[SHOP] Lỗi gọi Goong autocomplete:", err.message)
      res.json({ predictions: [] })
    }
  })

  return router
}
