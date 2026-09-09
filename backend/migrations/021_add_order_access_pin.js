exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // SHA-256 hex digest of the buyer's access PIN - never the plaintext PIN
    // itself, same reasoning as admin password comparison. The PIN gates the
    // public order page for anyone who only has the order link (order_token
    // alone used to be sufficient); it is emailed to the buyer once at order
    // creation and never stored anywhere else in plaintext.
    table.string("access_pin_hash", 64).nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("access_pin_hash")
  })
}
