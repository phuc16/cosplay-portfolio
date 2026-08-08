exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.timestamp("shipped_at").nullable()
    table.timestamp("completed_at").nullable()
    table.timestamp("cancelled_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("shipped_at")
    table.dropColumn("completed_at")
    table.dropColumn("cancelled_at")
  })
}
