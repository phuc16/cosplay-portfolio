exports.up = function (knex) {
  return knex.schema.createTable("gacha_prizes", (table) => {
    table.increments("id").primary()
    table.integer("product_id").unsigned().notNullable()
      .references("id").inTable("products").onDelete("CASCADE")

    table.string("name", 191).notNullable()
    table.text("description").nullable()
    table.string("image_url", 512).nullable()
    // Display-only grouping (badge color + summed odds) - never an
    // independent weight. Odds are always quantity_remaining-driven.
    table.enu("tier", ["common", "rare", "epic", "legendary", "ancient"]).notNullable().defaultTo("common")
    // VND. Shown as the prize's "value" card - informational only, a prize
    // is never sold individually.
    table.integer("display_price").unsigned().notNullable().defaultTo(0)

    table.integer("quantity_total").unsigned().notNullable()
    // Decremented atomically on each real draw; never touched by practice
    // draws. quantity_total - quantity_remaining = lifetime drawn count,
    // which prizeRepo.replacePrizes treats as immutable history.
    table.integer("quantity_remaining").unsigned().notNullable()

    table.integer("sort_order").notNullable().defaultTo(0)

    table.index(["product_id", "sort_order"], "idx_gacha_prizes_product_sort")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_prizes")
}
