exports.up = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    // Additive gallery for the rare variant that needs more than one photo
    // (e.g. a preview sheet plus a close-up). NULL/empty means "just
    // image_url", which stays the single-photo path every other variant uses.
    table.json("images").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("images")
  })
}
