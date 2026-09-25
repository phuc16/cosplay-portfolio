const express = require("express")
const repo = require("../shop/shopDisplaySettings")

module.exports = function adminShopDisplayRoutes() {
  const router = express.Router()

  router.get("/shop-display-settings", async (req, res) => {
    try {
      res.json({ group_order: await repo.getGroupOrder() })
    } catch (err) {
      console.error("[ADMIN/SHOP-DISPLAY] Lỗi đọc cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/shop-display-settings", async (req, res) => {
    try {
      if (!repo.isValidOrder(req.body.group_order)) {
        return res.status(400).json({
          error: "invalid_input",
          message: `group_order phải là hoán vị của ${repo.GROUP_KEYS.join(", ")}`,
        })
      }
      await repo.updateGroupOrder(req.body.group_order)
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/SHOP-DISPLAY] Lỗi lưu cấu hình:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
