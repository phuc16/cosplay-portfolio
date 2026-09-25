import { describe, it, expect, beforeEach, afterAll } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import statsRepo from "../shop/stats/statsRepo.js"
import prizeRepo from "../shop/gacha/prizeRepo.js"
import sessionRepo from "../shop/gacha/sessionRepo.js"
import { resetTables, closeDb } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedGachaProduct(prizes, { price = 20000 } = {}) {
  const cid = await catalog.createCollection({ title: "Festival Gacha", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Mystery Case", price, type: "gacha" })
  await prizeRepo.replacePrizes(pid, prizes)
  return { collectionId: cid, productId: pid }
}

async function hiddenVariantId(productId) {
  const [[row]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [productId])
  return row.id
}

async function drawOnline(productId, turns) {
  const variantId = await hiddenVariantId(productId)
  const order = await orders.createOrder({
    items: [{ variant_id: variantId, qty: turns }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(order.id, "confirmed")
  await sessionRepo.startOnlineSessionIfNeeded(order.id)
  const session = await sessionRepo.getSessionByOrderId(order.id)
  for (let i = 0; i < turns; i++) {
    await sessionRepo.drawForSession(session.id, { drawKey: `online-${order.id}-${i}` })
  }
  return order.id
}

async function drawBooth(productId, turns) {
  const { sessionId } = await sessionRepo.startBoothSession({ productId, buyerName: "Khách", turnsTotal: turns })
  for (let i = 0; i < turns; i++) {
    await sessionRepo.drawForSession(sessionId, { drawKey: `booth-${sessionId}-${i}` })
  }
}

beforeEach(async () => {
  await resetTables("gacha_draws", "gacha_sessions", "gacha_prizes", "order_items", "orders", "product_variants", "products", "collections")
})

afterAll(closeDb)

describe("getGachaDropStats", () => {
  it("returns null for an unknown product id", async () => {
    expect(await statsRepo.getGachaDropStats(999999)).toBeNull()
  })

  it("returns null for a product that exists but isn't type gacha", async () => {
    const cid = await catalog.createCollection({ title: "Physical", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Poster", price: 35000, type: "physical" })
    expect(await statsRepo.getGachaDropStats(pid)).toBeNull()
  })

  it("returns a zero state for a gacha product with no draws yet", async () => {
    const { productId } = await seedGachaProduct([
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
    ])
    const stats = await statsRepo.getGachaDropStats(productId)
    expect(stats.prizes).toHaveLength(1)
    expect(stats.prizes[0]).toMatchObject({ drawn_online: 0, drawn_booth: 0, quantity_remaining: 10 })
    expect(stats.revenue).toEqual({ online: 0, booth: 0, total: 0 })
    expect(stats.value_given_out).toEqual({ online: 0, booth: 0, total: 0 })
  })

  it("splits per-prize drawn counts by channel", async () => {
    const { productId } = await seedGachaProduct([
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
    ])
    await drawOnline(productId, 2)
    await drawBooth(productId, 3)

    const stats = await statsRepo.getGachaDropStats(productId)
    expect(stats.prizes[0].drawn_online).toBe(2)
    expect(stats.prizes[0].drawn_booth).toBe(3)
    expect(stats.prizes[0].quantity_remaining).toBe(5)
  })

  it("rolls up drawn counts and value by tier, combining every prize in that tier", async () => {
    const { productId } = await seedGachaProduct([
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
      { name: "Postcard", tier: "common", display_price: 3000, quantity_total: 10 },
      { name: "Figure", tier: "legendary", display_price: 500000, quantity_total: 1 },
    ])
    await drawOnline(productId, 3) // draws whatever the weighted pick lands on - just assert totals below
    const stats = await statsRepo.getGachaDropStats(productId)

    const totalDrawnAcrossTiers = stats.tiers.reduce((sum, t) => sum + t.drawn_online + t.drawn_booth, 0)
    expect(totalDrawnAcrossTiers).toBe(3)
    const totalValueAcrossTiers = stats.tiers.reduce((sum, t) => sum + t.value_online + t.value_booth, 0)
    const totalPrizeValue = stats.prizes.reduce((sum, p) => sum + p.display_price * (p.drawn_online + p.drawn_booth), 0)
    expect(totalValueAcrossTiers).toBe(totalPrizeValue)
  })

  it("splits revenue by channel - online from the purchase line, booth from the session's order total", async () => {
    const { productId } = await seedGachaProduct(
      [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }],
      { price: 20000 }
    )
    await drawOnline(productId, 2) // 2 turns * 20000
    await drawBooth(productId, 3) // 3 turns * 20000

    const stats = await statsRepo.getGachaDropStats(productId)
    expect(stats.revenue.online).toBe(40000)
    expect(stats.revenue.booth).toBe(60000)
    expect(stats.revenue.total).toBe(100000)
  })

  it("does not count a cancelled order's revenue", async () => {
    const { productId } = await seedGachaProduct(
      [{ name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 }],
      { price: 20000 }
    )
    const variantId = await hiddenVariantId(productId)
    const order = await orders.createOrder({
      items: [{ variant_id: variantId, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(order.id, "cancelled")

    const stats = await statsRepo.getGachaDropStats(productId)
    expect(stats.revenue.online).toBe(0)
  })

  it("keeps drawn history even if the paying order is later cancelled (immutable drawn count)", async () => {
    const { productId } = await seedGachaProduct([
      { name: "Sticker", tier: "common", display_price: 5000, quantity_total: 10 },
    ])
    const orderId = await drawOnline(productId, 1)
    await orders.transitionOrder(orderId, "cancelled")

    const stats = await statsRepo.getGachaDropStats(productId)
    expect(stats.prizes[0].drawn_online).toBe(1)
  })

  it("scopes booth revenue to this exact product, not the whole collection", async () => {
    const cid = await catalog.createCollection({ title: "Shared Collection", status: "active" })
    const pidA = await catalog.createProduct({ collection_id: cid, name: "Case A", price: 20000, type: "gacha" })
    const pidB = await catalog.createProduct({ collection_id: cid, name: "Case B", price: 50000, type: "gacha" })
    await prizeRepo.replacePrizes(pidA, [{ name: "R", tier: "common", display_price: 1000, quantity_total: 10 }])
    await prizeRepo.replacePrizes(pidB, [{ name: "R", tier: "common", display_price: 1000, quantity_total: 10 }])

    await drawBooth(pidA, 1)
    await drawBooth(pidB, 2)

    const statsA = await statsRepo.getGachaDropStats(pidA)
    const statsB = await statsRepo.getGachaDropStats(pidB)
    expect(statsA.revenue.booth).toBe(20000)
    expect(statsB.revenue.booth).toBe(100000)
  })
})
