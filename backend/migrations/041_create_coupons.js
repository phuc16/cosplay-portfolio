exports.up = function (knex) {
  return knex.schema.createTable("coupons", (table) => {
    table.increments("id").primary()
    // Stored uppercase/trimmed - couponRepo normalizes on both write and
    // lookup so "save10" and "SAVE10" always refer to the same code.
    table.string("code", 32).notNullable().unique()
    table.enu("type", ["percent", "fixed"]).notNullable()
    // percent: 1-100 (validated at write time). fixed: VND, no upper bound
    // enforced here - clamped to the order's subtotal at apply time instead.
    table.integer("value").unsigned().notNullable()
    table.boolean("active").notNullable().defaultTo(true)
    // VND. Paid-items subtotal required to redeem.
    table.integer("min_total").unsigned().notNullable().defaultTo(0)
    // NULL = unlimited.
    table.integer("max_uses").unsigned().nullable()
    table.integer("times_used").unsigned().notNullable().defaultTo(0)
    table.timestamp("expires_at").nullable()
    table.timestamp("created_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("coupons")
}
