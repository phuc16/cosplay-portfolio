exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.string("image_url_snapshot", 512).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("image_url_snapshot")
  })
}
