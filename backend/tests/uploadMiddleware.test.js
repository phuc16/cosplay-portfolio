import { describe, it, expect } from "vitest"
import express from "express"
import request from "supertest"
import { uploadSingleImage } from "../shop/upload.js"
import { MAX_UPLOAD_BYTES } from "../shop/images.js"

function buildApp() {
  const app = express()
  app.post("/test-upload", uploadSingleImage(), (req, res) => {
    res.json({
      hasBuffer: Buffer.isBuffer(req.file?.buffer),
      size: req.file?.buffer?.length || 0,
      folder: req.body.folder || null,
    })
  })
  return app
}

describe("uploadSingleImage", () => {
  it("populates req.file.buffer and req.body fields from a multipart request", async () => {
    const app = buildApp()
    const res = await request(app)
      .post("/test-upload")
      .field("folder", "misc")
      .attach("file", Buffer.from("hello"), "test.png")

    expect(res.status).toBe(200)
    expect(res.body.hasBuffer).toBe(true)
    expect(res.body.size).toBe(5)
    expect(res.body.folder).toBe("misc")
  })

  it("returns 400 invalid_input with a size-specific message when the file exceeds MAX_UPLOAD_BYTES", async () => {
    const app = buildApp()
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0)

    const res = await request(app)
      .post("/test-upload")
      .attach("file", oversized, "big.jpg")

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_input")
    expect(res.body.message).toContain("quá lớn")
  })

  it("calls the handler with no file when none is attached", async () => {
    const app = buildApp()
    const res = await request(app).post("/test-upload").field("folder", "misc")

    expect(res.status).toBe(200)
    expect(res.body.hasBuffer).toBe(false)
    expect(res.body.folder).toBe("misc")
  })
})
