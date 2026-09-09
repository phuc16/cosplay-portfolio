import { describe, it, expect } from "vitest"
import { processShopImage, validateImageBuffer, InvalidImageError, MAX_UPLOAD_BYTES } from "../shop/images.js"

const jpegMagic = (size) => {
  const buf = Buffer.alloc(size, 0)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  return buf
}

const pngMagic = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

const webpMagic = () => {
  const buf = Buffer.alloc(12, 0)
  buf.write("RIFF", 0, "ascii")
  buf.write("WEBP", 8, "ascii")
  return buf
}

describe("validateImageBuffer", () => {
  it("accepts a jpeg magic-byte buffer within the size cap", () => {
    expect(() => validateImageBuffer(jpegMagic(100))).not.toThrow()
  })

  it("accepts a png magic-byte buffer within the size cap", () => {
    expect(() => validateImageBuffer(pngMagic())).not.toThrow()
  })

  it("accepts a webp magic-byte buffer within the size cap", () => {
    expect(() => validateImageBuffer(webpMagic())).not.toThrow()
  })

  it("rejects an empty buffer", () => {
    expect(() => validateImageBuffer(Buffer.alloc(0))).toThrow(InvalidImageError)
  })

  it("rejects a buffer over MAX_UPLOAD_BYTES even with a valid jpeg header", () => {
    expect(() => validateImageBuffer(jpegMagic(MAX_UPLOAD_BYTES + 1))).toThrow(InvalidImageError)
  })

  it("accepts a buffer exactly at MAX_UPLOAD_BYTES", () => {
    expect(() => validateImageBuffer(jpegMagic(MAX_UPLOAD_BYTES))).not.toThrow()
  })

  it("rejects a buffer whose magic bytes match none of jpeg/png/webp", () => {
    const buf = Buffer.from("this is plain text, not an image at all, definitely not")
    expect(() => validateImageBuffer(buf)).toThrow(InvalidImageError)
  })

  it("the server cap is not stricter than the frontend's 8MB proof-upload guard", () => {
    const FRONTEND_PROOF_MAX_BYTES = 8 * 1024 * 1024
    expect(MAX_UPLOAD_BYTES).toBeGreaterThanOrEqual(FRONTEND_PROOF_MAX_BYTES)
  })
})

describe("processShopImage", () => {
  // Real sharp, given these buffers, throws a generic decode error ("corrupt
  // header" / "unsupported image format"), never an InvalidImageError. Seeing
  // InvalidImageError here is proof validateImageBuffer ran and returned
  // before sharp ever touched the buffer, not just that *something* rejected.
  it("rejects an oversized buffer before sharp is ever invoked", async () => {
    await expect(processShopImage(jpegMagic(MAX_UPLOAD_BYTES + 1))).rejects.toThrow(InvalidImageError)
  })

  it("rejects a wrong-type buffer before sharp is ever invoked", async () => {
    const buf = Buffer.from("not an image, just garbage bytes for this test")
    await expect(processShopImage(buf)).rejects.toThrow(InvalidImageError)
  })
})
