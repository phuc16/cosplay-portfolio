exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // Traceability back to the exact draw that produced this line - lets
    // admin views join back to gacha_draws/gacha_prizes when needed,
    // without every read path needing to know that join exists.
    table.integer("gacha_draw_id").unsigned().nullable()
      .references("id").inTable("gacha_draws").onDelete("SET NULL")
    // Snapshotted like every other *_snapshot column on this table, so a
    // later prize-pool edit never changes how an already-drawn item's tier
    // badge renders.
    table.string("gacha_tier_snapshot", 32).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // MySQL refuses to drop a column still named by a foreign key, so the
    // constraint has to go first even though the column is what we want gone.
    table.dropForeign(["gacha_draw_id"])
    table.dropColumn("gacha_draw_id")
    table.dropColumn("gacha_tier_snapshot")
  })
}
