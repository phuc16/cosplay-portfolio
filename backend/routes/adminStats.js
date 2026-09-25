const express = require("express")
const repo = require("../shop/stats/statsRepo")
const { bookkeepingToCsv, dropStatsToCsv, restockStatsToCsv } = require("../shop/stats/csv")

module.exports = function adminStatsRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/STATS] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  router.get("/stats/drop/:collectionId", async (req, res) => {
    try {
      const stats = await repo.getDropStats(req.params.collectionId)
      if (!stats) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      res.json(stats)
    } catch (err) { oops(res, err, "Lỗi thống kê theo đợt bán") }
  })

  router.get("/stats/gacha/:productId", async (req, res) => {
    try {
      const stats = await repo.getGachaDropStats(req.params.productId)
      if (!stats) return res.status(404).json({ error: "not_found", message: "Không tìm thấy sản phẩm gacha" })
      res.json(stats)
    } catch (err) { oops(res, err, "Lỗi thống kê gacha") }
  })

  router.get("/stats/restock", async (req, res) => {
    try {
      res.json(await repo.getRestockStats(req.query.collection_id))
    } catch (err) { oops(res, err, "Lỗi thống kê restock") }
  })

  router.get("/stats/restock/export.csv", async (req, res) => {
    try {
      const rows = await repo.getRestockStats(req.query.collection_id)
      res.set("Content-Type", "text/csv; charset=utf-8")
      res.set("Content-Disposition", 'attachment; filename="restock.csv"')
      res.send(restockStatsToCsv(rows))
    } catch (err) { oops(res, err, "Lỗi xuất CSV restock") }
  })

  router.get("/stats/drop/:collectionId/export.csv", async (req, res) => {
    try {
      const stats = await repo.getDropStats(req.params.collectionId)
      if (!stats) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })
      res.set("Content-Type", "text/csv; charset=utf-8")
      res.set("Content-Disposition", `attachment; filename="drop-${stats.collection_id}.csv"`)
      res.send(dropStatsToCsv(stats))
    } catch (err) { oops(res, err, "Lỗi xuất CSV theo đợt bán") }
  })

  router.get("/stats/bookkeeping", async (req, res) => {
    try {
      const stats = await repo.getBookkeepingStats({
        date_from: req.query.date_from, date_to: req.query.date_to,
      })
      res.json(stats)
    } catch (err) {
      if (err instanceof repo.InvalidRangeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi sổ quỹ")
    }
  })

  router.get("/stats/bookkeeping/export.csv", async (req, res) => {
    try {
      const stats = await repo.getBookkeepingStats({
        date_from: req.query.date_from, date_to: req.query.date_to,
      })
      res.set("Content-Type", "text/csv; charset=utf-8")
      res.set("Content-Disposition", `attachment; filename="so-quy-${stats.date_from}-${stats.date_to}.csv"`)
      res.send(bookkeepingToCsv(stats))
    } catch (err) {
      if (err instanceof repo.InvalidRangeError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi xuất CSV sổ quỹ")
    }
  })

  return router
}
