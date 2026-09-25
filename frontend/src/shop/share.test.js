import { describe, it, expect, afterEach, vi } from "vitest"
import { buildShareUrl, buildShareText, copyToClipboard } from "./share"

describe("buildShareUrl", () => {
  it("includes product but omits variant when variantId is null", () => {
    const url = buildShareUrl("summer-drop", 5, null)
    expect(url).toContain("/merchandise/summer-drop?")
    expect(url).toContain("product=5")
    expect(url).not.toContain("variant=")
  })

  it("includes variant when provided", () => {
    const url = buildShareUrl("summer-drop", 5, 42)
    expect(url).toContain("product=5")
    expect(url).toContain("variant=42")
  })

  it("omits variant when variantId is undefined", () => {
    const url = buildShareUrl("summer-drop", 5)
    expect(url).not.toContain("variant=")
  })

  it("is an absolute URL", () => {
    const url = buildShareUrl("summer-drop", 5, null)
    expect(() => new URL(url)).not.toThrow()
  })
})

describe("buildShareText", () => {
  const t = (key, params = {}) => {
    const templates = {
      shopShareText: "Check out {product} - {price} on {shop}",
      shopTitle: "Merchandise",
    }
    let str = templates[key] ?? key
    Object.entries(params).forEach(([k, v]) => { str = str.replaceAll(`{${k}}`, String(v)) })
    return str
  }

  it("includes the variant label in title and text when given", () => {
    const { title, text } = buildShareText(t, "Poster", "A1", 35000)
    expect(title).toBe("Poster · A1")
    expect(text).toBe("Check out Poster · A1 - 35.000₫ on Merchandise")
  })

  it("omits the variant separator when there is no variant label", () => {
    const { title, text } = buildShareText(t, "Digital Album", "", 99000)
    expect(title).toBe("Digital Album")
    expect(text).toContain("Digital Album -")
    expect(text).not.toContain("·")
  })
})

describe("copyToClipboard", () => {
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    if (originalClipboard === undefined) delete navigator.clipboard
    else navigator.clipboard = originalClipboard
    document.execCommand?.mockRestore?.()
  })

  it("uses navigator.clipboard.writeText when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    navigator.clipboard = { writeText }

    const ok = await copyToClipboard("https://example.com/x")

    expect(writeText).toHaveBeenCalledWith("https://example.com/x")
    expect(ok).toBe(true)
  })

  it("falls back to execCommand('copy') when navigator.clipboard is unavailable (insecure context)", async () => {
    delete navigator.clipboard
    document.execCommand = vi.fn().mockReturnValue(true)

    const ok = await copyToClipboard("https://example.com/x")

    expect(document.execCommand).toHaveBeenCalledWith("copy")
    expect(ok).toBe(true)
  })

  it("falls back to execCommand('copy') when navigator.clipboard.writeText rejects", async () => {
    navigator.clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
    document.execCommand = vi.fn().mockReturnValue(true)

    const ok = await copyToClipboard("https://example.com/x")

    expect(document.execCommand).toHaveBeenCalledWith("copy")
    expect(ok).toBe(true)
  })

  it("returns false when neither the Clipboard API nor execCommand works", async () => {
    delete navigator.clipboard
    document.execCommand = vi.fn().mockReturnValue(false)

    const ok = await copyToClipboard("https://example.com/x")

    expect(ok).toBe(false)
  })
})
