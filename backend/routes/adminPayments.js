const express = require("express")
const repo = require("../shop/payments/settingsRepo")

function validate(d) {
  if (d.bank_enabled) {
    if (!d.bank_name?.trim()) return "Cần tên ngân hàng"
    if (!/^\d{4,10}$/.test(String(d.bank_bin || ""))) return "Mã ngân hàng (BIN) phải là số"
    if (!d.bank_account_number?.trim()) return "Cần số tài khoản"
    if (!d.bank_account_holder?.trim()) return "Cần tên chủ tài khoản"
  }
  if (d.momo_enabled && !d.momo_phone?.trim() && !d.momo_qr_image?.trim()) {
    return "Momo cần số điện thoại hoặc ảnh QR"
  }
  // adminUploadImage (the only way this field is ever populated through the
  // UI) always returns storage.proxyUrl()'s relative "/api/storage/..."
  // path, same as every other image field in the app - so this must accept
  // that shape too, not just an absolute URL. Still blocks dangerous
  // schemes (e.g. "javascript:") by only widening to this one known-safe,
  // server-controlled prefix rather than any relative path.
  if (d.momo_qr_image?.trim() && !/^(https?:\/\/|\/api\/storage\/)/i.test(d.momo_qr_image.trim())) {
    return "Ảnh QR Momo phải là URL http:// hoặc https://, hoặc ảnh tải lên từ hệ thống"
  }
  if (d.paypal_enabled && !d.paypal_link?.trim()) return "Cần link PayPal"
  return null
}

module.exports = function adminPaymentRoutes() {
  const router = express.Router()

  router.get("/payment-settings", async (req, res) => {
    try {
      res.json(repo.publicSettings(await repo.getSettings()))
    } catch (err) {
      console.error("[ADMIN/PAYMENTS] Lỗi đọc cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/payment-settings", async (req, res) => {
    try {
      const invalid = validate(req.body)
      if (invalid) return res.status(400).json({ error: "invalid_input", message: invalid })

      await repo.updateSettings(req.body)
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/PAYMENTS] Lỗi lưu cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
