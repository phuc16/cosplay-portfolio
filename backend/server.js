require("dotenv").config()

if (!process.env.JWT_SECRET) {
  console.warn("Warning: JWT_SECRET not set. Set it in .env or environment.")
}

const express = require("express")
const cors = require("cors")
const jwt = require("jsonwebtoken")
const db = require("./db")
const redis = require("./redis")
const auth = require("./auth")
const storage = require("./storage")

const app = express()
const BODY_LIMIT = "500mb"

app.use(cors())
app.use(express.json({ limit: BODY_LIMIT }))

// Request logging
app.use((req, res, next) => {
  const start = Date.now()
  const log = () => {
    const duration = Date.now() - start
    const size = req.headers["content-length"] ? ` ${req.headers["content-length"]}b` : ""
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}${size} → ${res.statusCode} (${duration}ms)`)
  }
  res.on("finish", log)
  next()
})

const API_PREFIX = "/api"

// Error handler for payload too large (413)
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    console.error(`[ERROR] Payload too large: ${req.url} - limit ${BODY_LIMIT}`)
    return res.status(413).json({
      error: "payload_too_large",
      message: `Ảnh quá lớn. Giới hạn: ${BODY_LIMIT}. Hãy chọn ảnh nhỏ hơn hoặc nén trước khi upload.`
    })
  }
  next(err)
})

// LOGIN ADMIN - check env (RAM), no DB + brute force protection
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin"
const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_LOCKOUT_MINUTES = 15

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"
}

app.post(`${API_PREFIX}/login`, async (req, res) => {
  try {
    const ip = getClientIp(req)
    const lockKey = `login_lock:${ip}`
    const attemptKey = `login_fail:${ip}`

    const lockedUntil = await redis.get(lockKey)
    if (lockedUntil) {
      const ttl = await redis.ttl(lockKey)
      console.warn(`[LOGIN] IP ${ip} bị khóa, còn ${ttl}s`)
      return res.status(429).json({
        error: "too_many_attempts",
        message: `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(ttl / 60)} phút.`,
      })
    }

    const { username, password } = req.body
    if (!username || !password) {
      console.warn("[LOGIN] Thiếu username hoặc password")
      return res.status(400).json({ error: "invalid_input", message: "Cần nhập username và password" })
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      const attempts = await redis.incr(attemptKey)
      if (attempts === 1) await redis.expire(attemptKey, 60 * LOGIN_LOCKOUT_MINUTES)
      if (attempts >= LOGIN_MAX_ATTEMPTS) {
        await redis.set(lockKey, "1", "EX", 60 * LOGIN_LOCKOUT_MINUTES)
        await redis.del(attemptKey)
        console.warn(`[LOGIN] IP ${ip} bị khóa 15 phút sau ${attempts} lần sai`)
        return res.status(429).json({
          error: "too_many_attempts",
          message: `Đăng nhập sai quá ${LOGIN_MAX_ATTEMPTS} lần. Thử lại sau ${LOGIN_LOCKOUT_MINUTES} phút.`,
        })
      }
      console.warn(`[LOGIN] Sai: ${username} (IP ${ip}, lần ${attempts})`)
      return res.status(401).json({ error: "unauthorized", message: "Sai tên đăng nhập hoặc mật khẩu" })
    }

    await redis.del(attemptKey)
    await redis.del(lockKey)
    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
    console.log(`[LOGIN] Đăng nhập thành công: ${username}`)
    res.json({ token })
  } catch (err) {
    console.error("[LOGIN] Lỗi:", err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }
})

const invalidateGallery = () => redis.del("gallery")

// GET /api/storage/:path+ - proxy file từ MinIO (public)
app.get(new RegExp(`^${API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/(.+)$`), async (req, res) => {
  try {
    const key = decodeURIComponent(req.path.replace(/^\/api\/storage\//, ""))
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "invalid_key" })
    }
    const buffer = await storage.getBuffer(key)
    const ext = key.split(".").pop()?.toLowerCase() || "jpg"
    const ct = ext === "png" ? "image/png" : "image/jpeg"
    res.setHeader("Content-Type", ct)
    res.setHeader("Cache-Control", "public, max-age=86400")
    res.send(buffer)
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return res.status(404).end()
    console.error("[STORAGE] Proxy error:", err.message)
    res.status(500).end()
  }
})
const invalidateSettings = () => redis.del("settings")

// GET SETTINGS (public, cached)
const DEFAULT_SETTINGS = {
  heroImageUrl: "",
  thumbnailImageUrl: "",
  artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" },
  tagline: { vi: "Cosplayer • Prop Maker • Photographer Friend", en: "Cosplayer • Prop Maker • Photographer Friend" },
  about: { vi: "", en: "" },
  hero: {
    subtitle: { vi: "Cosplay portfolio & highlights", en: "Cosplay portfolio & highlights" },
    description: {
      vi: "Trang portfolio trưng bày ảnh cosplay, props, và thông tin đặt lịch.",
      en: "Portfolio for cosplay photos, props, and booking info.",
    },
  },
  upcomingEvents: [],
  contact: { email: "", contactLinks: [], social: [], supports: [] },
}

app.get(`${API_PREFIX}/settings`, async (req, res) => {
  try {
    const cache = await redis.get("settings")
    if (cache) {
      console.log("[SETTINGS] Cache hit")
      return res.json(JSON.parse(cache))
    }

    const [rows] = await db.query("SELECT config FROM site_settings ORDER BY id LIMIT 1")
    const config = rows[0]?.config
      ? (typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config)
      : DEFAULT_SETTINGS

    const merged = { ...DEFAULT_SETTINGS, ...config }
    if (merged.contact) {
      merged.contact = { ...DEFAULT_SETTINGS.contact, ...merged.contact }
      merged.contact.social = merged.contact.social || []
      merged.contact.supports = merged.contact.supports || []
      merged.contact.contactLinks = merged.contact.contactLinks || []
    }
    merged.hero = { ...DEFAULT_SETTINGS.hero, ...merged.hero }
    merged.upcomingEvents = merged.upcomingEvents || []

    await redis.set("settings", JSON.stringify(merged), "EX", 3600)
    res.json(merged)
  } catch (err) {
    console.error("[SETTINGS] Lỗi:", err)
    res.json(DEFAULT_SETTINGS)
  }
})

app.put(`${API_PREFIX}/settings`, auth, async (req, res) => {
  try {
    const config = JSON.stringify(req.body)
    const [rows] = await db.query("SELECT id FROM site_settings LIMIT 1")
    if (rows.length > 0) {
      await db.query("UPDATE site_settings SET config=?, updated_at=NOW() WHERE id=?", [
        config,
        rows[0].id,
      ])
    } else {
      await db.query("INSERT INTO site_settings(config) VALUES(?)", [config])
    }
    invalidateSettings()
    console.log("[SETTINGS] Updated")
    res.json({ ok: true })
  } catch (err) {
    console.error("[SETTINGS] Lỗi update:", err)
    res.status(500).json({ error: "server_error", message: "Không lưu được settings." })
  }
})

// GET GALLERY - grouped by album (CACHE REDIS)
app.get(`${API_PREFIX}/gallery`, async (req, res) => {
  try {
    const cache = await redis.get("gallery")
    if (cache) {
      console.log("[GALLERY] Cache hit")
      return res.json(JSON.parse(cache))
    }

    const [albums] = await db.query("SELECT * FROM albums ORDER BY id")
    const [images] = await db.query("SELECT * FROM images ORDER BY id")
    console.log(`[GALLERY] DB: ${albums.length} albums, ${images.length} images`)

    const grouped = albums.map((a) => ({
      id: a.id,
      group: a.title,
      description: a.description,
      items: images.filter((img) => img.album_id === a.id && img.url).map((img) => ({
        id: img.id,
        src: img.thumb_url || img.url,
        fullSrc: img.url,
        width: img.width,
        height: img.height,
      }))
    }))

    const data = JSON.stringify(grouped)
    await redis.set("gallery", data, "EX", 3600)
    res.json(grouped)
  } catch (err) {
    console.error("[GALLERY] Lỗi:", err)
    res.status(500).json({ error: "server_error", message: "Không tải được gallery." })
  }
})

// ALBUMS CRUD
app.get(`${API_PREFIX}/albums`, auth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM albums ORDER BY id")
    console.log(`[ALBUMS] List: ${rows.length} albums`)
    res.json(rows)
  } catch (err) {
    console.error("[ALBUMS] Lỗi list:", err)
    res.status(500).json({ error: "server_error", message: "Không tải được danh sách album." })
  }
})

app.post(`${API_PREFIX}/albums`, auth, async (req, res) => {
  try {
    const { title, description } = req.body
    const [r] = await db.query(
      "INSERT INTO albums(title, description) VALUES(?,?)",
      [title || "Untitled", description || null]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Created: ${title || "Untitled"} (id=${r.insertId})`)
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    console.error("[ALBUMS] Lỗi create:", err)
    res.status(500).json({ error: "server_error", message: "Không tạo được album." })
  }
})

