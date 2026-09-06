exports.up = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    // NULL means visible immediately (today's behavior, unchanged).
    table.datetime("start_at").nullable()
    // NULL means it never auto-closes (today's behavior, unchanged).
    table.datetime("end_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("collections", (table) => {
    table.dropColumn("start_at")
    table.dropColumn("end_at")
  })
}
