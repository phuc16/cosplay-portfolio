import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/coupons/couponRepo.js"

beforeEach(async () => {
  await db.query("DELETE FROM coupons")
})

describe("createCoupon", () => {
  it("creates a percent coupon, normalizing code to uppercase", async () => {
    const id = await repo.createCoupon({ code: "save10", type: "percent", value: 10 })
    const [[row]] = await db.query("SELECT * FROM coupons WHERE id = ?", [id])
    expect(row.code).toBe("SAVE10")
    expect(row.type).toBe("percent")
    expect(row.value).toBe(10)
    expect(row.active).toBe(1)
    expect(row.times_used).toBe(0)
  })

  it("rejects a missing code", async () => {
    await expect(repo.createCoupon({ type: "percent", value: 10 })).rejects.toThrow(repo.InvalidCouponInputError)
  })

  it("rejects an invalid type", async () => {
    await expect(repo.createCoupon({ code: "X", type: "bogus", value: 10 })).rejects.toThrow(repo.InvalidCouponInputError)
  })

  it("rejects a non-positive value", async () => {
    await expect(repo.createCoupon({ code: "X", type: "fixed", value: 0 })).rejects.toThrow(repo.InvalidCouponInputError)
  })

  it("rejects a percent value over 100", async () => {
    await expect(repo.createCoupon({ code: "X", type: "percent", value: 101 })).rejects.toThrow(repo.InvalidCouponInputError)
  })

  it("rejects a duplicate code with a clean error, not a raw constraint violation", async () => {
    await repo.createCoupon({ code: "SAVE10", type: "percent", value: 10 })
    await expect(repo.createCoupon({ code: "save10", type: "fixed", value: 5000 })).rejects.toThrow(repo.DuplicateCouponCodeError)
  })

  it("accepts optional min_total/max_uses/expires_at", async () => {
    const id = await repo.createCoupon({
      code: "BIG", type: "fixed", value: 20000, min_total: 100000, max_uses: 5, expires_at: "2026-12-31 00:00:00",
    })
    const [[row]] = await db.query("SELECT * FROM coupons WHERE id = ?", [id])
    expect(row.min_total).toBe(100000)
    expect(row.max_uses).toBe(5)
    expect(row.expires_at).toBeTruthy()
  })

  it("defaults min_total to 0 and max_uses to unlimited (null)", async () => {
    const id = await repo.createCoupon({ code: "X", type: "fixed", value: 1000 })
    const [[row]] = await db.query("SELECT * FROM coupons WHERE id = ?", [id])
    expect(row.min_total).toBe(0)
    expect(row.max_uses).toBeNull()
  })
})

describe("updateCoupon", () => {
  it("flips active without needing to resend the whole shape", async () => {
    const id = await repo.createCoupon({ code: "X", type: "fixed", value: 1000 })
    await repo.updateCoupon(id, { active: false })
    const [[row]] = await db.query("SELECT active FROM coupons WHERE id = ?", [id])
    expect(row.active).toBe(0)
  })

  it("edits value/min_total/max_uses", async () => {
    const id = await repo.createCoupon({ code: "X", type: "fixed", value: 1000 })
    await repo.updateCoupon(id, { value: 2000, min_total: 50000, max_uses: 10 })
    const [[row]] = await db.query("SELECT * FROM coupons WHERE id = ?", [id])
    expect(row.value).toBe(2000)
    expect(row.min_total).toBe(50000)
    expect(row.max_uses).toBe(10)
  })

  it("re-validates when type/value/code change, rejecting a bad new shape", async () => {
    const id = await repo.createCoupon({ code: "X", type: "percent", value: 10 })
    await expect(repo.updateCoupon(id, { value: 200 })).rejects.toThrow(repo.InvalidCouponInputError)
  })

  it("clears max_uses back to unlimited when sent null", async () => {
    const id = await repo.createCoupon({ code: "X", type: "fixed", value: 1000, max_uses: 5 })
    await repo.updateCoupon(id, { max_uses: null })
    const [[row]] = await db.query("SELECT max_uses FROM coupons WHERE id = ?", [id])
    expect(row.max_uses).toBeNull()
  })
})

describe("listCoupons", () => {
  it("returns newest first", async () => {
    const first = await repo.createCoupon({ code: "A", type: "fixed", value: 1000 })
    const second = await repo.createCoupon({ code: "B", type: "fixed", value: 1000 })
    const rows = await repo.listCoupons()
    expect(rows.map((r) => r.id)).toEqual([second, first])
  })
})

describe("getCouponByCode", () => {
  it("is case-insensitive", async () => {
    await repo.createCoupon({ code: "SaVe10", type: "percent", value: 10 })
    expect(await repo.getCouponByCode("save10")).toBeTruthy()
    expect(await repo.getCouponByCode("SAVE10")).toBeTruthy()
  })

  it("returns null for an unknown code", async () => {
    expect(await repo.getCouponByCode("NOPE")).toBeNull()
  })
})

describe("checkEligibility", () => {
  const base = { active: true, expires_at: null, max_uses: null, times_used: 0, min_total: 0 }

  it("reports not_found for a missing coupon", () => {
    expect(repo.checkEligibility(null, 100000)).toEqual({ ok: false, reason: "not_found" })
  })

  it("reports inactive", () => {
    expect(repo.checkEligibility({ ...base, active: false }, 100000)).toEqual({ ok: false, reason: "inactive" })
  })

  it("reports expired", () => {
    const past = new Date(Date.now() - 1000)
    expect(repo.checkEligibility({ ...base, expires_at: past }, 100000)).toEqual({ ok: false, reason: "expired" })
  })

  it("does not report expired for a future expires_at", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60)
    expect(repo.checkEligibility({ ...base, expires_at: future }, 100000)).toEqual({ ok: true })
  })

  it("reports limit_reached when times_used has caught up to max_uses", () => {
    expect(repo.checkEligibility({ ...base, max_uses: 5, times_used: 5 }, 100000)).toEqual({ ok: false, reason: "limit_reached" })
  })

  it("allows a max_uses coupon with uses remaining", () => {
    expect(repo.checkEligibility({ ...base, max_uses: 5, times_used: 4 }, 100000)).toEqual({ ok: true })
  })

  it("reports min_total_not_met", () => {
    expect(repo.checkEligibility({ ...base, min_total: 200000 }, 100000)).toEqual({ ok: false, reason: "min_total_not_met" })
  })

  it("ok when every condition passes", () => {
    expect(repo.checkEligibility({ ...base, min_total: 50000 }, 100000)).toEqual({ ok: true })
  })
})

describe("computeDiscount", () => {
  it("computes a percent discount, rounding down", () => {
    expect(repo.computeDiscount({ type: "percent", value: 10 }, 105000)).toBe(10500)
    expect(repo.computeDiscount({ type: "percent", value: 33 }, 100), 100).toBe(33)
  })

  it("rounds a percent discount down to 0 rather than throwing on a tiny subtotal", () => {
    expect(repo.computeDiscount({ type: "percent", value: 1 }, 50)).toBe(0)
  })

  it("computes a fixed discount", () => {
    expect(repo.computeDiscount({ type: "fixed", value: 20000 }, 105000)).toBe(20000)
  })

  it("clamps a fixed discount to the subtotal - never goes negative", () => {
    expect(repo.computeDiscount({ type: "fixed", value: 200000 }, 105000)).toBe(105000)
  })
})
