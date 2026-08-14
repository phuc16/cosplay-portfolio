const express = require("express")
const cache = require("../shop/catalogCache")
const paymentSettings = require("../shop/payments/settingsRepo")

/**
 * Public storefront routes. `publicLimiter` is applied by the caller so the
 * rate-limit configuration stays in one place in server.js. The address
 * autocomplete route additionally gets its own `addressLimiter` (see
 * server.js) — mounted per-route there, not here, same reasoning.
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

  // Proxied server-side rather than called directly from the browser (the
  // original design) for two reasons: the Goong API key would otherwise sit
  // in the public JS bundle where anyone can extract and run up the shop
  // owner's usage bill with it, and a domain/referrer restriction on
  // Goong's side wouldn't stop that — a script can set any Referer header
  // it likes. Keeping the key server-side plus addressLimiter (server.js)
  // caps worst-case cost by our own rate limit regardless of what Goong
  // itself allows. See frontend/src/components/shop/AddressFields.jsx.
  router.get("/address-autocomplete", async (req, res) => {
    // Read fresh per-request, not cached at module load: a changed key
    // then only needs the process to see the new env, not a restart timed
    // around this module's require() — negligible cost, more forgiving.
    const goongApiKey = process.env.GOONG_API_KEY || ""
    const input = String(req.query.input || "").trim()
    // Mirrors the frontend's own debounce-gate length — anything shorter is
    // near-meaningless for Goong and not worth spending a request on.
    if (input.length < 3) return res.json({ predictions: [] })
    if (!goongApiKey) return res.json({ predictions: [] })

    try {
      const url = new URL("https://rsapi.goong.io/v2/place/autocomplete")
      url.searchParams.set("api_key", goongApiKey)
      url.searchParams.set("input", input)
      url.searchParams.set("limit", "5")
      // Structured district/commune/province on each prediction, instead of
      // parsing the free-text secondary_text ourselves (fragile — breaks on
      // any formatting variation Goong isn't contractually bound to keep).
      url.searchParams.set("more_compound", "true")

      const goongRes = await fetch(url)
      if (!goongRes.ok) {
        console.warn(`[SHOP] Goong autocomplete trả về ${goongRes.status}`)
        return res.json({ predictions: [] })
      }
      const data = await goongRes.json()
      res.json({ predictions: data.predictions || [] })
    } catch (err) {
      // Never surfaces as an error to the buyer — AddressFields.jsx just
      // falls back to a plain textarea when predictions come back empty.
      console.error("[SHOP] Lỗi gọi Goong autocomplete:", err.message)
      res.json({ predictions: [] })
    }
  })

  return router
}
