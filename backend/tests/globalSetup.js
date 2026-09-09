require("dotenv").config()
const mysql = require("mysql2/promise")

// Creates the test database (if absent) and brings it to the latest migration.
// DB_NAME is pinned to cosplay_test by the npm script, so this never touches dev data.
module.exports = async function setup() {
  const database = process.env.DB_NAME
  if (database !== "cosplay_test") {
    throw new Error(`Refusing to run tests against DB_NAME="${database}". Use npm test.`)
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
  })
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
  await conn.end()

  const knex = require("knex")({
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASS || "",
      database,
    },
    migrations: { directory: `${__dirname}/../migrations` },
  })
  await knex.migrate.latest()
  await knex.destroy()
}
