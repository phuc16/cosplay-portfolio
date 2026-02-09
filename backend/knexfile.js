require("dotenv").config()

const connection = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "cosplay"
}

module.exports = {
  development: { client: "mysql2", connection, migrations: { directory: "./migrations" }, seeds: { directory: "./seeds" } },
  production: { client: "mysql2", connection, migrations: { directory: "./migrations" }, seeds: { directory: "./seeds" } }
}
