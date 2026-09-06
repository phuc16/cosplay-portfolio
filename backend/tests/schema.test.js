import { describe, it, expect, afterAll } from "vitest"
import db from "../db.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => {
  await closeDb()
})

async function columns(table) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return Object.fromEntries(rows.map((r) => [r.COLUMN_NAME, r]))
}

describe("catalog schema", () => {
  it("creates collections with status and fulfillment flags", async () => {
    const c = await columns("collections")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "title", "slug", "description", "cover_image", "thumbnail_image",
        "status", "allow_ship", "allow_pickup", "pickup_location", "pickup_note",
        "sort_order", "created_at",
      ])
    )
    expect(c.status.COLUMN_TYPE).toContain("draft")
    expect(c.status.COLUMN_TYPE).toContain("archived")
  })

  it("creates products with integer VND price", async () => {
    const c = await columns("products")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "collection_id", "name", "description", "price", "images", "sort_order", "created_at",
      ])
    )
    expect(c.price.COLUMN_TYPE).toBe("int unsigned")
  })

  it("creates product_variants with nullable stock_qty meaning unlimited", async () => {
    const c = await columns("product_variants")
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "id", "product_id", "label", "image_url", "thumbnail_image", "description", "stock_qty", "sort_order", "created_at",
      ])
    )
    expect(c.stock_qty.IS_NULLABLE).toBe("YES")
    expect(c.thumbnail_image.IS_NULLABLE).toBe("YES")
    expect(c.description.IS_NULLABLE).toBe("YES")
  })

  it("creates products with a type column defaulting to physical", async () => {
    const c = await columns("products")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["type"]))
    expect(c.type.COLUMN_TYPE).toContain("digital")
    expect(c.type.IS_NULLABLE).toBe("NO")
  })

  it("creates product_variants with a nullable delivery_link", async () => {
    const c = await columns("product_variants")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["delivery_link"]))
    expect(c.delivery_link.IS_NULLABLE).toBe("YES")
  })
})

describe("digital order schema", () => {
  it("creates order_items with a nullable delivery_link_snapshot", async () => {
    const c = await columns("order_items")
    expect(Object.keys(c)).toEqual(expect.arrayContaining(["delivery_link_snapshot"]))
    expect(c.delivery_link_snapshot.IS_NULLABLE).toBe("YES")
  })

  it("extends orders.fulfillment_method with 'digital'", async () => {
    const c = await columns("orders")
    expect(c.fulfillment_method.COLUMN_TYPE).toContain("digital")
  })
})
