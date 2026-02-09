exports.up = function (knex) {
  return knex.schema.alterTable("images", table => {
    table.integer("width").unsigned().nullable()
    table.integer("height").unsigned().nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("images", table => {
    table.dropColumn("width")
    table.dropColumn("height")
  })
}
