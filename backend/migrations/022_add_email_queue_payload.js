exports.up = function (knex) {
  return knex.schema.alterTable("email_queue", (table) => {
    // Carries the one thing a queued email needs at send time that isn't
    // re-derivable from the order row — right now, only order_placed's
    // access PIN (its plaintext exists nowhere else: orders.access_pin_hash
    // is a one-way hash). Cleared back to NULL once the message sends (see
    // queue.markSent) to keep its plaintext-at-rest window as short as the
    // send worker's poll interval, not the order's whole lifetime.
    table.text("payload").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("email_queue", (table) => {
    table.dropColumn("payload")
  })
}
