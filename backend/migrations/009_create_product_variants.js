exports.up = function (knex) {
  return knex.schema.createTable("product_variants", (table) => {
    table.increments("id").primary()

    table.integer("product_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE")

    // "S" / "M" for sizes, "A1" / "B2" for photocard codes.
    table.string("label", 191).notNullable()

    // Per-variant art (photocards). NULL falls back to the product's images.
    table.string("image_url", 512).nullable()

    // NULL means unlimited / made-to-order. 0 means sold out.
    table.integer("stock_qty").unsigned().nullable()

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["product_id", "sort_order"], "idx_variants_product_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("product_variants")
}