app.put(`${API_PREFIX}/albums/:id`, auth, async (req, res) => {
  try {
    const { title, description } = req.body
    await db.query(
      "UPDATE albums SET title=?, description=? WHERE id=?",
      [title, description, req.params.id]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Updated id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[ALBUMS] Lỗi update:", err)
    res.status(500).json({ error: "server_error", message: "Không cập nhật được album." })
  }
})

app.delete(`${API_PREFIX}/albums/:id`, auth, async (req, res) => {
  try {
    await db.query("DELETE FROM images WHERE album_id=?", [req.params.id])
    await db.query("DELETE FROM albums WHERE id=?", [req.params.id])
    invalidateGallery()
    console.log(`[ALBUMS] Deleted id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[ALBUMS] Lỗi delete:", err)
    res.status(500).json({ error: "server_error", message: "Không xóa được album." })
  }
})

// IMAGES CRUD - lưu vào MinIO, DB chỉ lưu url
const sharp = require("sharp")
const MAX_FULL_WIDTH = 1920
const JPEG_QUALITY = 85

// Upload ảnh hero/profile (không cần album)
app.post(`${API_PREFIX}/upload/hero`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/HERO] size≈${sizeKb}KB`)

    let finalBuffer = buffer
    const meta = await sharp(buffer).metadata()
    const pipeline = sharp(buffer).rotate()
    if (meta.width > MAX_FULL_WIDTH) {
      finalBuffer = await pipeline
        .resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer()
    } else {
      finalBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    }

    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/hero-${uuid}.jpg`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)
    console.log(`[UPLOAD/HERO] Đã lưu: ${key}`)
    res.json({ url })
  } catch (err) {
    console.error("[UPLOAD/HERO] Lỗi:", err.message)
    res.status(500).json({ error: "server_error", message: "Upload thất bại. Thử lại." })
  }
})

app.post(`${API_PREFIX}/upload/thumbnail`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/THUMB] size≈${sizeKb}KB`)

    let finalBuffer = buffer
    const meta = await sharp(buffer).metadata()
    const pipeline = sharp(buffer).rotate()
    if (meta.width > MAX_FULL_WIDTH) {
      finalBuffer = await pipeline
        .resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer()
    } else {
      finalBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    }

    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/thumb-${uuid}.jpg`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)
    console.log(`[UPLOAD/THUMB] Đã lưu: ${key}`)
    res.json({ url })
  } catch (err) {
    console.error("[UPLOAD/THUMB] Lỗi:", err.message)
    res.status(500).json({ error: "server_error", message: "Upload thất bại. Thử lại." })
  }
})

app.post(`${API_PREFIX}/upload/event-image`, auth, async (req, res) => {
  try {
    const { base64 } = req.body
    if (!base64) {
      return res.status(400).json({ error: "invalid_input", message: "Cần ảnh (base64)" })
    }
    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[UPLOAD/EVENT] size≈${sizeKb}KB`)

    let finalBuffer = buffer
    const meta = await sharp(buffer).metadata()
    const pipeline = sharp(buffer).rotate()
    if (meta.width > MAX_FULL_WIDTH) {
      finalBuffer = await pipeline
        .resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer()
    } else {
      finalBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    }

    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/event-${uuid}.jpg`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)
    console.log(`[UPLOAD/EVENT] Đã lưu: ${key}`)
    res.json({ url })
  } catch (err) {
    console.error("[UPLOAD/EVENT] Lỗi:", err.message)
    res.status(500).json({ error: "server_error", message: "Upload thất bại. Thử lại." })
  }
})

app.post(`${API_PREFIX}/image`, auth, async (req, res) => {
  try {
    const { album_id, base64 } = req.body
    if (!album_id || !base64) {
      console.warn("[IMAGE] Thiếu album_id hoặc base64")
      return res.status(400).json({ error: "invalid_input", message: "Cần album_id và ảnh (base64)" })
    }

    const buffer = Buffer.from(base64, "base64")
    const sizeKb = Math.round(buffer.length / 1024)
    console.log(`[IMAGE] Upload: album=${album_id}, size≈${sizeKb}KB`)

    let finalBuffer = buffer
    const meta = await sharp(buffer).metadata()
    const pipeline = sharp(buffer).rotate() // auto-orient từ EXIF (ảnh điện thoại)
    if (meta.width > MAX_FULL_WIDTH) {
      finalBuffer = await pipeline
        .resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer()
    } else {
      finalBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
    }

    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `images/${album_id}/${uuid}.jpg`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)

    const outputMeta = await sharp(finalBuffer).metadata()
    const width = outputMeta.width || null
    const height = outputMeta.height || null

    await db.query(
      "INSERT INTO images(album_id, url, width, height) VALUES(?,?,?,?)",
      [album_id, url, width, height]
    )

    invalidateGallery()
    console.log(`[IMAGE] Đã lưu ảnh vào MinIO album ${album_id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[IMAGE] Lỗi upload:", err.message)
    res.status(500).json({ error: "server_error", message: "Upload thất bại. Kiểm tra kích thước ảnh (max 500MB) hoặc thử lại." })
  }
})

