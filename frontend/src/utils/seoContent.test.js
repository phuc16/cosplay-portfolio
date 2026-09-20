import { describe, it, expect } from "vitest"
import { stripMarkdownToText, truncateText, toAbsoluteUrl, productSeoImage } from "./seoContent"

describe("stripMarkdownToText", () => {
  it("strips markdown formatting down to plain text", () => {
    expect(stripMarkdownToText("**Bold** and _stuff_\n\n- one\n- two")).toBe("Bold and stuff one two")
  })

  it("returns an empty string for empty/nullish input", () => {
    expect(stripMarkdownToText("")).toBe("")
    expect(stripMarkdownToText(null)).toBe("")
  })

  it("collapses newlines/extra whitespace into single spaces", () => {
    expect(stripMarkdownToText("Line one\n\nLine two")).toBe("Line one Line two")
  })
})

describe("truncateText", () => {
  it("returns short text unchanged, with no ellipsis", () => {
    expect(truncateText("Short description.", 160)).toBe("Short description.")
  })

  it("cuts long text on a word boundary and appends an ellipsis", () => {
    const long = "word ".repeat(50).trim()
    const result = truncateText(long, 40)
    expect(result.length).toBeLessThanOrEqual(41)
    expect(result.endsWith("…")).toBe(true)
    expect(result.slice(0, -1).endsWith(" ")).toBe(false)
  })

  it("hard-cuts a single very long word with no good boundary", () => {
    const long = "a".repeat(200)
    const result = truncateText(long, 40)
    expect(result).toBe(`${"a".repeat(40)}…`)
  })

  it("returns an empty string for empty/nullish input", () => {
    expect(truncateText("")).toBe("")
    expect(truncateText(null)).toBe("")
  })
})

describe("toAbsoluteUrl", () => {
  it("prefixes a relative /api/storage path with the current origin", () => {
    expect(toAbsoluteUrl("/api/storage/abc.jpg")).toBe(`${window.location.origin}/api/storage/abc.jpg`)
  })

  it("leaves an already-absolute URL unchanged", () => {
    expect(toAbsoluteUrl("https://cdn.example.com/x.jpg")).toBe("https://cdn.example.com/x.jpg")
    expect(toAbsoluteUrl("http://cdn.example.com/x.jpg")).toBe("http://cdn.example.com/x.jpg")
  })

  it("returns null for empty/nullish input", () => {
    expect(toAbsoluteUrl("")).toBe(null)
    expect(toAbsoluteUrl(null)).toBe(null)
  })
})

describe("productSeoImage", () => {
  it("prefers the product's own thumbnail_image", () => {
    expect(productSeoImage({ thumbnail_image: "/t.jpg", images: ["/a.jpg"] })).toBe("/t.jpg")
  })

  it("falls back to the product's own images array", () => {
    expect(productSeoImage({ images: ["/a.jpg", "/b.jpg"] })).toBe("/a.jpg")
  })

  it("falls back to the first variant with a thumbnail_image, images, or image_url", () => {
    expect(productSeoImage({
      variants: [{ id: 1 }, { id: 2, image_url: "/v2.jpg" }],
    })).toBe("/v2.jpg")
    expect(productSeoImage({
      variants: [{ id: 1, thumbnail_image: "/v1-thumb.jpg" }, { id: 2, image_url: "/v2.jpg" }],
    })).toBe("/v1-thumb.jpg")
  })

  it("returns null when there is no image anywhere", () => {
    expect(productSeoImage({ variants: [{ id: 1 }] })).toBe(null)
    expect(productSeoImage(null)).toBe(null)
  })
})
