exports.up = function (knex) {
  // 'booth' is a booth-cash gacha order: handed over on the spot, no address,
  // no shipping step - distinct from 'pickup', which drags in
  // pickup-location/QR copy that doesn't apply to an on-the-spot handover.
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital', 'booth') NOT NULL")
}

exports.down = function (knex) {
  return knex.raw("ALTER TABLE orders MODIFY COLUMN fulfillment_method ENUM('ship', 'pickup', 'digital') NOT NULL")
}
