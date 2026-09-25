const express = require("express")
const prizeRepo = require("../shop/gacha/prizeRepo")
const sessionRepo = require("../shop/gacha/sessionRepo")
const catalogRepo = require("../shop/catalogRepo")

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })
const oops = (res, err, where) => {
  console.error(`[ADMIN/GACHA] ${where}:`, err.message, err.code || "")
  res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
}

const BOOTH_SOURCE = "booth_cash"
const TIERS = ["common", "rare", "mythical", "legendary", "ancient"]
const NAME_MAX_LEN = 191

function validatePrizes(prizes) {
  if (!Array.isArray(prizes) || !prizes.length) return "Cần ít nhất một phần thưởng"
  for (const p of prizes) {
    if (!p.name || !String(p.name).trim()) return "Mỗi phần thưởng cần có tên"
    if (String(p.name).length > NAME_MAX_LEN) return `Tên phần thưởng không được quá ${NAME_MAX_LEN} ký tự`
    if (!TIERS.includes(p.tier)) return "Độ hiếm không hợp lệ"
    const qty = Number(p.quantity_total)
    if (!Number.isInteger(qty) || qty <= 0) return "Số lượng phải là số nguyên dương"
    const price = Number(p.display_price)
    if (!Number.isInteger(price) || price < 0) return "Giá trị hiển thị phải là số nguyên không âm"
  }
  return null
}

module.exports = function adminGachaRoutes() {
  const router = express.Router()

  router.get("/gacha-products", async (req, res) => {
    try {
      res.json(await catalogRepo.listGachaProducts())
    } catch (err) {
      oops(res, err, "Lỗi liệt kê sản phẩm gacha")
    }
  })

  router.get("/gacha-products/:productId/prizes", async (req, res) => {
    try {
      res.json(await prizeRepo.listPrizes(Number(req.params.productId)))
    } catch (err) {
      if (err instanceof sessionRepo.GachaProductNotFoundError) {
        return res.status(404).json({ error: "not_found", message: err.message })
      }
      oops(res, err, "Lỗi đọc danh sách phần thưởng")
    }
  })

  router.put("/gacha-products/:productId/prizes", async (req, res) => {
    try {
      const invalid = validatePrizes(req.body.prizes)
      if (invalid) return bad(res, invalid)
      await prizeRepo.replacePrizes(Number(req.params.productId), req.body.prizes)
      res.json({ ok: true })
    } catch (err) {
      if (err instanceof sessionRepo.GachaProductNotFoundError) {
        return res.status(404).json({ error: "not_found", message: err.message })
      }
      if (err instanceof prizeRepo.GachaPrizeQuantityError) {
        return res.status(409).json({ error: "gacha_prize_quantity", message: err.message })
      }
      // Unreachable through this route in practice (validatePrizes above
      // already rejects a bad quantity_total) - replacePrizes's own guard
      // is defense in depth for its other callers, so map it to 400 here
      // too rather than letting it fall through to a 500.
      if (err instanceof prizeRepo.GachaPrizeInputError) {
        return res.status(400).json({ error: "invalid_input", message: err.message })
      }
      oops(res, err, "Lỗi lưu phần thưởng")
    }
  })

  router.post("/gacha-products/:productId/booth-sessions", async (req, res) => {
    try {
      const turnsTotal = Number(req.body.turns_total)
      if (!Number.isInteger(turnsTotal) || turnsTotal <= 0) return bad(res, "Số lượt quay phải là số nguyên dương")

      const result = await sessionRepo.startBoothSession({
        productId: Number(req.params.productId),
        buyerName: req.body.buyer_name || null,
        turnsTotal,
      })
      res.status(201).json({ order_id: result.orderId, session_id: result.sessionId, order_token: result.orderToken })
    } catch (err) {
      if (err instanceof sessionRepo.GachaProductNotFoundError) {
        return res.status(404).json({ error: "not_found", message: err.message })
      }
      if (err instanceof sessionRepo.GachaSoldOutError) {
        return res.status(409).json({ error: "gacha_sold_out", message: err.message })
      }
      oops(res, err, "Lỗi bắt đầu phiên quầy")
    }
  })

  router.get("/gacha-sessions/:sessionId", async (req, res) => {
    try {
      const session = await sessionRepo.getSessionById(Number(req.params.sessionId))
      // The kiosk tablet only ever runs booth-cash sessions; an online
      // buyer's session is out of its reach, reported as not-found so
      // session ids stay non-enumerable.
      if (!session || session.source !== BOOTH_SOURCE) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy phiên quay" })
      }
      const drops = await sessionRepo.getDropsForSession(session.id)
      res.json({ session, drops })
    } catch (err) {
      oops(res, err, "Lỗi đọc phiên quay")
    }
  })

  router.post("/gacha-sessions/:sessionId/draw", async (req, res) => {
    try {
      const drawKey = req.body.draw_key
      if (!drawKey || typeof drawKey !== "string") return bad(res, "Cần draw_key")

      const result = await sessionRepo.drawForSession(Number(req.params.sessionId), {
        drawKey,
        requireSource: BOOTH_SOURCE,
      })
      res.json({
        prize: result.prize,
        turns_used: result.turnsUsed,
        turns_total: result.turnsTotal,
        session_completed: result.sessionCompleted,
      })
    } catch (err) {
      if (err instanceof sessionRepo.GachaSessionNotFoundError) {
        return res.status(404).json({ error: "not_found", message: err.message })
      }
      if (err instanceof sessionRepo.GachaSessionCompleteError) {
        return res.status(409).json({ error: "session_complete", message: err.message })
      }
      if (err instanceof sessionRepo.GachaOrderCancelledError) {
        return res.status(409).json({ error: "order_cancelled", message: err.message })
      }
      if (err instanceof sessionRepo.GachaSoldOutError) {
        return res.status(409).json({ error: "gacha_sold_out", message: err.message })
      }
      oops(res, err, "Lỗi quay gacha")
    }
  })

  return router
}
