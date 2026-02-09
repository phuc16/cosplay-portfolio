require("dotenv").config()
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3")

const endpoint = process.env.MINIO_ENDPOINT || "localhost"
const port = Number(process.env.MINIO_PORT) || 9000
const useSSL = process.env.MINIO_USE_SSL === "true"
const bucket = process.env.MINIO_BUCKET || "cosplay"

const s3 = new S3Client({
  endpoint: `http${useSSL ? "s" : ""}://${endpoint}:${port}`,
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretAccessKey: process.env.MINIO_SECRET_KEY || "minioadmin",
  },
  forcePathStyle: true,
})

const BUCKET = bucket

/** Đảm bảo bucket tồn tại */
async function ensureBucket() {
  const { CreateBucketCommand, HeadBucketCommand } = require("@aws-sdk/client-s3")
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch (e) {
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
      console.log(`[MINIO] Created bucket: ${BUCKET}`)
    } else throw e
  }
}

/** Upload buffer lên MinIO, trả về key (path trong bucket) */
async function upload(key, buffer, contentType = "image/jpeg") {
  await ensureBucket()
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
  return key
}

/** Lấy object từ MinIO, trả về buffer */
async function getBuffer(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const chunks = []
  for await (const chunk of res.Body) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Xóa object */
async function remove(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/** Tạo URL để serve qua backend proxy: /api/storage/{key} */
function proxyUrl(key) {
  if (!key) return null
  return `/api/storage/${key}`
}

module.exports = { s3, BUCKET, ensureBucket, upload, getBuffer, remove, proxyUrl }
