exports.up = function (knex) {
  return knex.schema.createTable("gacha_sessions", (table) => {
    table.increments("id").primary()
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")
    // Nullable only in the sense that practice sessions never get a row at
    // all - every persisted session row (online or booth_cash) always has
    // one. One order can have at most one gacha session.
    table.integer("order_id").unsigned().nullable().unique()
      .references("id").inTable("orders").onDelete("CASCADE")

    table.string("buyer_name", 191).nullable()
    table.integer("turns_total").unsigned().notNullable()
    table.integer("turns_used").unsigned().notNullable().defaultTo(0)
    table.enu("status", ["active", "completed"]).notNullable().defaultTo("active")
    table.enu("source", ["online", "booth_cash", "practice"]).notNullable()

    // Idempotency for the draw endpoint: a retried/double-tapped draw
    // request carrying the same draw_key returns the already-recorded
    // result instead of drawing again. NULL until the first draw.
    table.string("last_draw_key", 64).nullable()
    table.integer("last_draw_id").unsigned().nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("completed_at").nullable()

    table.index(["product_id", "status"], "idx_gacha_sessions_product_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_sessions")
}
