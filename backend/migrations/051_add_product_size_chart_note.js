exports.up = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    // Free-text sizing/fit guidance for a wearable cosplay product (chest/
    // waist/length measurements, "runs small - order one size up", etc.) -
    // same nullable single-language TEXT convention as the existing
    // description column (008_create_products.js). Rendered via the same
    // markdown pipeline as description, so a seller can format a
    // measurements table if they want one.
    table.text("size_chart_note")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("products", (table) => {
    table.dropColumn("size_chart_note")
  })
}
