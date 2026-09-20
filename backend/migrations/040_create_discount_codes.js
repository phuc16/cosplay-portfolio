exports.up = function (knex) {
  return knex.schema.createTable("discount_codes", (table) => {
    table.increments("id").primary()

    // Matched case-insensitively - always normalized to uppercase on write
    // and on lookup (see shop/discountCodes.js's normalizeCode), so the
    // unique index below is effectively case-insensitive too.
    table.string("code", 64).notNullable().unique()
    table.enu("type", ["percent", "fixed"]).notNullable()
    // A percent (1-100) or a VND amount, depending on `type` - which one is
    // never ambiguous since `type` is always read alongside `value`.
    table.integer("value").unsigned().notNullable()
    table.boolean("enabled").notNullable().defaultTo(true)
    // NULL = unlimited. Redemption is tracked globally (used_count), not
    // per-buyer - there is no buyer-identity concept to hang a per-buyer
    // limit on pre-order (see the discount-codes design doc's scope
    // decisions for why this is a deliberate YAGNI call).
    table.integer("max_uses").unsigned().nullable()
    table.integer("used_count").unsigned().notNullable().defaultTo(0)
    // VND. 0 = no minimum. Measured against the paid-items subtotal, before
    // the free gift and before shipping - the same number createOrder
    // already computes for the free-gift threshold check.
    table.integer("min_total").unsigned().notNullable().defaultTo(0)
    table.timestamp("expires_at").nullable()

    table.timestamps(true, true)
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("discount_codes")
}
