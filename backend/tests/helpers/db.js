const db = require("../../db")

/** Truncate the given tables, ignoring FK order. Call in beforeEach. */
async function resetTables(...names) {
  await db.query("SET FOREIGN_KEY_CHECKS = 0")
  for (const name of names) {
    await db.query(`TRUNCATE TABLE \`${name}\``)
  }
  await db.query("SET FOREIGN_KEY_CHECKS = 1")
}

/** Close the shared pool so Vitest can exit. Call in afterAll. */
async function closeDb() {
  await db.end()
}

module.exports = { resetTables, closeDb }
