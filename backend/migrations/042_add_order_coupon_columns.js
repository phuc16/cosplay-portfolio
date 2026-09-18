exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // The code as redeemed - permanent regardless of the coupons row being
    // later edited/deactivated, same snapshot-column guarantee every other
    // order_items/orders snapshot field already provides.
    table.string("coupon_code_snapshot", 32).nullable()
    // VND actually deducted - already clamped to never exceed the subtotal
    // it was applied to. 0 for every order with no coupon.
    table.integer("discount_amount").unsigned().notNullable().defaultTo(0)
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("coupon_code_snapshot")
    table.dropColumn("discount_amount")
  })
}
