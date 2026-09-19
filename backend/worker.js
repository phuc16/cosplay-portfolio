require("dotenv").config()
const sharp = require("sharp")
const db = require("./db")
const redis = require("./redis")
const storage = require("./storage")
const orderRepo = require("./shop/orders/orderRepo")
const emailSender = require("./shop/email/sender")
const stockNotify = require("./shop/stockNotify")
const { createLease, TICK_INTERVAL_MS } = require("./workerLease")

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

/** Emails buyers waiting on a sold-out variant that has since restocked. */
async function notifyBackInStock() {
  try {
    const { sent } = await stockNotify.sendPendingNotifications()
    if (sent > 0) {
      console.log(`[WORKER] Đã gửi ${sent} email báo hàng lại`)
    }
    return sent
  } catch (err) {
    console.error("[WORKER] Lỗi gửi email báo hàng lại:", err.message)
    return 0
  }
}

/**
 * When SMTP isn't configured, sendQueued() no-ops without touching the queue
 * at all - so with no signal here, email_queue grows forever and nobody
 * finds out until a buyer complains. This is the one cheap check
 * (COUNT only, not claimPending's full row fetch) needed to surface that.
 */
async function warnIfMailStuckUnconfigured() {
  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM email_queue WHERE status = 'pending'"
  )
  if (count > 0) {
    console.warn(`[WORKER] SMTP chưa cấu hình - ${count} email đang chờ gửi bị bỏ qua`)
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
    await notifyBackInStock()
  } finally {
    running = false
  }
}

// Multi-process singleton guard, additive to (and independent of) the
// in-process `running` overlap flag above. See workerLease.js for the full
// rationale and TTL math.
const lease = createLease()

/**
 * Redis-unavailability policy: FAIL CLOSED. `backend/redis.js` treats Redis
 * as a cache elsewhere (the gallery/settings cache degrades gracefully to a
 * DB read when Redis is down) because staleness there just costs a slower
 * response. This lease is different in kind: its entire purpose is
 * preventing the exact silent-double-processing incident in
 * f14-reinvestigation-report.md, and a worker that "fails open" and polls
 * anyway whenever Redis hiccups reintroduces precisely that risk at the one
 * moment (a Redis blip, often correlated with a deploy) it is most likely to
 * coincide with another instance also being up. So: if the lease cannot be
 * acquired *or* renewed for any reason - another holder, or Redis itself
 * being unreachable - this tick is skipped entirely (no sweep, no dispatch,
 * no thumbnails) rather than proceeding unguarded.
 *
 * Skip vs. exit: retry-and-log, not exit. This runs under a process manager
 * / entrypoint.sh with no supervisor that would restart a dead worker into
 * a now-uncontested lease, so exiting on the very first failed attempt would
 * turn an ordinary restart race (the old container still shutting down as
 * the new one starts) into a worker that stays down until someone notices
 * and manually restarts it. Retrying every tick lets that ordinary race
 * self-resolve as soon as the old holder's lease clears, while the loud
 * warning below still makes a *genuine* stale-process conflict impossible to
 * miss in the logs - which is the whole point of this guard.
 */
async function tick() {
  try {
    if (!lease.isHeld()) {
      const acquired = await lease.acquire()
      if (!acquired) {
        console.warn(
          "[WORKER] SINGLETON LEASE HELD BY ANOTHER INSTANCE - refusing to poll this tick. " +
          "If this persists, a stale/duplicate worker process is running and must be stopped " +
          "(see .superpowers/sdd/f14-reinvestigation-report.md)."
        )
        return
      }
      console.log(`[WORKER] Đã giành lease singleton (holder=${lease.holderId})`)
    } else {
      const renewed = await lease.renew()
      if (!renewed) {
        console.warn(
          "[WORKER] LOST SINGLETON LEASE (expired or taken by another instance) - " +
          "skipping this tick and will attempt to re-acquire on the next one."
        )
        return
      }
    }
  } catch (err) {
    console.warn(
      "[WORKER] Redis unavailable - cannot verify/renew the singleton lease, " +
      "skipping this tick (failing closed) to avoid running unguarded:", err.message
    )
    return
  }

  await run()
}

if (require.main === module) {
  tick()
  setInterval(tick, TICK_INTERVAL_MS)
}

module.exports = { run, sweepExpiredOrders, dispatchEmails, notifyBackInStock, warnIfMailStuckUnconfigured, tick, lease }
