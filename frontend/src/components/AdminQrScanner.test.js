import { describe, it, expect } from "vitest"
import { extractOrderToken } from "./AdminQrScanner"

describe("extractOrderToken", () => {
  it("extracts a 32-char hex token from the public order URL", () => {
    const t32 = "abcdef0123456789abcdef012345678a"
    expect(t32).toHaveLength(32)
    expect(extractOrderToken(`https://shop.example/order/${t32}`)).toBe(t32)
  })

  it("matches regardless of scheme/host, since only the path is relevant", () => {
    const t32 = "0123456789abcdef0123456789abcdef"
    expect(extractOrderToken(`/order/${t32}`)).toBe(t32)
    expect(extractOrderToken(`http://localhost:5173/order/${t32}?x=1`)).toBe(t32)
  })

  it("returns undefined for a URL without an order token", () => {
    expect(extractOrderToken("https://shop.example/")).toBeUndefined()
    expect(extractOrderToken("https://shop.example/collections/drop")).toBeUndefined()
  })

  it("does not match a token shorter or longer than 32 hex chars", () => {
    expect(extractOrderToken("/order/abc123")).toBeUndefined()
    expect(extractOrderToken("/order/0123456789abcdef0123456789abcdef00")).toBe(
      "0123456789abcdef0123456789abcdef"
    ) // matches the first 32 valid hex chars, extra chars simply aren't included
  })

  it("does not match uppercase hex (tokens are generated lowercase)", () => {
    const upper = "ABCDEF0123456789ABCDEF0123456789"
    expect(extractOrderToken(`/order/${upper}`)).toBeUndefined()
  })

  it("returns undefined for null/empty input rather than throwing", () => {
    expect(extractOrderToken(null)).toBeUndefined()
    expect(extractOrderToken(undefined)).toBeUndefined()
    expect(extractOrderToken("")).toBeUndefined()
  })
})
