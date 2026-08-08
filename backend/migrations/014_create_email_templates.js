exports.up = function (knex) {
  return knex.schema.createTable("email_templates", (table) => {
    table.increments("id").primary()
    table.string("type", 64).notNullable().unique()
    table.string("subject", 512).notNullable()
    table.text("body_html", "mediumtext").notNullable()
    table.timestamp("updated_at").defaultTo(knex.fn.now())
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("email_templates")
}
