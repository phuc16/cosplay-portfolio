import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

async function seedGachaProduct() {
  const cid = await catalog.createCollection({ title: "Festival Gacha", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price: 20000, type: "gacha" })
  return pid
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("replacePrizes", () => {
  it("inserts new prizes with quantity_remaining seeded to quantity_total", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
      { name: "Figure", tier: "legendary", display_price: 500000, quantity_total: 1 },
    ])
    const rows = await prizeRepo.listPrizes(pid)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.name === "Sticker").quantity_remaining).toBe(10)
    expect(rows.find((r) => r.name === "Figure").quantity_remaining).toBe(1)
  })

  it("updates an existing prize in place by id, preserving quantity_remaining minus any drawn", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const [prize] = await prizeRepo.listPrizes(pid)
    // Simulate one draw having happened.
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 9 WHERE id = ?", [prize.id])

    await prizeRepo.replacePrizes(pid, [{ id: prize.id, name: "Sticker v2", tier: "rare", display_price: 6000, quantity_total: 20 }])

    const [updated] = await prizeRepo.listPrizes(pid)
    expect(updated.name).toBe("Sticker v2")
    expect(updated.tier).toBe("rare")
    // 20 total - 10 original = +10 added to whatever remained (9) = 19.
    expect(updated.quantity_remaining).toBe(19)
  })

  it("rejects reducing quantity_total below what has already been drawn", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    const [prize] = await prizeRepo.listPrizes(pid)
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 2 WHERE id = ?", [prize.id])

    await expect(
      prizeRepo.replacePrizes(pid, [{ id: prize.id, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 5 }])
    ).rejects.toThrow(prizeRepo.GachaPrizeQuantityError)
  })

  it("rejects deleting (omitting) a prize that has already had draws against it", async () => {
    const pid = await seedGachaProduct()
    await prizeRepo.replacePrizes(pid, [
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
      { name: "Figure", tier: "legendary", display_price: 500000, quantity_total: 1 },
    ])
    const rows = await prizeRepo.listPrizes(pid)
    const figure = rows.find((r) => r.name === "Figure")
    await db.query("UPDATE gacha_prizes SET quantity_remaining = 0 WHERE id = ?", [figure.id])

    const sticker = rows.find((r) => r.name === "Sticker")
    await expect(
      prizeRepo.replacePrizes(pid, [{ id: sticker.id, name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }])
    ).rejects.toThrow(prizeRepo.GachaPrizeQuantityError)
  })
})
