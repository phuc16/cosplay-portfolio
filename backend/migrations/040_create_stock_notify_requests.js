exports.up = function (knex) {
  return knex.schema.createTable("stock_notify_requests", (table) => {
    table.increments("id").primary()

    table.integer("product_variant_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("product_variants")
      .onDelete("CASCADE")

    table.string("email", 255).notNullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    // NULL = still pending. Set once the restock email is actually sent.
    table.timestamp("notified_at").nullable()

    // One active request per buyer/variant - a repeat sign-up before being
    // notified is a no-op, a repeat sign-up after being notified re-arms it
    // (see stockNotify.js's requestNotify).
    table.unique(["product_variant_id", "email"], "uniq_stock_notify_variant_email")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("stock_notify_requests")
}
