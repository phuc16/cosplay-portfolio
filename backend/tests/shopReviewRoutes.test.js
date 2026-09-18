import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import reviewRepo from "../shop/reviews/reviewRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "Nguyễn Văn A", phone: "09", email: "a@example.com", address_raw: "x" }

async function seedProduct() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  return { pid, variantId: v.id }
}

async function seedOrderId(variantId) {
  const res = await orders.createOrder({
    items: [{ variant_id: variantId, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  return res.id
}

beforeEach(async () => {
  await resetTables("reviews", "email_queue", "order_items", "orders", "product_variants", "products", "collections")
})

describe("GET /api/shop/products/:id/reviews", () => {
  it("returns an empty shape for a product with no reviews", async () => {
    const { pid } = await seedProduct()
    const res = await request(app).get(`/api/shop/products/${pid}/reviews`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ summary: { count: 0, average: 0 }, reviews: [] })
  })

  it("returns the aggregate and masked-name reviews", async () => {
    const { pid, variantId } = await seedProduct()
    const orderId1 = await seedOrderId(variantId)
    const orderId2 = await seedOrderId(variantId)
    await reviewRepo.createReview({ orderId: orderId1, productId: pid, buyerName: "Nguyễn Văn A", rating: 5, comment: "Tốt" })
    await reviewRepo.createReview({ orderId: orderId2, productId: pid, buyerName: "Trần Thị B", rating: 3 })

    const res = await request(app).get(`/api/shop/products/${pid}/reviews`)
    expect(res.body.summary.count).toBe(2)
    expect(res.body.summary.average).toBe(4)
    expect(res.body.reviews.map((r) => r.buyer_name)).toEqual(["Trần T***", "Nguyễn V***"])
    expect(res.body.reviews[1].comment).toBe("Tốt")
  })

  it("rejects a non-numeric product id", async () => {
    const res = await request(app).get("/api/shop/products/abc/reviews")
    expect(res.status).toBe(400)
  })
})
