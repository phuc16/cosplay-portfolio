import { describe, it, expect } from "vitest"
import { slugify, uniqueSlug } from "../shop/slug.js"

describe("slugify", () => {
  it("lowercases and hyphenates plain text", () => {
    expect(slugify("Summer Collection 2026")).toBe("summer-collection-2026")
  })

  it("strips Vietnamese diacritics", () => {
    expect(slugify("Bộ sưu tập Hè")).toBe("bo-suu-tap-he")
  })

  it("converts đ and Đ to d", () => {
    expect(slugify("Đặt trước Đồ")).toBe("dat-truoc-do")
  })

  it("drops punctuation and collapses separators", () => {
    expect(slugify("[PRE-ORD] KAMI's MERCH!! @ HH2026")).toBe("pre-ord-kami-s-merch-hh2026")
  })

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --hello--  ")).toBe("hello")
  })

  it("falls back to 'collection' when nothing survives", () => {
    expect(slugify("!!!")).toBe("collection")
  })
})

describe("uniqueSlug", () => {
  it("returns the base when unused", () => {
    expect(uniqueSlug("summer", [])).toBe("summer")
  })

  it("appends a counter when taken", () => {
    expect(uniqueSlug("summer", ["summer"])).toBe("summer-2")
  })

  it("skips over multiple collisions", () => {
    expect(uniqueSlug("summer", ["summer", "summer-2", "summer-3"])).toBe("summer-4")
  })
})
