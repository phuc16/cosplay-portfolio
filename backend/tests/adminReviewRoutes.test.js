import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import reviewRepo from "../shop/reviews/reviewRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" }

async function seedReview() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ? LIMIT 1", [pid])
  const order = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  const id = await reviewRepo.createReview({ orderId: order.id, productId: pid, buyerName: "A", rating: 5 })
  return id
}

beforeEach(async () => {
  await resetTables("reviews", "email_queue", "order_items", "orders", "product_variants", "products", "collections")
})

describe("DELETE /api/admin/reviews/:id", () => {
  it("requires auth", async () => {
    const id = await seedReview()
    expect((await request(app).delete(`/api/admin/reviews/${id}`)).status).toBe(401)
  })

  it("deletes an existing review", async () => {
    const id = await seedReview()
    const res = await authed(request(app).delete(`/api/admin/reviews/${id}`))
    expect(res.status).toBe(200)
    const [rows] = await db.query("SELECT id FROM reviews WHERE id = ?", [id])
    expect(rows).toHaveLength(0)
  })

  it("404s cleanly for an unknown id", async () => {
    const res = await authed(request(app).delete("/api/admin/reviews/999999"))
    expect(res.status).toBe(404)
  })
})
