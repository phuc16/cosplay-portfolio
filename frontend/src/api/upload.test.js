import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../utils/imageDownscale", () => ({
  downscaleImage: vi.fn((file) => Promise.resolve(file)),
}))
vi.mock("./api", () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: { url: "https://example.com/img.webp" } })) },
}))

import { uploadImage } from "./upload"
import { api } from "./api"
import { downscaleImage } from "../utils/imageDownscale"

beforeEach(() => {
  api.post.mockClear()
  downscaleImage.mockClear()
})

describe("uploadImage", () => {
  it("downscales the file, then posts it as FormData under the 'file' field", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    const data = await uploadImage("/api/admin/shop/image", file)

    expect(downscaleImage).toHaveBeenCalledWith(file)
    expect(api.post).toHaveBeenCalledTimes(1)
    const [url, body] = api.post.mock.calls[0]
    expect(url).toBe("/api/admin/shop/image")
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("file")).toBe(file)
    expect(data).toEqual({ url: "https://example.com/img.webp" })
  })

  it("appends extraFields onto the FormData", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    await uploadImage("/api/admin/shop/image", file, { folder: "collections" })

    const [, body] = api.post.mock.calls[0]
    expect(body.get("folder")).toBe("collections")
  })

  it("passes config (e.g. headers) through to api.post", async () => {
    const file = new File(["x"], "photo.png", { type: "image/png" })
    await uploadImage("/api/orders/tok/proof", file, {}, { headers: { "X-Test": "1" } })

    const [, , config] = api.post.mock.calls[0]
    expect(config).toEqual({ headers: { "X-Test": "1" } })
  })
})
