/**
 * Widens the queue-number uniqueness scope from (collection_id, queue_number)
 * to (collection_id, fulfillment_method, queue_number), so a collection
 * running both pickup and ship at once gets two independent sequences
 * instead of one shared one - a ship order confirmed between two pickup
 * orders must not "use up" a pickup number.
 *
 * The new index is created BEFORE the old one is dropped (two separate
 * alterTable calls, not one): the old 2-column unique index is currently the
 * only index covering orders.collection_id, so it implicitly backs that
 * column's foreign key - dropping it first fails with "needed in a foreign
 * key constraint". Creating the new index first (same leading column) lets
 * it take over as the FK's backing index before the old one goes away.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("orders", (table) => {
    table.unique(
      ["collection_id", "fulfillment_method", "queue_number"],
      "uniq_orders_collection_fulfillment_queue_number"
    )
  })
  await knex.schema.alterTable("orders", (table) => {
    table.dropUnique(["collection_id", "queue_number"], "uniq_orders_collection_queue_number")
  })
}

/**
 * Re-narrowing straight back to (collection_id, queue_number) can fail with
 * ER_DUP_ENTRY: once ship orders are numbered too, a pickup order and a ship
 * order in the same collection routinely share a number on purpose (each
 * fulfillment_method has its own independent sequence - see up() above), and
 * that's exactly what the 2-column index forbids. Null out the queue_number
 * of every ship order first - it was never buyer-facing (see
 * routes/orders.js's toPublicOrder) and is purely a rollback casualty, not
 * data anything downstream of this migration depends on - so the narrower
 * index can always be recreated.
 */
exports.down = async function (knex) {
  await knex("orders").where({ fulfillment_method: "ship" }).update({ queue_number: null })
  await knex.schema.alterTable("orders", (table) => {
    table.unique(["collection_id", "queue_number"], "uniq_orders_collection_queue_number")
  })
  await knex.schema.alterTable("orders", (table) => {
    table.dropUnique(
      ["collection_id", "fulfillment_method", "queue_number"],
      "uniq_orders_collection_fulfillment_queue_number"
    )
  })
}
