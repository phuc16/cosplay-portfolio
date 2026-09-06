exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Every existing row backfills to 'physical' via the default — a
    // digital product is the new, explicit exception.
    table.enu("type", ["physical", "digital"]).notNullable().defaultTo("physical")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("type")
  })
}
