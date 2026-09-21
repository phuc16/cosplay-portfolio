exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free text, e.g. "Genshin Impact - Raiden Shogun" - not a bilingual
    // {vi, en} object (a character/series name is a proper noun, same
    // non-translation precedent as collections.pickup_note). NULL/unset
    // means untagged - the product behaves exactly as it does today.
    table.string("character_tag", 191).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("character_tag")
  })
}
