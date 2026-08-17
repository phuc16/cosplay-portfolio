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

  // Street/house-number search, debounced (not per-keystroke) from
  // AddressFields.jsx, and only once the buyer has picked both ward and
  // province — an earlier design fired this per character with NO
  // ward/province scoping at all (a nationwide search space), which called
  // Goong far too often; requiring ward/province first keeps every query
  // scoped and cheap enough to run per typing pause instead of needing an
  // explicit search-button click. ward/province also resolve a short,
  // ambiguous street name to the right area instead of a same-named street
  // elsewhere in the country. Proxied server-side (key never reaches the
  // browser) with its own addressLimiter (server.js) as defense in depth
  // against a script hitting this directly instead of through the debounce.
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
      // Never surfaces as an error to the buyer — the search button just
      // shows no results, same as an empty response.
      console.error("[SHOP] Lỗi gọi Goong autocomplete:", err.message)
      res.json({ predictions: [] })
    }
  })

  return router
}
