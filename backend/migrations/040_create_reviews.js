exports.up = function (knex) {
  return knex.schema.createTable("reviews", (table) => {
    table.increments("id").primary()

    // Orders are never hard-deleted in this schema, but CASCADE matches
    // every other order-scoped table's convention (e.g. order_items).
    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")

    // Snapshot of orders.buyer_name at review-creation time - masked only at
    // the public read layer (reviewRepo.maskBuyerName), never masked at
    // rest, same snapshot-column convention as order_items' *_snapshot
    // fields.
    table.string("buyer_name", 191).notNullable()
    table.tinyint("rating").unsigned().notNullable()
    table.text("comment").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())

    // The actual guard against a duplicate review for the same order+
    // product pair - app-level checking only turns the resulting
    // constraint violation into a clean error message.
    table.unique(["order_id", "product_id"])
    table.index(["product_id"])
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("reviews")
}
