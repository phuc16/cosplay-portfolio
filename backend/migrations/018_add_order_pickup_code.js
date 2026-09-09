exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.string("pickup_code", 6).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("pickup_code")
  })
}
