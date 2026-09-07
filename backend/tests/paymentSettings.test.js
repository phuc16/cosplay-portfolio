import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/payments/settingsRepo.js"

beforeEach(async () => {
  await db.query("DELETE FROM payment_settings")
})

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await repo.getSettings()
    expect(s.bank_enabled).toBe(false)
    expect(s.cod_enabled).toBe(false)
  })
})

describe("updateSettings", () => {
  it("persists bank details and survives a reload", async () => {
    await repo.updateSettings({
      bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
      bank_account_number: "123456789", bank_account_holder: "NGUYEN VAN A",
    })
    const s = await repo.getSettings()
    expect(s.bank_enabled).toBe(true)
    expect(s.bank_bin).toBe("970416")
  })

  it("keeps a single row rather than inserting repeatedly", async () => {
    await repo.updateSettings({ bank_enabled: true })
    await repo.updateSettings({ bank_enabled: false })
    const [rows] = await db.query("SELECT id FROM payment_settings")
    expect(rows).toHaveLength(1)
  })
})

describe("enabledMethods", () => {
  it("lists only enabled methods", () => {
    expect(repo.enabledMethods({
      bank_enabled: true, momo_enabled: false, paypal_enabled: false, cod_enabled: true,
    })).toEqual(["bank", "cod"])
  })

  it("returns nothing when all are off", () => {
    expect(repo.enabledMethods({
      bank_enabled: false, momo_enabled: false, paypal_enabled: false, cod_enabled: false,
    })).toEqual([])
  })
})

describe("publicSettings", () => {
  it("passes settings through unchanged — there are no secret fields to strip", () => {
    const pub = repo.publicSettings({
      bank_enabled: true, bank_name: "ACB", bank_account_number: "123",
    })
    expect(pub.bank_name).toBe("ACB")
    expect(pub.bank_account_number).toBe("123")
  })
})
