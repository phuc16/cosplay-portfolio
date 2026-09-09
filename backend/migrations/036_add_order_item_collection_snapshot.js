exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.integer("collection_id_snapshot").unsigned().nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("collection_id_snapshot")
  })
}
