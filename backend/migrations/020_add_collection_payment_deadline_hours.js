exports.up = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    table.integer("payment_deadline_hours").unsigned().nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    table.dropColumn("payment_deadline_hours")
  })
}
