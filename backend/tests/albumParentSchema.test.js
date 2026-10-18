import { describe, it, expect, afterAll } from "vitest"
import db from "../db.js"
import redis from "../redis.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => { await redis.quit(); await closeDb() })

describe("albums.parent_id", () => {
  it("is a nullable column", async () => {
    const [[col]] = await db.query(
      "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'albums' AND COLUMN_NAME = 'parent_id'"
    )
    expect(col.IS_NULLABLE).toBe("YES")
  })

  it("has a cascading self-referencing foreign key", async () => {
    const [[fk]] = await db.query(
      "SELECT DELETE_RULE, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'albums' AND CONSTRAINT_NAME = 'fk_albums_parent'"
    )
    expect(fk.DELETE_RULE).toBe("CASCADE")
    expect(fk.REFERENCED_TABLE_NAME).toBe("albums")
  })

  it("has the sibling-order index", async () => {
    const [rows] = await db.query("SHOW INDEX FROM albums WHERE Key_name = 'idx_albums_parent_sort'")
    expect(rows.map((r) => r.Column_name)).toEqual(["parent_id", "sort_order"])
  })
})
