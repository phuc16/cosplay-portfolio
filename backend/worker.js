require("dotenv").config()
const sharp = require("sharp")
const db = require("./db")
const redis = require("./redis")
const storage = require("./storage")
const orderRepo = require("./shop/orders/orderRepo")
const emailSender = require("./shop/email/sender")

const THUMB_WIDTH = 400
const JPEG_QUALITY = 85

/** Lấy buffer ảnh từ MinIO */
async function getImageBuffer(img) {
  const key = img.url.replace(/^\/api\/storage\//, "")
  return storage.getBuffer(key)
}

async function processImage(img) {
  const buffer = await getImageBuffer(img)

  // WebP thumbnail: small + preserves transparency automatically.
  const thumb = await sharp(buffer)
    .rotate() // auto-orient từ EXIF (ảnh điện thoại)
    .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer()

  const thumbKey = `thumbs/${img.album_id}/${Date.now()}-${img.id}.webp`
  await storage.upload(thumbKey, thumb)
  const thumbUrl = storage.proxyUrl(thumbKey)

  await db.query(
    "UPDATE images SET thumb_url=? WHERE id=?",
    [thumbUrl, img.id]
  )
  console.log(`[WORKER] Thumbnail generated for image ${img.id}`)
}

/**
 * Cancel prepaid orders whose payment window has passed and return their
 * reserved stock. COD orders have a NULL expires_at and are never swept.
 */
async function sweepExpiredOrders() {
  try {
    const released = await orderRepo.releaseExpiredOrders(new Date())
    if (released > 0) {
      console.log(`[WORKER] Đã hủy ${released} đơn quá hạn, hoàn kho`)
    }
    return released
  } catch (err) {
    console.error("[WORKER] Lỗi quét đơn quá hạn:", err.message)
    return 0
  }
}

/**
 * When SMTP isn't configured, sendQueued() no-ops without touching the queue
 * at all — so with no signal here, email_queue grows forever and nobody
 * finds out until a buyer complains. This is the one cheap check
 * (COUNT only, not claimPending's full row fetch) needed to surface that.
 */
async function warnIfMailStuckUnconfigured() {
  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM email_queue WHERE status = 'pending'"
  )
  if (count > 0) {
    console.warn(`[WORKER] SMTP chưa cấu hình — ${count} email đang chờ gửi bị bỏ qua`)
  }
}

async function dispatchEmails() {
  try {
    const { sent, failed, skipped } = await emailSender.sendQueued(10)
    if (skipped) {
      await warnIfMailStuckUnconfigured()
      return 0
    }
    if (sent || failed) {
      console.log(`[WORKER] Email: gửi ${sent}, lỗi ${failed}`)
    }
    return sent
  } catch (err) {
    console.error("[WORKER] Lỗi gửi email:", err.message)
    return 0
  }
}

let running = false

/**
 * Guarded against overlap: setInterval fires every 5s regardless of how long
 * the previous tick took, and a slow tick (thumbnail generation, expiry
 * sweep, or SMTP round-trips in dispatchEmails) can easily outlast that
 * window. Without this flag, an overlapping tick's claimPending() would
 * return the same still-pending email rows the in-flight tick hasn't
 * finished marking sent yet, sending them twice.
 */
async function run() {
  if (running) return
  running = true
  try {
    try {
      const [rows] = await db.query(
        "SELECT id, album_id, url FROM images WHERE thumb_url IS NULL AND url IS NOT NULL"
      )

      for (const img of rows) {
        try {
          await processImage(img)
        } catch (err) {
          console.error(`[WORKER] Error processing image ${img.id}:`, err.message)
        }
      }

      if (rows.length > 0) {
        await redis.del("gallery")
      }
    } catch (err) {
      console.error("[WORKER] Error:", err.message)
    }

    await sweepExpiredOrders()
    await dispatchEmails()
  } finally {
    running = false
  }
}

if (require.main === module) {
  run()
  setInterval(run, 5000)
}

module.exports = { run, sweepExpiredOrders, dispatchEmails, warnIfMailStuckUnconfigured }
