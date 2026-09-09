exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // Replaces the old convention of typing "freeship" into the buyer's
    // name (parsed out by the seller's pre-shop script) - that hack
    // pollutes the printed shipping label and lets a buyer trigger free
    // shipping by typing a word into their own name field.
    table.enu("shipping_payer", ["buyer", "seller"]).notNullable().defaultTo("buyer")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("shipping_payer")
  })
}
