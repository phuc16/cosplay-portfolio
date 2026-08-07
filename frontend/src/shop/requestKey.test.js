import { describe, it, expect } from "vitest"
import { generateRequestKey } from "./requestKey"

describe("generateRequestKey", () => {
  it("returns a real UUID when crypto.randomUUID is available, without recursing or throwing", () => {
    expect(typeof crypto.randomUUID).toBe("function")

    let key
    expect(() => {
      key = generateRequestKey()
    }).not.toThrow()

    expect(typeof key).toBe("string")
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it("falls back to a 32-char hex-ish string when crypto.randomUUID is unavailable", () => {
    const original = crypto.randomUUID
    crypto.randomUUID = undefined

    let key
    try {
      expect(() => {
        key = generateRequestKey()
      }).not.toThrow()
    } finally {
      crypto.randomUUID = original
    }

    expect(typeof key).toBe("string")
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it("returns different values on consecutive calls", () => {
    const a = generateRequestKey()
    const b = generateRequestKey()
    expect(a).not.toBe(b)
  })
})
