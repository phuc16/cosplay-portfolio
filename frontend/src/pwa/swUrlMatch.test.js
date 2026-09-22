import { describe, it, expect } from "vitest"
import { isApiRequest } from "./swUrlMatch"

describe("isApiRequest", () => {
  it("matches an absolute API URL", () => {
    expect(isApiRequest("https://example.com/api/shop/collections")).toBe(true)
  })

  it("matches a bare /api/ path resolved against a base", () => {
    expect(isApiRequest("http://localhost:5173/api/gallery")).toBe(true)
  })

  it("does not match a non-API asset", () => {
    expect(isApiRequest("https://example.com/assets/index-abc123.js")).toBe(false)
  })

  it("does not match the root document", () => {
    expect(isApiRequest("https://example.com/")).toBe(false)
  })

  it("does not false-positive on a path merely containing 'api' elsewhere", () => {
    expect(isApiRequest("https://example.com/therapist/photo.png")).toBe(false)
  })
})
