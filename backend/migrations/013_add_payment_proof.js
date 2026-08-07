exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.string("payment_proof_url", 512).nullable()
    table.timestamp("payment_proof_uploaded_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("payment_proof_url")
    table.dropColumn("payment_proof_uploaded_at")
  })
}
