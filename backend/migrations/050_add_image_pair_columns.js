exports.up = function (knex) {
  return knex.schema.alterTable("images", (table) => {
    // 'before' | 'after' | null. Set symmetrically on both sides of a pair
    // by the pairing endpoint - never on just one row.
    table.string("pair_role", 10).nullable()
    // SET NULL, not CASCADE: deleting one photo of a pair must not delete
    // its partner, only unlink it - the partner degrades to an ordinary
    // ungrouped photo, same as any image that was never paired.
    table.integer("pair_image_id").unsigned().nullable()
      .references("id").inTable("images").onDelete("SET NULL")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("images", (table) => {
    table.dropColumn("pair_image_id")
    table.dropColumn("pair_role")
  })
}
