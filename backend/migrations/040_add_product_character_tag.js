exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free text - a character and/or series name (e.g. "Raiden Shogun
    // (Genshin Impact)"). NULL/omitted means untagged. One tag per product,
    // not a many-to-many tag table - see the design doc for why.
    table.string("character_tag", 191).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("character_tag")
  })
}
