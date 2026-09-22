import { describe, it, expect } from "vitest"
import { buildShareUrl, buildShareText } from "./share"

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
