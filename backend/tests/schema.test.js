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
})
