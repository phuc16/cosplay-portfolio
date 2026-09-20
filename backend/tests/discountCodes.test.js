import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/discountCodes.js"

beforeEach(async () => {
  await db.query("DELETE FROM discount_codes")
})

describe("normalizeCode", () => {
  it("trims and uppercases", () => {
    expect(repo.normalizeCode("  abc123 ")).toBe("ABC123")
  })

  it("handles null/undefined/empty", () => {
    expect(repo.normalizeCode(null)).toBe("")
    expect(repo.normalizeCode(undefined)).toBe("")
    expect(repo.normalizeCode("")).toBe("")
  })
})

describe("evaluateCode", () => {
  const base = {
    code: "ABC", type: "percent", value: 10, enabled: true,
    max_uses: null, used_count: 0, min_total: 0, expires_at: null,
  }

  it("reports not_found for a missing row", () => {
    expect(repo.evaluateCode(null, 100000)).toEqual({ ok: false, reason: "not_found" })
  })

  it("reports disabled", () => {
    expect(repo.evaluateCode({ ...base, enabled: false }, 100000)).toEqual({ ok: false, reason: "disabled" })
  })

  it("reports expired", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    const row = { ...base, expires_at: new Date("2025-12-31T00:00:00Z") }
    expect(repo.evaluateCode(row, 100000, now)).toEqual({ ok: false, reason: "expired" })
  })

  it("does not report expired for a future expires_at", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    const row = { ...base, expires_at: new Date("2026-01-02T00:00:00Z") }
    expect(repo.evaluateCode(row, 100000, now).ok).toBe(true)
  })

  it("reports exhausted when used_count has reached max_uses", () => {
    const row = { ...base, max_uses: 3, used_count: 3 }
    expect(repo.evaluateCode(row, 100000)).toEqual({ ok: false, reason: "exhausted" })
  })

  it("does not report exhausted below max_uses", () => {
    const row = { ...base, max_uses: 3, used_count: 2 }
    expect(repo.evaluateCode(row, 100000).ok).toBe(true)
  })

  it("reports below_minimum", () => {
    const row = { ...base, min_total: 200000 }
    expect(repo.evaluateCode(row, 100000)).toEqual({ ok: false, reason: "below_minimum" })
  })

  it("computes a percent discount", () => {
    const row = { ...base, type: "percent", value: 10 }
    expect(repo.evaluateCode(row, 100000)).toEqual({ ok: true, amount: 10000 })
  })

  it("floors a percent discount that doesn't divide evenly", () => {
    const row = { ...base, type: "percent", value: 33 }
    expect(repo.evaluateCode(row, 100000)).toEqual({ ok: true, amount: 33000 })
    const row2 = { ...base, type: "percent", value: 33 }
    expect(repo.evaluateCode(row2, 10000)).toEqual({ ok: true, amount: 3300 })
  })

  it("computes a fixed discount", () => {
    const row = { ...base, type: "fixed", value: 15000 }
    expect(repo.evaluateCode(row, 100000)).toEqual({ ok: true, amount: 15000 })
  })

  it("clamps a 100%-off percent code to exactly the subtotal", () => {
    const row = { ...base, type: "percent", value: 100 }
    expect(repo.evaluateCode(row, 73000)).toEqual({ ok: true, amount: 73000 })
  })

  it("clamps a fixed code larger than the subtotal to the subtotal, never negative", () => {
    const row = { ...base, type: "fixed", value: 500000 }
    expect(repo.evaluateCode(row, 73000)).toEqual({ ok: true, amount: 73000 })
  })
})

describe("validate", () => {
  const valid = { code: "ABC", type: "percent", value: 10 }

  it("accepts a minimal valid payload", () => {
    expect(repo.validate(valid)).toBeNull()
  })

  it("rejects a missing code", () => {
    expect(repo.validate({ ...valid, code: "  " })).toMatch(/mã giảm giá/i)
  })

  it("rejects an invalid type", () => {
    expect(repo.validate({ ...valid, type: "bogus" })).toMatch(/loại giảm giá/i)
  })

  it("rejects a non-positive value", () => {
    expect(repo.validate({ ...valid, value: 0 })).toMatch(/giá trị/i)
    expect(repo.validate({ ...valid, value: -5 })).toMatch(/giá trị/i)
  })

  it("rejects a percent value over 100", () => {
    expect(repo.validate({ ...valid, type: "percent", value: 150 })).toMatch(/phần trăm/i)
  })

  it("allows a fixed value over 100", () => {
    expect(repo.validate({ ...valid, type: "fixed", value: 150000 })).toBeNull()
  })

  it("rejects a non-positive max_uses when provided", () => {
    expect(repo.validate({ ...valid, max_uses: 0 })).toMatch(/lượt sử dụng/i)
  })

  it("allows a null/omitted max_uses (unlimited)", () => {
    expect(repo.validate({ ...valid, max_uses: null })).toBeNull()
  })

  it("rejects a negative min_total", () => {
    expect(repo.validate({ ...valid, min_total: -1 })).toMatch(/mức đơn tối thiểu/i)
  })

  it("rejects an unparsable expires_at", () => {
    expect(repo.validate({ ...valid, expires_at: "not-a-date" })).toMatch(/ngày hết hạn/i)
  })
})

describe("CRUD", () => {
  it("creates and lists a code, normalized to uppercase", async () => {
    await repo.createCode({ code: "launch10", type: "percent", value: 10 })
    const list = await repo.listCodes()
    expect(list).toHaveLength(1)
    expect(list[0].code).toBe("LAUNCH10")
    expect(list[0].enabled).toBe(true)
    expect(list[0].used_count).toBe(0)
  })

  it("rejects a duplicate code, case-insensitively", async () => {
    await repo.createCode({ code: "ABC123", type: "percent", value: 10 })
    await expect(repo.createCode({ code: "abc123", type: "fixed", value: 5000 })).rejects.toThrow(repo.DuplicateCodeError)
  })

  it("updates an existing code, including toggling enabled", async () => {
    const created = await repo.createCode({ code: "ABC", type: "percent", value: 10, enabled: true })
    const updated = await repo.updateCode(created.id, { code: "ABC", type: "percent", value: 10, enabled: false })
    expect(updated.enabled).toBe(false)
    const reread = await repo.getCodeById(created.id)
    expect(reread.enabled).toBe(false)
  })

  it("returns null when updating a nonexistent id", async () => {
    expect(await repo.updateCode(999999, { code: "X", type: "percent", value: 10 })).toBeNull()
  })

  it("deletes a code with no guard", async () => {
    const created = await repo.createCode({ code: "ABC", type: "percent", value: 10 })
    expect(await repo.deleteCode(created.id)).toBe(true)
    expect(await repo.getCodeById(created.id)).toBeNull()
  })

  it("reports false deleting a nonexistent id", async () => {
    expect(await repo.deleteCode(999999)).toBe(false)
  })
})

describe("previewCode", () => {
  it("evaluates a stored code without mutating used_count", async () => {
    const created = await repo.createCode({ code: "TENOFF", type: "fixed", value: 10000, min_total: 50000 })
    const result = await repo.previewCode("tenoff", 100000)
    expect(result.ok).toBe(true)
    expect(result.amount).toBe(10000)
    const reread = await repo.getCodeById(created.id)
    expect(reread.used_count).toBe(0)
  })

  it("returns not_found for an unknown code", async () => {
    const result = await repo.previewCode("NOPE", 100000)
    expect(result).toEqual({ ok: false, reason: "not_found", row: null })
  })
})
