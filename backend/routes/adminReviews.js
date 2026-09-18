const express = require("express")
const repo = require("../shop/reviews/reviewRepo")

// The only moderation action this iteration ships - no approval queue, no
// admin listing UI beyond what's needed to know an id to delete (see the
// product-reviews design doc's scope decisions).
module.exports = function adminReviewRoutes() {
  const router = express.Router()

  router.delete("/reviews/:id", async (req, res) => {
    try {
      const deleted = await repo.deleteReview(Number(req.params.id))
      if (!deleted) return res.status(404).json({ error: "not_found", message: "Không tìm thấy đánh giá" })
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/REVIEWS] Lỗi xóa đánh giá:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
