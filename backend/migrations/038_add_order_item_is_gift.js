exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.boolean("is_gift").notNullable().defaultTo(false)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("is_gift")
  })
}
