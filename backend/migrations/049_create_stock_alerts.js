exports.up = function (knex) {
  return knex.schema.createTable("stock_alerts", (table) => {
    table.increments("id").primary()

    table.integer("product_variant_id").unsigned().notNullable()
      .references("id").inTable("product_variants").onDelete("CASCADE")

    table.string("email", 191).notNullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    // NULL = still waiting for a restock. Set once queued for send, and
    // reset back to NULL on a resubscribe (see stockAlerts/repo.js::signUp) -
    // an already-notified subscriber who wants to hear about the *next*
    // restock has to sign up again, which this reset re-enables.
    table.timestamp("notified_at").nullable()

    // Resubscribing is an upsert (ON DUPLICATE KEY UPDATE notified_at = NULL)
    // against this constraint, not a second row.
    table.unique(["product_variant_id", "email"], "uniq_stock_alert_variant_email")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("stock_alerts")
}
