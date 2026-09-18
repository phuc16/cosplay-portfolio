import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import repo from "../shop/reviews/reviewRepo.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = {
  buyer_name: "Nguyễn Văn A", phone: "0900000000", email: "a@example.com",
  address_raw: "1 Đường ABC, Q1, TP.HCM",
}

async function seedProduct() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { pid, variantId: v.id }
}

async function seedOrder(variantId) {
  return orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
}

beforeEach(async () => {
  await resetTables("reviews", "order_items", "orders", "product_variants", "products", "collections")
})

describe("maskBuyerName", () => {
  it("keeps a single-word name verbatim", () => {
    expect(repo.maskBuyerName("Linh")).toBe("Linh")
  })

  it("masks the second word down to its first letter", () => {
    expect(repo.maskBuyerName("Nguyễn Văn A")).toBe("Nguyễn V***")
  })

  it("handles a two-word name", () => {
    expect(repo.maskBuyerName("Trần Linh")).toBe("Trần L***")
  })

  it("returns an empty string for blank input", () => {
    expect(repo.maskBuyerName("")).toBe("")
    expect(repo.maskBuyerName(null)).toBe("")
  })

  it("collapses extra whitespace before masking", () => {
    expect(repo.maskBuyerName("  Nguyễn   Văn A  ")).toBe("Nguyễn V***")
  })
})

describe("validateShape", () => {
  it("accepts a rating 1-5 with no comment", () => {
    expect(repo.validateShape({ rating: 3 })).toBeNull()
  })

  it("rejects a rating outside 1-5", () => {
    expect(repo.validateShape({ rating: 0 })).toBeTruthy()
    expect(repo.validateShape({ rating: 6 })).toBeTruthy()
  })

  it("rejects a non-integer rating", () => {
    expect(repo.validateShape({ rating: 3.5 })).toBeTruthy()
  })

  it("rejects a comment over the length cap", () => {
    expect(repo.validateShape({ rating: 5, comment: "x".repeat(1001) })).toBeTruthy()
  })

  it("accepts a comment at exactly the cap", () => {
    expect(repo.validateShape({ rating: 5, comment: "x".repeat(1000) })).toBeNull()
  })
})

describe("createReview", () => {
  it("creates a review and returns its id", async () => {
    const { pid, variantId } = await seedProduct()
    const order = await seedOrder(variantId)
    const id = await repo.createReview({
      orderId: order.id, productId: pid, buyerName: "Nguyễn Văn A", rating: 5, comment: "Great!",
    })
    const [[row]] = await db.query("SELECT * FROM reviews WHERE id = ?", [id])
    expect(row.rating).toBe(5)
    expect(row.comment).toBe("Great!")
    expect(row.buyer_name).toBe("Nguyễn Văn A") // unmasked at rest
  })

  it("rejects an invalid shape before ever touching the DB", async () => {
    const { pid, variantId } = await seedProduct()
    const order = await seedOrder(variantId)
    await expect(
      repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 9 })
    ).rejects.toThrow(repo.InvalidReviewInputError)
  })

  it("rejects a second review for the same (order, product) pair", async () => {
    const { pid, variantId } = await seedProduct()
    const order = await seedOrder(variantId)
    await repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 5 })
    await expect(
      repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 3 })
    ).rejects.toThrow(repo.DuplicateReviewError)
  })

  it("allows the same buyer to review the same product from a different order", async () => {
    const { pid, variantId } = await seedProduct()
    const order1 = await seedOrder(variantId)
    const order2 = await seedOrder(variantId)
    await repo.createReview({ orderId: order1.id, productId: pid, buyerName: "A", rating: 5 })
    await expect(
      repo.createReview({ orderId: order2.id, productId: pid, buyerName: "A", rating: 4 })
    ).resolves.toBeTruthy()
  })

  it("trims and caps the comment", async () => {
    const { pid, variantId } = await seedProduct()
    const order = await seedOrder(variantId)
    const id = await repo.createReview({
      orderId: order.id, productId: pid, buyerName: "A", rating: 5, comment: "  hi  ",
    })
    const [[row]] = await db.query("SELECT comment FROM reviews WHERE id = ?", [id])
    expect(row.comment).toBe("hi")
  })
})

describe("listProductReviews", () => {
  it("returns newest first, with buyer_name masked", async () => {
    const { pid, variantId } = await seedProduct()
    const order1 = await seedOrder(variantId)
    const order2 = await seedOrder(variantId)
    await repo.createReview({ orderId: order1.id, productId: pid, buyerName: "Nguyễn Văn A", rating: 4 })
    await repo.createReview({ orderId: order2.id, productId: pid, buyerName: "Trần Thị B", rating: 5 })

    const rows = await repo.listProductReviews(pid)
    expect(rows).toHaveLength(2)
    expect(rows[0].buyer_name).toBe("Trần T***")
    expect(rows[1].buyer_name).toBe("Nguyễn V***")
  })

  it("returns an empty array for a product with no reviews", async () => {
    const { pid } = await seedProduct()
    expect(await repo.listProductReviews(pid)).toEqual([])
  })

  it("respects the limit", async () => {
    const { pid, variantId } = await seedProduct()
    for (let i = 0; i < 3; i++) {
      const order = await seedOrder(variantId)
      await repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 5 })
    }
    expect(await repo.listProductReviews(pid, 2)).toHaveLength(2)
  })
})

describe("getProductRatingSummary", () => {
  it("returns count 0 / average 0 for a product with no reviews", async () => {
    const { pid } = await seedProduct()
    expect(await repo.getProductRatingSummary(pid)).toEqual({ count: 0, average: 0 })
  })

  it("computes count and rounded average", async () => {
    const { pid, variantId } = await seedProduct()
    const ratings = [5, 4, 4]
    for (const rating of ratings) {
      const order = await seedOrder(variantId)
      await repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating })
    }
    const summary = await repo.getProductRatingSummary(pid)
    expect(summary.count).toBe(3)
    expect(summary.average).toBe(4.3) // (5+4+4)/3 = 4.333... rounded to 4.3
  })
})

describe("deleteReview", () => {
  it("deletes an existing review and reports success", async () => {
    const { pid, variantId } = await seedProduct()
    const order = await seedOrder(variantId)
    const id = await repo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 5 })

    expect(await repo.deleteReview(id)).toBe(true)
    const [rows] = await db.query("SELECT id FROM reviews WHERE id = ?", [id])
    expect(rows).toHaveLength(0)
  })

  it("reports false for an unknown id rather than throwing", async () => {
    expect(await repo.deleteReview(999999)).toBe(false)
  })
})
