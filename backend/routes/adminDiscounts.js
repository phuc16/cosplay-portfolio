const express = require("express")
const repo = require("../shop/discountCodes")

/** Coerces admin-form fields (may arrive as strings from a number input) into the types validate()/createCode/updateCode expect. */
function coerce(body) {
  const toIntOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v))
  return {
    code: body.code,
    type: body.type,
    value: toIntOrNull(body.value),
    enabled: body.enabled !== false,
    max_uses: toIntOrNull(body.max_uses),
    min_total: toIntOrNull(body.min_total) ?? 0,
    expires_at: body.expires_at || null,
  }
}

module.exports = function adminDiscountRoutes() {
  const router = express.Router()

  router.get("/discount-codes", async (req, res) => {
    try {
      res.json(await repo.listCodes())
    } catch (err) {
      console.error("[ADMIN/DISCOUNTS] Lỗi liệt kê:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.post("/discount-codes", async (req, res) => {
    try {
      const data = coerce(req.body)
      const invalid = repo.validate(data)
      if (invalid) return res.status(400).json({ error: "invalid_input", message: invalid })

      res.status(201).json(await repo.createCode(data))
    } catch (err) {
      if (err instanceof repo.DuplicateCodeError) {
        return res.status(409).json({ error: "duplicate_code", message: err.message })
      }
      console.error("[ADMIN/DISCOUNTS] Lỗi tạo mã:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/discount-codes/:id", async (req, res) => {
    try {
      const data = coerce(req.body)
      const invalid = repo.validate(data)
      if (invalid) return res.status(400).json({ error: "invalid_input", message: invalid })

      const updated = await repo.updateCode(req.params.id, data)
      if (!updated) return res.status(404).json({ error: "not_found", message: "Không tìm thấy mã giảm giá" })
      res.json(updated)
    } catch (err) {
      if (err instanceof repo.DuplicateCodeError) {
        return res.status(409).json({ error: "duplicate_code", message: err.message })
      }
      console.error("[ADMIN/DISCOUNTS] Lỗi cập nhật mã:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.delete("/discount-codes/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteCode(req.params.id)
      if (!deleted) return res.status(404).json({ error: "not_found", message: "Không tìm thấy mã giảm giá" })
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/DISCOUNTS] Lỗi xóa mã:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
