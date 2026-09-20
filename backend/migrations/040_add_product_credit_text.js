exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free-text artist/photographer/cosplayer credit line, admin-entered,
    // publicly displayed as-is (not translated, not structured - a single
    // line like "Ảnh: @tenphotographer"). Deliberately distinct from any
    // character/series "who is depicted" tagging - this is "who to credit".
    table.string("credit_text", 255).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("credit_text")
  })
}
