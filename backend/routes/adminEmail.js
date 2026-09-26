const express = require("express")
const templates = require("../shop/email/templates")
const sender = require("../shop/email/sender")
const stockAlertQueue = require("../shop/stockAlerts/queue")

const TYPES = Object.keys(templates.DEFAULT_TEMPLATES)

module.exports = function adminEmailRoutes() {
  const router = express.Router()

  router.get("/email-templates", async (req, res) => {
    try {
      // default_subject/default_body_html let the UI offer "restore default" - once overridden, getTemplate() no longer returns the shipped default.
      const rows = await Promise.all(TYPES.map(async (type) => ({
        type,
        ...(await templates.getTemplate(type)),
        default_subject: templates.DEFAULT_TEMPLATES[type].subject,
        default_body_html: templates.DEFAULT_TEMPLATES[type].body_html,
      })))
      res.json(rows)
    } catch (err) {
      console.error("[ADMIN/EMAIL] Lỗi đọc mẫu email:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  router.put("/email-templates/:type", async (req, res) => {
    try {
      const { type } = req.params
      if (!TYPES.includes(type)) {
        return res.status(400).json({ error: "invalid_input", message: "Loại mẫu email không hợp lệ" })
      }

      const { subject, body_html } = req.body
      const bad = templates.validatePlaceholders(`${subject || ""} ${body_html || ""}`)
      if (bad.length > 0) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Placeholder không hợp lệ: ${bad.map((b) => `{{${b}}}`).join(", ")}`,
        })
      }

      await templates.upsertTemplate(type, { subject, body_html })
      res.json({ ok: true })
    } catch (err) {
      console.error("[ADMIN/EMAIL] Lỗi lưu mẫu email:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Surfaces sender.js's listFailed() - a row that exhausted its retries
  // otherwise sits in email_queue with nothing to tell the seller a buyer
  // never got their confirmation.
  router.get("/email-queue/failed", async (req, res) => {
    try {
      const rows = await sender.listFailed()
      res.json(rows)
    } catch (err) {
      console.error("[ADMIN/EMAIL] Lỗi đọc email lỗi:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  // Same minimal surfacing as /email-queue/failed above, for the
  // independent stock-alert queue - a row that exhausted its retries
  // otherwise sits invisibly in stock_alert_queue.
  router.get("/stock-alert-queue/failed", async (req, res) => {
    try {
      const rows = await stockAlertQueue.listFailed()
      res.json(rows)
    } catch (err) {
      console.error("[ADMIN/EMAIL] Lỗi đọc thông báo còn hàng lỗi:", err)
      res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
    }
  })

  return router
}
