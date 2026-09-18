const express = require("express")
const repo = require("../shop/coupons/couponRepo")

module.exports = function adminCouponRoutes() {
  const router = express.Router()

  router.get("/coupons", async (req, res) => {
    try {
      res.json(await repo.listCoupons())
    } catch (err) {
      console.error("[ADMIN/COUPONS] Lỗi đọc danh sách mã giảm giá:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.post("/coupons", async (req, res) => {
    try {
      const id = await repo.createCoupon(req.body)
      res.status(201).json({ id })
    } catch (err) {
      if (err instanceof repo.InvalidCouponInputError || err instanceof repo.DuplicateCouponCodeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      console.error("[ADMIN/COUPONS] Lỗi tạo mã giảm giá:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/coupons/:id", async (req, res) => {
    try {
      await repo.updateCoupon(Number(req.params.id), req.body)
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof repo.InvalidCouponInputError || err instanceof repo.DuplicateCouponCodeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      console.error("[ADMIN/COUPONS] Lỗi cập nhật mã giảm giá:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
