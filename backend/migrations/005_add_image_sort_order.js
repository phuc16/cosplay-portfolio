exports.up = function (knex) {
  return knex.schema.alterTable("images", (table) => {
    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("images", (table) => {
    table.dropColumn("sort_order")
  })
}
