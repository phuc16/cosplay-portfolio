const sharp = require("sharp")
const db = require("../backend/db")

async function run() {
  const [rows] = await db.query(
    "SELECT * FROM images WHERE thumbnail IS NULL"
  )

  for (const img of rows) {
    const buffer = Buffer.from(img.base64, "base64")

    const thumb = await sharp(buffer)
      .resize(300)
      .jpeg()
      .toBuffer()

    await db.query(
      "UPDATE images SET thumbnail=? WHERE id=?",
      [thumb.toString("base64"), img.id]
    )
  }
}

setInterval(run, 5000)
