/**
 * A per-collection sequential number for pickup orders, so buyers can queue
 * at the event by number. NULL for ship/digital orders. Multiple NULLs never
 * collide under a unique index (MySQL treats NULL as distinct from itself),
 * so the (collection_id, queue_number) constraint only ever guards real
 * assigned numbers against a concurrent-assignment race.
 */
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.integer("queue_number").unsigned().nullable()
    table.unique(["collection_id", "queue_number"], "uniq_orders_collection_queue_number")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropUnique(["collection_id", "queue_number"], "uniq_orders_collection_queue_number")
    table.dropColumn("queue_number")
  })
}
