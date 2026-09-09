exports.up = function (knex) {
  return knex.schema.createTable("order_items", (table) => {
    table.increments("id").primary()

    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")

    // SET NULL, never CASCADE: deleting a variant must not erase the record of
    // what somebody bought and paid for.
    table.integer("product_variant_id").unsigned().nullable()
      .references("id").inTable("product_variants").onDelete("SET NULL")

    // Snapshots, so later catalog edits cannot rewrite order history.
    table.string("product_name_snapshot").notNullable()
    table.string("variant_label_snapshot").notNullable()
    table.integer("unit_price_snapshot").unsigned().notNullable()
    table.integer("qty").unsigned().notNullable()

    table.index("order_id", "idx_order_items_order")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("order_items")
}
