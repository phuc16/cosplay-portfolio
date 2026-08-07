require("dotenv").config()

if (!process.env.JWT_SECRET) {
  console.warn("Warning: JWT_SECRET not set. Set it in .env or environment.")
}

const express = require("express")
const cors = require("cors")
const crypto = require("crypto")
const jwt = require("jsonwebtoken")
const { rateLimit } = require("express-rate-limit")
const { RedisStore } = require("rate-limit-redis")
const db = require("./db")
const redis = require("./redis")
const auth = require("./auth")
const storage = require("./storage")

const app = express()
const UPLOAD_LIMIT = "50mb"
const largeJson = express.json({ limit: UPLOAD_LIMIT })
const smallJson = express.json({ limit: "1mb" })

app.use(cors())
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/api\/(image$|upload\/|admin\/shop\/image$|orders\/[^/]+\/proof$)/.test(req.path)) {
    return largeJson(req, res, next)
  }
  return smallJson(req, res, next)
})

// Error handler for payload too large (413) — must be immediately after body-parser
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    console.error(`[ERROR] Payload too large: ${req.url} - limit ${UPLOAD_LIMIT}`)
    return res.status(413).json({
      error: "payload_too_large",
      message: `Ảnh quá lớn. Giới hạn: ${UPLOAD_LIMIT}. Hãy chọn ảnh nhỏ hơn hoặc nén trước khi upload.`
    })
  }
  next(err)
})

// Rate limiting (chống DDoS)
const keyGen = (req) =>
  req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"

const makeStore = (prefix) =>
  new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix })

// Public API: 120 req/phút
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:public:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Public IP ${keyGen(req)} bị chặn: ${req.method} ${req.url}`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều yêu cầu. Thử lại sau." })
  },
})

// Storage proxy: 300 req/phút (ảnh được load nhiều hơn)
const storageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:storage:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Storage IP ${keyGen(req)} bị chặn`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều yêu cầu. Thử lại sau." })
  },
})

// Order creation: 10/hour per IP. Reservation holds stock, so unchecked
// submissions could exhaust a limited drop before anyone pays.
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:order:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Order IP ${keyGen(req)} bị chặn`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều đơn. Thử lại sau." })
  },
})

// Global: 600 req/phút hard ceiling per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGen,
  store: makeStore("rl:global:"),
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] Global IP ${keyGen(req)} bị chặn: ${req.method} ${req.url}`)
    res.status(429).json({ error: "too_many_requests", message: "Quá nhiều yêu cầu. Thử lại sau." })
  },
})
app.use(globalLimiter)

// Request logging — one structured JSON line per request
app.use((req, res, next) => {
  const start = process.hrtime.bigint()
  res.on("finish", () => {
    const latency = Number(process.hrtime.bigint() - start) / 1e6
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      msg: "request",
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ip: getClientIp(req),
      latency: Math.round(latency * 10) / 10,
      bytes_in: Number(req.headers["content-length"]) || 0,
      bytes_out: Number(res.getHeader("content-length")) || 0,
      user_agent: req.headers["user-agent"] || "",
      referer: req.headers["referer"] || "",
    }))
  })
  next()
})

const API_PREFIX = "/api"


// LOGIN ADMIN - check env (RAM), no DB + brute force protection
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin"
const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_LOCKOUT_MINUTES = 15

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"
}

// Constant-time string comparison — prevents character-by-character timing attacks
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest()
  const hb = crypto.createHash("sha256").update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
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

    if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
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
    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" })
    console.log(`[LOGIN] Đăng nhập thành công: ${username}`)
    res.json({ token })
  } catch (err) {
    console.error("[LOGIN] Lỗi:", err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }
})

// ── SHOP: public storefront ──
app.use(`${API_PREFIX}/shop`, publicLimiter, require("./routes/shop")())

// ── ORDERS: public order creation + lookup. Creation gets its own stricter
// limiter (reservation holds real stock); reading an order status page uses
// the general public limiter so a buyer refreshing it isn't locked out. ──
app.use(`${API_PREFIX}/orders`, (req, res, next) =>
  req.method === "POST" ? orderLimiter(req, res, next) : publicLimiter(req, res, next),
  require("./routes/orders")())

