exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free-text character/series tags, admin-entered, no separate taxonomy
    // table - mirrors the existing `images` JSON-array column exactly.
    // NULL (never written to by createProduct/updateProduct, which always
    // send at least '[]') means a legacy pre-migration row; treated the
    // same as an empty array by catalogRepo.parseTags.
    table.json("tags").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("tags")
  })
}
