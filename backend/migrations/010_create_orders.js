exports.up = function (knex) {
  return knex.schema.createTable("orders", (table) => {
    table.increments("id").primary()

    // 128-bit random; the only thing protecting the buyer's order page.
    table.string("order_token", 64).notNullable().unique()
    // Client-supplied idempotency key: a retry of the same submit reuses the order.
    table.string("request_key", 64).nullable().unique()

    table.string("buyer_name").notNullable()
    table.string("phone", 32).notNullable()
    table.string("email").notNullable()

    table.enu("fulfillment_method", ["ship", "pickup"]).notNullable()
    table.string("address_street", 512).nullable()
    table.string("address_ward").nullable()
    table.string("address_district").nullable()
    table.string("address_province").nullable()
    table.text("address_raw").nullable()

    table.text("note").nullable()

    table.enu("status", ["pending", "confirmed", "shipped", "completed", "cancelled"])
      .notNullable().defaultTo("pending")
    table.enu("payment_method", ["bank", "momo", "paypal", "cod"]).notNullable()

    // Merch only. Shipping is receiver-pays and never part of the total.
    table.integer("total").unsigned().notNullable()
    // Recorded after the fact for bookkeeping; never charged to the buyer.
    table.integer("shipping_fee").unsigned().nullable()
    table.integer("cod_amount").unsigned().nullable()

    table.string("tracking_code").nullable()

    // Kept for admin filtering; SET NULL so deleting a collection never
    // destroys order history.
    table.integer("collection_id").unsigned().nullable()
      .references("id").inTable("collections").onDelete("SET NULL")

    // Guards against releasing reserved stock twice.
    table.timestamp("stock_released_at").nullable()

    table.timestamp("created_at").defaultTo(knex.fn.now())
    table.timestamp("confirmed_at").nullable()
    // NULL for COD: there is no payment to wait for, so the sweep must skip it.
    table.timestamp("expires_at").nullable()

    table.index(["status", "expires_at"], "idx_orders_status_expires")
    table.index(["status", "created_at"], "idx_orders_status_created")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("orders")
}
