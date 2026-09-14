exports.up = function (knex) {
  return knex.schema.createTable("gift_settings", (table) => {
    table.increments("id").primary()

    table.boolean("enabled").notNullable().defaultTo(false)
    // Buyer-facing name, plain text - same convention as collections.pickup_note
    // (admin writes it once, not a bilingual {vi,en} object).
    table.string("name", 191).notNullable().defaultTo("")
    table.string("image_url", 512).nullable()
    // VND. The items-subtotal threshold a qualifying order must meet.
    table.integer("min_total").unsigned().notNullable().defaultTo(0)
    table.text("note").nullable()
    // Presence marks the gift as digital (its link only ever reveals once an
    // order reaches confirmed/completed, same rule every other digital
    // delivery link already follows); absence marks it physical.
    table.string("delivery_link", 2048).nullable()

    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gift_settings")
}
