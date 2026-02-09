exports.up = function (knex) {
  return knex.schema.createTable("images", table => {

    table.increments("id").primary()

    table.integer("album_id")
      .unsigned()
      .references("id")
      .inTable("albums")
      .onDelete("CASCADE")

    table.string("url", 512).notNullable()
    table.string("thumb_url", 512).nullable()

    table.string("title")

    table.timestamp("created_at")
      .defaultTo(knex.fn.now())

  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("images")
}