app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminCatalog")())
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminOrders")())
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminPayments")())

const invalidateGallery = () => redis.del("gallery")

// GET /api/storage/:path+ - proxy file từ MinIO (public)
app.get(new RegExp(`^${API_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/(.+)$`), storageLimiter, async (req, res) => {
  try {
    const key = decodeURIComponent(req.path.replace(/^\/api\/storage\//, ""))
    if (!key || key.includes("..")) {
      return res.status(400).json({ error: "invalid_key" })
    }
    const buffer = await storage.getBuffer(key)
    const ext = key.split(".").pop()?.toLowerCase() || "jpg"
    const MIME = { png: "image/png", gif: "image/gif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" }
    const ct = MIME[ext] || "application/octet-stream"
    res.setHeader("Content-Type", ct)
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.send(buffer)
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return res.status(404).end()
    console.error("[STORAGE] Proxy error:", err.message)
    res.status(500).end()
  }
})
const invalidateSettings = () => Promise.all([redis.del("settings"), redis.del("favicon_png")])

// GET SETTINGS (public, cached)
const DEFAULT_SETTINGS = {
  colorScheme: "pink",
  heroImageUrl: "",
  thumbnailImageUrl: "",
  heroImages: [],
  heroAccents: [],
  heroCovers: [],
  heroCover: "",
  latestPhotos: [],
  logoUrl: "",
  footerChar: "",
  artistName: { vi: "Kamidayhehe", en: "Kamidayhehe" },
  tagline: { vi: "Cosplayer • Prop Maker", en: "Cosplayer • Prop Maker" },
  about: {
    vi: "Xin chào! Mình làm cosplay chủ yếu theo thể loại anime/game, tự làm đồ, props và có kinh nghiệm chụp hình sự kiện. Nhận đặt lịch cho convention, photoshoot và collab.",
    en: "Hi! I do cosplay mostly in anime/game genres, make my own costumes and props, and have experience shooting at events. Booking open for conventions, photoshoots and collabs.",
  },
  hero: {
    subtitle: { vi: "Cosplay portfolio & highlights", en: "Cosplay portfolio & highlights" },
    description: {
      vi: "Trang portfolio trưng bày ảnh cosplay, props, và thông tin đặt lịch.",
      en: "Portfolio for cosplay photos, props, and booking info.",
    },
  },
  achievements: [
    { title: { vi: "100+ Cosplay", en: "100+ Cosplays" }, description: { vi: "Anime, game & thiết kế gốc từ 2018", en: "Anime, game & original designs since 2018" } },
    { title: { vi: "20+ Convention", en: "20+ Conventions" }, description: { vi: "Khách mời & thí sinh tại các sự kiện lớn ở VN", en: "Guest & competitor at major VN events" } },
    { title: { vi: "10K+ Người theo dõi", en: "10K+ Followers" }, description: { vi: "Trên Facebook, Instagram & TikTok", en: "Across Facebook, Instagram & TikTok" } },
  ],
  upcomingEvents: [
    { title: { vi: "Comic Con Vietnam 2026", en: "Comic Con Vietnam 2026" }, date: { vi: "15 Th8, 2026", en: "Aug 15, 2026" }, url: "", showPopup: true, imageUrl: "" },
    { title: { vi: "AniMate Festival — khách mời", en: "AniMate Festival — guest" }, date: { vi: "02 Th9, 2026", en: "Sep 02, 2026" }, url: "", showPopup: false, imageUrl: "" },
    { title: { vi: "Studio drop (collab)", en: "Studio drop (collab)" }, date: { vi: "20 Th9, 2026", en: "Sep 20, 2026" }, url: "", showPopup: false, imageUrl: "" },
  ],
  contact: {
    email: "hello@kamidayhehe.com",
    phone: "+84 90 123 4567",
    contactLinks: [],
    social: [
      { platform: "facebook", label: "Facebook", url: "https://facebook.com/kamimoe1911" },
      { platform: "instagram", label: "Instagram", url: "https://instagram.com/kamidayhehe" },
      { platform: "page", label: "Page", url: "https://facebook.com/kamimoe1911" },
      { platform: "x", label: "X", url: "https://x.com/Kamidayhehe" },
      { platform: "tiktok", label: "TikTok", url: "https://tiktok.com/@kamidayhehe" },
      { platform: "discord", label: "Discord", url: "https://discord.gg/kamidayhehe" },
    ],
    supports: { gumroad: "https://kamidayhehe.gumroad.com", gank: "https://ganknow.com/kamidayhehe", paypal: "https://paypal.com/kamidayhehe" },
  },
}

// Favicon available straight from the HTML <link> (no waiting for the React
// app to fetch settings). Serves a tiny 64×64 PNG generated from the logo —
// redirecting to the full-size image made browsers show a placeholder while
// downloading/decoding a huge webp.
app.get(`${API_PREFIX}/favicon.png`, publicLimiter, async (req, res) => {
  try {
    const cached = await redis.getBuffer("favicon_png")
    if (cached && cached.length) {
      return res.type("png").set("Cache-Control", "public, max-age=300").end(cached)
    }
    let config = null
    const cache = await redis.get("settings")
    if (cache) {
      config = JSON.parse(cache)
    } else {
      const [rows] = await db.query("SELECT config FROM site_settings ORDER BY id LIMIT 1")
      config = rows[0]?.config
        ? (typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config)
        : {}
    }
    const href = config.logoUrl || (config.heroImages || [])[0] || ""
    if (!href.startsWith("/api/storage/")) return res.status(204).end()
    const buf = await storage.getBuffer(href.replace(/^\/api\/storage\//, ""))
    const png = await sharp(buf).resize(64, 64, { fit: "cover", position: "top" }).png().toBuffer()
    await redis.set("favicon_png", png, "EX", 3600)
    res.type("png").set("Cache-Control", "public, max-age=300").end(png)
  } catch (err) {
    console.error("[FAVICON] Lỗi:", err)
    res.status(204).end()
  }
})

app.get(`${API_PREFIX}/settings`, publicLimiter, async (req, res) => {
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
    merged.heroImages = merged.heroImages || []
    merged.achievements = merged.achievements || []
    if (merged.contact) {
      merged.contact = { ...DEFAULT_SETTINGS.contact, ...merged.contact }
      merged.contact.social = merged.contact.social || []
      merged.contact.supports = merged.contact.supports || { gumroad: "", gank: "", paypal: "" }
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

const ALLOWED_SETTINGS_KEYS = [
  "colorScheme", "artistName", "tagline", "about", "heroImageUrl", "thumbnailImageUrl",
  "heroImages", "heroAccents", "heroCovers", "heroCover", "latestPhotos", "logoUrl", "footerChar", "achievements", "hero",
  "upcomingEvents", "contact",
]

function sanitizeSettings(body) {
  const out = {}
  for (const key of ALLOWED_SETTINGS_KEYS) {
    if (key in body) out[key] = body[key]
  }
  if (out.heroImages !== undefined && !Array.isArray(out.heroImages)) out.heroImages = []
  if (out.heroAccents !== undefined && !Array.isArray(out.heroAccents)) out.heroAccents = []
  if (out.heroCovers !== undefined) {
    // Per-slide cover framing from the admin preview.
    // Slot = { desktop?, tablet?, mobile? }, each {zoom, x, y} numbers only;
    // legacy flat {zoom,x,y} slots are stored as desktop.
    const variant = (c) => c && typeof c === "object" ? {
      zoom: Number.isFinite(Number(c.zoom)) ? Number(c.zoom) : 4.5,
      x: Number.isFinite(Number(c.x)) ? Number(c.x) : 0,
      y: Number.isFinite(Number(c.y)) ? Number(c.y) : -30,
    } : null
    out.heroCovers = (Array.isArray(out.heroCovers) ? out.heroCovers : []).map((c) => {
      if (!c || typeof c !== "object") return {}
      if ("zoom" in c || "x" in c || "y" in c) return { desktop: variant(c) }
      const slot = {}
      for (const k of ["desktop", "tablet", "mobile"]) {
        const v = variant(c[k])
        if (v) slot[k] = v
      }
      return slot
    })
  }
  if (out.latestPhotos !== undefined && !Array.isArray(out.latestPhotos)) out.latestPhotos = []
  if (out.achievements !== undefined && !Array.isArray(out.achievements)) out.achievements = []
  if (out.upcomingEvents !== undefined && !Array.isArray(out.upcomingEvents)) out.upcomingEvents = []
  for (const key of ["colorScheme", "heroImageUrl", "thumbnailImageUrl", "heroCover", "logoUrl", "footerChar"]) {
    if (key in out && typeof out[key] !== "string") out[key] = ""
  }
  return out
}

app.put(`${API_PREFIX}/settings`, auth, async (req, res) => {
  try {
    const config = JSON.stringify(sanitizeSettings(req.body))
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
app.get(`${API_PREFIX}/gallery`, publicLimiter, async (req, res) => {
  try {
    const cache = await redis.get("gallery")
    if (cache) {
      console.log("[GALLERY] Cache hit")
      return res.json(JSON.parse(cache))
    }

    const [albums] = await db.query("SELECT * FROM albums ORDER BY sort_order ASC, id ASC")
    const [images] = await db.query("SELECT * FROM images ORDER BY sort_order ASC, id ASC")
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
    const [rows] = await db.query("SELECT * FROM albums ORDER BY sort_order ASC, id ASC")
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
    const [[{ nextOrder }]] = await db.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM albums")
    const [r] = await db.query(
      "INSERT INTO albums(title, description, sort_order) VALUES(?,?,?)",
      [title || "Untitled", description || null, nextOrder]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Created: ${title || "Untitled"} (id=${r.insertId})`)
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    console.error("[ALBUMS] Lỗi create:", err)
    res.status(500).json({ error: "server_error", message: "Không tạo được album." })
  }
})

app.put(`${API_PREFIX}/albums/reorder`, auth, async (req, res) => {
  try {
    const { albumIds } = req.body
    if (!Array.isArray(albumIds) || albumIds.length === 0) {
      return res.status(400).json({ error: "invalid_input", message: "Cần mảng albumIds." })
    }
    if (albumIds.some((id) => { const n = parseInt(id, 10); return isNaN(n) || n <= 0 || String(n) !== String(id).trim() })) {
      return res.status(400).json({ error: "invalid_input", message: "albumIds phải là số nguyên dương." })
    }
    const placeholders = albumIds.map((_, i) => `WHEN ? THEN ?`).join(" ")
    const values = albumIds.flatMap((id, i) => [id, i])
    const idsList = albumIds.map(() => "?").join(",")
    await db.query(
      `UPDATE albums SET sort_order = CASE id ${placeholders} END WHERE id IN (${idsList})`,
      [...values, ...albumIds]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Reordered ${albumIds.length} albums`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[ALBUMS] Lỗi reorder:", err)
    res.status(500).json({ error: "server_error", message: "Không đổi thứ tự album." })
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

// Resize (honoring EXIF orientation) and re-encode. Transparency is preserved:
// images WITH an alpha channel are written as PNG so background-removed
// (tách nền) uploads stay transparent; opaque images stay JPEG for size.
async function processImage(buffer) {
  const meta = await sharp(buffer).metadata()
  let pipeline = sharp(buffer).rotate()
  if (meta.width > MAX_FULL_WIDTH) {
    pipeline = pipeline.resize(MAX_FULL_WIDTH, null, { withoutEnlargement: true })
  }
  // WebP for everything: ~10-15x smaller than PNG for transparent cutouts,
  // ~25-35% smaller than JPEG for photos, and it preserves alpha automatically.
  return { buffer: await pipeline.webp({ quality: 82, effort: 4 }).toBuffer(), ext: "webp" }
}

// ── Hero accent color: computed ONCE here at upload (no client-side canvas). ──
// EXACT replication of the design's extractDominantColor + colorToTheme
// (portfolio_standalone.html): saturation-weighted dominant color of the subject
// (skip transparent a≤100 and near-black/near-white), then boost ×1.4.
function _sat(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return d === 0 ? 0 : d / (1 - Math.abs(mx + mn - 1)) }
function _hex(r, g, b) { return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("") }
async function extractAccentHex(buffer) {
  try {
    const { data } = await sharp(buffer).resize(80, 80, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let r = 0, g = 0, b = 0, tw = 0
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3], br = (data[i] + data[i + 1] + data[i + 2]) / 3
      const sat = _sat(data[i], data[i + 1], data[i + 2])
      if (a > 100 && br > 20 && br < 235) {
        const w = 0.1 + sat * 6
        r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; tw += w
      }
    }
    const dom = tw > 0 ? [r / tw, g / tw, b / tw] : [100, 60, 180]
    const boost = (v) => Math.min(255, Math.round(v * 1.4))
    return _hex(boost(dom[0]), boost(dom[1]), boost(dom[2]))
  } catch { return "#db2777" }
}

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

    const { buffer: finalBuffer, ext } = await processImage(buffer)
    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/hero-${uuid}.${ext}`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)
    const accentColor = await extractAccentHex(finalBuffer)
    console.log(`[UPLOAD/HERO] Đã lưu: ${key} accent=${accentColor}`)
    res.json({ url, accentColor })
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

    const { buffer: finalBuffer, ext } = await processImage(buffer)
    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/thumb-${uuid}.${ext}`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)
    const accentColor = await extractAccentHex(finalBuffer)
    console.log(`[UPLOAD/THUMB] Đã lưu: ${key} accent=${accentColor}`)
    res.json({ url, accentColor })
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

    const { buffer: finalBuffer, ext } = await processImage(buffer)
    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `site/event-${uuid}.${ext}`
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

    const { buffer: finalBuffer, ext } = await processImage(buffer)
    const uuid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const key = `images/${album_id}/${uuid}.${ext}`
    await storage.upload(key, finalBuffer)
    const url = storage.proxyUrl(key)

    const outputMeta = await sharp(finalBuffer).metadata()
    const width = outputMeta.width || null
    const height = outputMeta.height || null

    const [[{ nextOrder }]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM images WHERE album_id = ?",
      [album_id]
    )
    await db.query(
      "INSERT INTO images(album_id, url, width, height, sort_order) VALUES(?,?,?,?,?)",
      [album_id, url, width, height, nextOrder]
    )

    invalidateGallery()
    console.log(`[IMAGE] Đã lưu ảnh vào MinIO album ${album_id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[IMAGE] Lỗi upload:", err.message)
    res.status(500).json({ error: "server_error", message: `Upload thất bại. Kiểm tra kích thước ảnh (max ${UPLOAD_LIMIT}) hoặc thử lại.` })
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

app.put(`${API_PREFIX}/albums/:id/images/reorder`, auth, async (req, res) => {
  try {
    const albumId = req.params.id
    const { imageIds } = req.body
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: "invalid_input", message: "Cần mảng imageIds." })
    }
    if (imageIds.some((id) => { const n = parseInt(id, 10); return isNaN(n) || n <= 0 || String(n) !== String(id).trim() })) {
      return res.status(400).json({ error: "invalid_input", message: "imageIds phải là số nguyên dương." })
    }
    const placeholders = imageIds.map((_, i) => `WHEN ? THEN ?`).join(" ")
    const values = imageIds.flatMap((id, i) => [id, i])
    const idsList = imageIds.map(() => "?").join(",")
    await db.query(
      `UPDATE images SET sort_order = CASE id ${placeholders} END WHERE album_id = ? AND id IN (${idsList})`,
      [...values, albumId, ...imageIds]
    )
    invalidateGallery()
    console.log(`[ALBUMS] Reordered ${imageIds.length} images in album ${albumId}`)
    res.json({ ok: true })
  } catch (err) {
    console.error("[ALBUMS] Lỗi reorder:", err)
    res.status(500).json({ error: "server_error", message: "Không đổi thứ tự được." })
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

if (require.main === module) {
  app.listen(5000, () => {
    storage.ensureBucket().then(() => {
      console.log(`[SERVER] MinIO bucket ready: ${storage.BUCKET}`)
    }).catch((e) => {
      console.warn("[SERVER] MinIO init failed:", e.message, "- uploads may fail")
    })
    console.log(`[SERVER] Backend listening on :5000, body limit ${UPLOAD_LIMIT}`)
  })
}

module.exports = app
