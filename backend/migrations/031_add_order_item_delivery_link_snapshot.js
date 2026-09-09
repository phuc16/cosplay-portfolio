exports.up = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    // Captured at order-creation time from the variant's delivery_link, so
    // a later edit to the product never changes what a past order was
    // already sent/shown - same snapshot pattern as product_name_snapshot.
    table.string("delivery_link_snapshot", 2048).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("delivery_link_snapshot")
  })
}
