exports.up = function (knex) {
  return knex.schema.createTable("albums", table => {

    table.increments("id").primary()

    table.string("title").notNullable()
    table.text("description")

    table.timestamp("created_at")
      .defaultTo(knex.fn.now())

  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("albums")
}
