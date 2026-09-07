exports.up = function (knex) {
  return knex.schema.alterTable("payment_settings", (table) => {
    table.dropColumn("sepay_api_key")
    table.dropColumn("sepay_webhook_secret")
    table.dropColumn("auto_confirm_enabled")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("payment_settings", (table) => {
    table.string("sepay_api_key", 255).nullable()
    table.string("sepay_webhook_secret", 255).nullable()
    table.boolean("auto_confirm_enabled").notNullable().defaultTo(false)
  })
}
