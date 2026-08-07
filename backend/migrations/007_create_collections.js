exports.up = function (knex) {
  return knex.schema.createTable("collections", (table) => {
    table.increments("id").primary()

    table.string("title").notNullable()
    table.string("slug", 191).notNullable().unique()
    table.text("description")

    table.string("cover_image", 512).nullable()
    table.string("thumbnail_image", 512).nullable()

    table.enu("status", ["draft", "active", "closed", "archived"]).notNullable().defaultTo("draft")

    table.boolean("allow_ship").notNullable().defaultTo(true)
    table.boolean("allow_pickup").notNullable().defaultTo(false)
    table.string("pickup_location", 512).nullable()
    table.text("pickup_note").nullable()

    table.integer("sort_order").unsigned().notNullable().defaultTo(0)
    table.timestamp("created_at").defaultTo(knex.fn.now())

    table.index(["status", "sort_order"], "idx_collections_status_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("collections")
}