app.put(`${API_PREFIX}/image/:id`, auth, async (req, res) => {
  try {
    const { album_id } = req.body
    if (album_id !== undefined) {
      await db.query("UPDATE images SET album_id=? WHERE id=?", [album_id, req.params.id])
      console.log(`[IMAGE] Moved id=${req.params.id} → album ${album_id}`)
    }
    invalidateGallery()
    res.json({ ok: true })
  } catch (err) {
    console.error("[IMAGE] Lỗi update:", err)
    res.status(500).json({ error: "server_error", message: "Không cập nhật được ảnh." })
  }
})

app.delete(`${API_PREFIX}/image/:id`, auth, async (req, res) => {
  try {
    await db.query("DELETE FROM images WHERE id=?", [req.params.id])
    invalidateGallery()
    console.log(`[IMAGE] Deleted id=${req.params.id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[IMAGE] Lỗi delete:", err)
    res.status(500).json({ error: "server_error", message: "Không xóa được ảnh." })
  }
})

// 404
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.url}`)
  res.status(404).json({ error: "not_found", message: "Không tìm thấy" })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error("[ERROR] Unhandled:", err)
  res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
})

app.listen(5000, () => {
  storage.ensureBucket().then(() => {
    console.log(`[SERVER] MinIO bucket ready: ${storage.BUCKET}`)
  }).catch((e) => {
    console.warn("[SERVER] MinIO init failed:", e.message, "- uploads may fail")
  })
  console.log(`[SERVER] Backend listening on :5000, body limit ${BODY_LIMIT}`)
})
