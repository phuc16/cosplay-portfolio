exports.up = function (knex) {
  return knex.schema.alterTable("albums", (table) => {
    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("albums", (table) => {
    table.dropColumn("sort_order")
  })
}
