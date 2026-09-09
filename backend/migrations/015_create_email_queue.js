exports.up = function (knex) {
  return knex.schema.createTable("email_queue", (table) => {
    table.increments("id").primary()

    table.integer("order_id").unsigned().notNullable()
      .references("id").inTable("orders").onDelete("CASCADE")

    table.string("type", 64).notNullable()
    table.string("to_email").notNullable()

    table.enu("status", ["pending", "sent", "failed"]).notNullable().defaultTo("pending")
    table.integer("attempts").unsigned().notNullable().defaultTo(0)
    table.text("last_error").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("sent_at").nullable()

    table.index(["status", "attempts"], "idx_email_queue_status")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("email_queue")
}
