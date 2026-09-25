exports.up = async function (knex) {
  await knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital', 'gacha') NOT NULL DEFAULT 'physical'")
  await knex.schema.alterTable("products", (table) => {
    table.boolean("gacha_booth_only").notNullable().defaultTo(false)
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("gacha_booth_only")
  })
  await knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital') NOT NULL DEFAULT 'physical'")
}
