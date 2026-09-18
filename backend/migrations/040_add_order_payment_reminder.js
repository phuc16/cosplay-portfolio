exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // NULL = not sent yet (or not applicable - e.g. COD, which never has an
    // expires_at to be "approaching"). Set once by
    // orderRepo.sendDuePaymentReminders and never cleared, so a reminder
    // fires at most once per order.
    table.timestamp("payment_reminder_sent_at").nullable()
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("payment_reminder_sent_at")
  })
}
