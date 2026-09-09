exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // Optional - an admin may cancel without typing one (prompt() returning
    // null/empty), and every order cancelled before this migration has none.
    table.string("cancel_reason", 500).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("cancel_reason")
  })
}
