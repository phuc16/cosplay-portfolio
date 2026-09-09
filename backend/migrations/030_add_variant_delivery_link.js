exports.up = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    // Only ever set on the single hidden variant of a digital product -
    // always NULL for a physical variant.
    table.string("delivery_link", 2048).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("delivery_link")
  })
}
