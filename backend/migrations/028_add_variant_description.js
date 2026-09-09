exports.up = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    // Own markdown description, same rendering as products.description - a
    // size chart or fit note that only applies to this one variant (e.g.
    // "XL/XXL/3XL/4XL" sizing), not the whole product.
    table.text("description").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("description")
  })
}
