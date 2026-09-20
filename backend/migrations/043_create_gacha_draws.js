exports.up = function (knex) {
  return knex.schema.createTable("gacha_draws", (table) => {
    table.increments("id").primary()
    table.integer("session_id").unsigned().notNullable()
      .references("id").inTable("gacha_sessions").onDelete("CASCADE")
    table.integer("gacha_prize_id").unsigned().notNullable()
      .references("id").inTable("gacha_prizes").onDelete("RESTRICT")
    table.timestamp("drawn_at").defaultTo(knex.fn.now())

    table.index(["session_id"], "idx_gacha_draws_session")
  })
}

exports.down = function (knex) {
  return knex.schema.dropTableIfExists("gacha_draws")
}
