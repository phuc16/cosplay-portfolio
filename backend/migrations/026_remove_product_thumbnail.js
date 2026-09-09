exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Reverted - thumbnail is a per-variant concept (see
    // 027_add_variant_thumbnail.js), not per-product: a product's cover in
    // listing grids is just its first picture, same as before.
    table.dropColumn("thumbnail_image")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.string("thumbnail_image", 512).nullable()
  })
}
