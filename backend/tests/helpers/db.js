const db = require("../../db")

/** Truncate the given tables, ignoring FK order. Call in beforeEach. */
async function resetTables(...names) {
  const conn = await db.getConnection()
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0")
    for (const name of names) {
      await conn.query(`TRUNCATE TABLE \`${name}\``)
    }
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {})
    conn.release()
  }
}

/** Close the shared pool so Vitest can exit. Call in afterAll. */
async function closeDb() {
  await db.end()
}

module.exports = { resetTables, closeDb }
