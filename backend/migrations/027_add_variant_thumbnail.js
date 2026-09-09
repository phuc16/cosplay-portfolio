exports.up = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    // Separate from `images`/`image_url` (the variant's own photo gallery) -
    // never shown as one of the variant's pictures, only as the cover used
    // in the picker grid. NULL falls back to images[0]/image_url.
    table.string("thumbnail_image", 512).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("thumbnail_image")
  })
}
