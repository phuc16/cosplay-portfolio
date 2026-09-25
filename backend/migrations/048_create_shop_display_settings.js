/**
 * Single-row settings, same singleton pattern as gift_settings/payment_settings.
 * group_order is a JSON array permutation of ["gacha","digital","physical"] -
 * the order the three storefront groups render in on the public shop page.
 */
exports.up = function (knex) {
  return knex.schema.createTable("shop_display_settings", (table) => {
    table.increments("id").primary()
    table.json("group_order").notNullable()
    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("shop_display_settings")
}
