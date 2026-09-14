const express = require("express")
const repo = require("../shop/giftSettings")

function validate(d) {
  if (d.enabled) {
    if (!d.name?.trim()) return "Cần tên quà tặng"
    if (!Number.isInteger(d.min_total) || d.min_total < 0) {
      return "Mức đơn tối thiểu phải là số nguyên không âm"
    }
  }
  // adminUploadImage (the only way this field is populated through the UI)
  // always returns storage.proxyUrl()'s relative "/api/storage/..." path,
  // same as every other image field in the app.
  if (d.image_url?.trim() && !/^(https?:\/\/|\/api\/storage\/)/i.test(d.image_url.trim())) {
    return "Ảnh quà tặng phải là URL http:// hoặc https://, hoặc ảnh tải lên từ hệ thống"
  }
  return null
}

module.exports = function adminGiftRoutes() {
  const router = express.Router()

  router.get("/gift-settings", async (req, res) => {
    try {
      res.json(await repo.getSettings())
    } catch (err) {
      console.error("[ADMIN/GIFT] Lỗi đọc cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/gift-settings", async (req, res) => {
    try {
      const invalid = validate(req.body)
      if (invalid) return res.status(400).json({ error: "invalid_input", message: invalid })

      await repo.updateSettings(req.body)
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/GIFT] Lỗi lưu cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
