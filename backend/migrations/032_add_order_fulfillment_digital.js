exports.up = function (knex) {
  // Buyer never picks this value - orderRepo.createOrder sets it internally
  // when every cart line is digital (no address/shipping applies).
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup') NOT NULL")
}
