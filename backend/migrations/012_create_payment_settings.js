exports.up = function (knex) {
  return knex.schema.createTable("payment_settings", (table) => {
    table.increments("id").primary()

    table.boolean("bank_enabled").notNullable().defaultTo(false)
    table.string("bank_name").nullable()
    table.string("bank_bin", 16).nullable()          // NAPAS BIN, e.g. ACB = 970416
    table.string("bank_account_number", 64).nullable()
    table.string("bank_account_holder").nullable()

    table.boolean("momo_enabled").notNullable().defaultTo(false)
    table.string("momo_phone", 32).nullable()
    table.string("momo_qr_image", 512).nullable()
    table.string("momo_account_holder").nullable()

    table.boolean("paypal_enabled").notNullable().defaultTo(false)
    table.string("paypal_link", 512).nullable()

    table.boolean("cod_enabled").notNullable().defaultTo(false)

    table.text("payment_note").nullable()

    // Reserved for a future automatic-confirmation phase. Nothing reads these
    // yet; they exist so adding SePay later needs no order-model change.
    table.string("sepay_api_key", 255).nullable()
    table.string("sepay_webhook_secret", 255).nullable()
    table.boolean("auto_confirm_enabled").notNullable().defaultTo(false)

    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("payment_settings")
}
