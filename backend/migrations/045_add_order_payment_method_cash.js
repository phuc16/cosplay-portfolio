exports.up = function (knex) {
  // 'cash' is a booth-cash gacha sale: staff already collected payment in
  // person before creating the order, so it starts life already confirmed.
  return knex.raw("ALTER TABLE orders MODIFY COLUMN payment_method ENUM('bank', 'momo', 'paypal', 'cod', 'cash') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN payment_method ENUM('bank', 'momo', 'paypal', 'cod') NOT NULL")
}
