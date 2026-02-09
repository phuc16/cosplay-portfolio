require("dotenv").config()
const sharp = require("sharp")
const db = require("./db")
const redis = require("./redis")
const storage = require("./storage")

const THUMB_WIDTH = 400
const JPEG_QUALITY = 85

/** Lấy buffer ảnh từ MinIO */
async function getImageBuffer(img) {
  const key = img.url.replace(/^\/api\/storage\//, "")
  return storage.getBuffer(key)
}

async function processImage(img) {
  const buffer = await getImageBuffer(img)

  const thumb = await sharp(buffer)
    .rotate() // auto-orient từ EXIF (ảnh điện thoại)
    .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()

  const thumbKey = `thumbs/${img.album_id}/${Date.now()}-${img.id}.jpg`
  await storage.upload(thumbKey, thumb)
  const thumbUrl = storage.proxyUrl(thumbKey)

  await db.query(
    "UPDATE images SET thumb_url=? WHERE id=?",
    [thumbUrl, img.id]
  )
  console.log(`[WORKER] Thumbnail generated for image ${img.id}`)
}

async function run() {
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
}

run()
setInterval(run, 5000)
