exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // Whether this line actually decremented its variant's stock_qty at
    // order-creation time (false for an unlimited-stock variant, whose
    // stock_qty was NULL then - see createOrder's own decrement guard).
    // Existing rows default to true: releaseStock's old behavior credited
    // back whenever the variant's *current* stock_qty was non-null, which
    // for any already-placed order is the common case this preserves.
    // Recorded per-row instead of re-derived from the variant's current
    // state, because that state can change (unlimited -> tracked) between
    // order creation and a later cancel/expiry, which would otherwise credit
    // stock that was never actually reserved from it.
    table.boolean("stock_reserved").notNullable().defaultTo(true)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("stock_reserved")
  })
}
