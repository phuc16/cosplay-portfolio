exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // Snapshot-based, exactly like every other order-time fact in this
    // schema (see CLAUDE.md's Snapshotting section) - deliberately NOT a
    // foreign key to discount_codes, so an admin can freely edit/delete a
    // code later with zero blast radius on historical orders.
    table.string("discount_code_snapshot", 64).nullable()
    // VND. 0 when no code was applied - orders.total continues to mean
    // "what the buyer actually pays" (subtotal - discount_amount_snapshot),
    // the free gift stays a separate 0đ line, unaffected either way.
    table.integer("discount_amount_snapshot").unsigned().notNullable().defaultTo(0)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("discount_code_snapshot")
    table.dropColumn("discount_amount_snapshot")
  })
}
