import { describe, it, expect, afterAll } from "vitest"
import db from "../db.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => {
  await closeDb()
})

async function columns(table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return Object.fromEntries(rows.map((r) => [r.COLUMN_NAME, r]))
}

describe("orders schema", () => {
  it("has the lifecycle and reservation columns", async () => {
    const c = await columns("orders")
    expect(Object.keys(c)).toEqual(expect.arrayContaining([
      "id", "order_token", "request_key", "buyer_name", "phone", "email",
      "fulfillment_method", "address_street", "address_ward", "address_district",
      "address_province", "address_raw", "note", "status", "payment_method",
      "total", "shipping_fee", "cod_amount", "tracking_code", "collection_id",
      "stock_released_at", "created_at", "confirmed_at", "expires_at",
    ]))
  })

  it("stores money as unsigned integers", async () => {
    const c = await columns("orders")
    expect(c.total.COLUMN_TYPE).toBe("int unsigned")
    expect(c.shipping_fee.COLUMN_TYPE).toBe("int unsigned")
    expect(c.cod_amount.COLUMN_TYPE).toBe("int unsigned")
  })

  it("allows a null expires_at, which is how COD orders avoid the sweep", async () => {
    const c = await columns("orders")
    expect(c.expires_at.IS_NULLABLE).toBe("YES")
  })

  it("enforces unique order_token and request_key", async () => {
    const c = await columns("orders")
    expect(c.order_token.COLUMN_KEY).toBe("UNI")
    expect(c.request_key.COLUMN_KEY).toBe("UNI")
  })

  it("covers every lifecycle status", async () => {
    const c = await columns("orders")
    for (const s of ["pending", "confirmed", "shipped", "completed", "cancelled"]) {
      expect(c.status.COLUMN_TYPE).toContain(s)
    }
  })
})

describe("order_items schema", () => {
  it("snapshots name, label and price", async () => {
    const c = await columns("order_items")
    expect(Object.keys(c)).toEqual(expect.arrayContaining([
      "id", "order_id", "product_variant_id",
      "product_name_snapshot", "variant_label_snapshot", "unit_price_snapshot", "qty",
    ]))
    expect(c.unit_price_snapshot.COLUMN_TYPE).toBe("int unsigned")
  })

  it("keeps product_variant_id nullable so deleting a variant cannot erase history", async () => {
    const c = await columns("order_items")
    expect(c.product_variant_id.IS_NULLABLE).toBe("YES")
  })
})
