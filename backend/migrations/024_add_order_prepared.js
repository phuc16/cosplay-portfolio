exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // Purely informational: a seller's own "have I packed this yet"
    // checkbox in the shipping queue. Never read by export/tracking logic.
    table.boolean("prepared").notNullable().defaultTo(false)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("prepared")
  })
}
