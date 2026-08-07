import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./tests/globalSetup.js"],
    include: ["tests/**/*.test.js"],
    // DB-backed tests share one MySQL schema, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20000,
  },
})
