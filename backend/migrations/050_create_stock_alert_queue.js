exports.up = function (knex) {
  return knex.schema.createTable("stock_alert_queue", (table) => {
    table.increments("id").primary()

    // Deliberately NOT a foreign key, and deliberately not joined to
    // stock_alerts/product_variants at send time - every field this needs to
    // render and send is snapshotted below, same principle as
    // order_items' *_snapshot columns, so this row keeps working even if the
    // subscription, variant, or product is deleted after it's queued.
    table.integer("product_variant_id").unsigned().nullable()

    table.string("email", 191).notNullable()
    table.string("product_name_snapshot", 191).notNullable()
    table.string("variant_label_snapshot", 191).notNullable().defaultTo("")
    table.string("collection_slug_snapshot", 191).nullable()

    table.enu("status", ["pending", "sent", "failed"]).notNullable().defaultTo("pending")
    table.integer("attempts").unsigned().notNullable().defaultTo(0)
    table.text("last_error").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("sent_at").nullable()

    table.index(["status", "attempts"], "idx_stock_alert_queue_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("stock_alert_queue")
}
