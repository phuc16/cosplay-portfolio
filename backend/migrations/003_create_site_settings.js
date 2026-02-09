exports.up = function (knex) {
  return knex.schema.createTable("site_settings", (table) => {
    table.increments("id").primary()
    table.json("config")
    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("site_settings")
}
