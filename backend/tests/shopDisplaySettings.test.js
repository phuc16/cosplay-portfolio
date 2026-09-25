import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import repo from "../shop/shopDisplaySettings.js"

beforeEach(async () => {
  await db.query("DELETE FROM shop_display_settings")
})

afterAll(async () => {
  await db.query("DELETE FROM shop_display_settings")
})

describe("getGroupOrder", () => {
  it("returns the default order when nothing is stored", async () => {
    expect(await repo.getGroupOrder()).toEqual(["gacha", "digital", "physical"])
  })

  it("falls back to the default if the stored value is somehow corrupt", async () => {
    await db.query("INSERT INTO shop_display_settings (group_order) VALUES (?)", [JSON.stringify(["gacha", "digital"])])
    expect(await repo.getGroupOrder()).toEqual(["gacha", "digital", "physical"])
  })
})

describe("updateGroupOrder", () => {
  it("persists a custom order and survives a reload", async () => {
    await repo.updateGroupOrder(["physical", "digital", "gacha"])
    expect(await repo.getGroupOrder()).toEqual(["physical", "digital", "gacha"])
  })

  it("keeps a single row rather than inserting repeatedly", async () => {
    await repo.updateGroupOrder(["physical", "gacha", "digital"])
    await repo.updateGroupOrder(["digital", "gacha", "physical"])
    const [rows] = await db.query("SELECT id FROM shop_display_settings")
    expect(rows).toHaveLength(1)
  })

  it("rejects a list that isn't a permutation of the three known groups", async () => {
    await expect(repo.updateGroupOrder(["gacha", "digital"])).rejects.toThrow()
    await expect(repo.updateGroupOrder(["gacha", "digital", "physical", "digital"])).rejects.toThrow()
    await expect(repo.updateGroupOrder(["gacha", "digital", "nope"])).rejects.toThrow()
  })
})

describe("isValidOrder", () => {
  it("accepts any permutation of the three keys", () => {
    expect(repo.isValidOrder(["gacha", "digital", "physical"])).toBe(true)
    expect(repo.isValidOrder(["physical", "gacha", "digital"])).toBe(true)
  })

  it("rejects duplicates, missing keys, or unknown keys", () => {
    expect(repo.isValidOrder(["gacha", "gacha", "physical"])).toBe(false)
    expect(repo.isValidOrder(["gacha", "digital"])).toBe(false)
    expect(repo.isValidOrder(["gacha", "digital", "booth"])).toBe(false)
    expect(repo.isValidOrder(null)).toBe(false)
  })
})
