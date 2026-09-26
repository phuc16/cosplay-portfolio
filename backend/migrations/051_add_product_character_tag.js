/**
 * Optional character/series label for a product, e.g. "Genshin Impact -
 * Raiden Shogun". Plain free text, not a many-to-many tags table - see
 * docs/superpowers/specs/2026-09-26-character-tag-filter-design.md for why.
 * NULL means untagged (today's behavior, unchanged). Length matches
 * NAME_MAX_LEN (products.name's own limit) in adminCatalog.js.
 */
exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.string("character_tag", 255).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("character_tag")
  })
}
