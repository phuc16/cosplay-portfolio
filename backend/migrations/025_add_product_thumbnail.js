exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Separate from `images` (the product's own photo gallery) - this is
    // never shown as one of the product's pictures, only as the cover shown
    // in listing grids. NULL falls back to images[0].
    table.string("thumbnail_image", 512).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("thumbnail_image")
  })
}
