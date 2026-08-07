exports.up = function (knex) {
  return knex.schema.createTable("products", (table) => {
    table.increments("id").primary()

    table.integer("collection_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("collections")
      .onDelete("CASCADE")

    table.string("name").notNullable()
    table.text("description")

    // VND has no minor unit — integer avoids float rounding entirely.
    table.integer("price").unsigned().notNullable().defaultTo(0)

    // Array of storage proxy URLs, e.g. ["/api/storage/shop/products/1/abc.webp"]
    table.json("images")

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["collection_id", "sort_order"], "idx_products_collection_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("products")
}
