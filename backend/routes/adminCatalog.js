const express = require("express")
const repo = require("../shop/catalogRepo")
const cache = require("../shop/catalogCache")
const { processShopImage, storeShopImage } = require("../shop/images")

const STATUSES = ["draft", "active", "closed", "archived"]

const bad = (res, message) => res.status(400).json({ error: "invalid_input", message })
const oops = (res, err, where) => {
  console.error(`[ADMIN/CATALOG] ${where}:`, err)
  res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
}

function validateCollection(body) {
  if (!body.title || !String(body.title).trim()) return "Cần tên bộ sưu tập"
  if (body.status && !STATUSES.includes(body.status)) return "Trạng thái không hợp lệ"
  if (body.allow_ship === false && body.allow_pickup === false) {
    return "Phải chọn ít nhất một hình thức nhận hàng"
  }
  return null
}

function validateProduct(body) {
  if (!body.name || !String(body.name).trim()) return "Cần tên sản phẩm"
  const price = Number(body.price)
  if (!Number.isInteger(price) || price < 0) return "Giá phải là số nguyên không âm (VND)"
  return null
}

function validateVariants(variants) {
  if (!Array.isArray(variants)) return "Danh sách phân loại không hợp lệ"
  for (const v of variants) {
    if (!v.label || !String(v.label).trim()) return "Mỗi phân loại cần có mã/tên"
    if (v.stock_qty !== null && v.stock_qty !== undefined && v.stock_qty !== "") {
      const n = Number(v.stock_qty)
      if (!Number.isInteger(n) || n < 0) return "Số lượng phải là số nguyên không âm, hoặc để trống nếu không giới hạn"
    }
  }
  const labels = variants.map((v) => String(v.label).trim())
  if (new Set(labels).size !== labels.length) return "Mã phân loại bị trùng"
  return null
}

/** `auth` is applied by the caller in server.js. */
module.exports = function adminCatalogRoutes() {
  const router = express.Router()

  router.get("/collections", async (req, res) => {
    try {
      res.json(await repo.listAllCollections())
    } catch (err) { oops(res, err, "Lỗi liệt kê collection") }
  })

  router.get("/collections/:id", async (req, res) => {
    try {
      const detail = await repo.getCollectionDetailById(req.params.id)
      if (!detail) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })

      res.json(detail)
    } catch (err) { oops(res, err, "Lỗi lấy chi tiết collection") }
  })

  router.post("/collections", async (req, res) => {
    try {
      const invalid = validateCollection(req.body)
      if (invalid) return bad(res, invalid)

      const id = await repo.createCollection(req.body)
      await cache.invalidate()
      res.status(201).json({ id })
    } catch (err) { oops(res, err, "Lỗi tạo collection") }
  })

  router.put("/collections/:id", async (req, res) => {
    try {
      const invalid = validateCollection(req.body)
      if (invalid) return bad(res, invalid)

      const ok = await repo.updateCollection(req.params.id, req.body)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi sửa collection") }
  })

  router.delete("/collections/:id", async (req, res) => {
    try {
      const ok = await repo.deleteCollection(req.params.id)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy bộ sưu tập" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi xóa collection") }
  })

  router.post("/collections/:id/products", async (req, res) => {
    try {
      const invalid = validateProduct(req.body)
      if (invalid) return bad(res, invalid)

      const id = await repo.createProduct({ ...req.body, collection_id: Number(req.params.id) })
      await cache.invalidate()
      res.status(201).json({ id })
    } catch (err) { oops(res, err, "Lỗi tạo sản phẩm") }
  })

  router.put("/products/:id", async (req, res) => {
    try {
      const invalid = validateProduct(req.body)
      if (invalid) return bad(res, invalid)

      const ok = await repo.updateProduct(req.params.id, req.body)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy sản phẩm" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi sửa sản phẩm") }
  })

  router.delete("/products/:id", async (req, res) => {
    try {
      const ok = await repo.deleteProduct(req.params.id)
      if (!ok) return res.status(404).json({ error: "not_found", message: "Không tìm thấy sản phẩm" })

      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi xóa sản phẩm") }
  })

  router.put("/products/:id/variants", async (req, res) => {
    try {
      const { variants } = req.body
      const invalid = validateVariants(variants)
      if (invalid) return bad(res, invalid)

      await repo.replaceVariants(Number(req.params.id), variants)
      await cache.invalidate()
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi lưu phân loại") }
  })

  router.post("/shop/image", async (req, res) => {
    const { base64, folder } = req.body
    if (!base64) return bad(res, "Cần ảnh (base64)")

    const buffer = Buffer.from(base64, "base64")
    console.log(`[ADMIN/CATALOG] upload ảnh shop size≈${Math.round(buffer.length / 1024)}KB`)

    // Decoding/processing failures mean the input itself is bad (corrupt, truncated, or
    // an unsupported format) — always a 400, regardless of sharp's exact error message.
    let processed
    try {
      processed = await processShopImage(buffer)
    } catch (err) {
      return bad(res, "Ảnh không hợp lệ")
    }

    try {
      const url = await storeShopImage(folder || "misc", processed)
      res.status(201).json({ url })
    } catch (err) { oops(res, err, "Lỗi upload ảnh") }
  })

  return router
}
