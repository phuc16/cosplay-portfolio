exports.up = function (knex) {
  return knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital', 'gacha') NOT NULL DEFAULT 'physical'")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE products MODIFY COLUMN type ENUM('physical', 'digital') NOT NULL DEFAULT 'physical'")
}
