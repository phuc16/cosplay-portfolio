/**
 * Sub-albums: a nullable self-reference, capped at one level by the route
 * layer (albums.js resolveParentId), not by the schema. The column and its
 * index land first and the FK second so MySQL reuses idx_albums_parent_sort
 * as the FK's backing index instead of auto-creating a duplicate.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable("albums", (table) => {
    table.integer("parent_id").unsigned().nullable()
    table.index(["parent_id", "sort_order"], "idx_albums_parent_sort")
  })
  await knex.schema.alterTable("albums", (table) => {
    table.foreign("parent_id", "fk_albums_parent").references("id").inTable("albums").onDelete("CASCADE")
  })
}

exports.down = async function (knex) {
  await knex.schema.alterTable("albums", (table) => {
    table.dropForeign("parent_id", "fk_albums_parent")
  })
  await knex.schema.alterTable("albums", (table) => {
    table.dropIndex(["parent_id", "sort_order"], "idx_albums_parent_sort")
    table.dropColumn("parent_id")
  })
}
