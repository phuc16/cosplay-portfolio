import { describe, it, expect, afterAll } from "vitest"
import request from "supertest"

// server.js reads process.env.SITE_URL at module-load time to build the CORS
// allowlist, so it must be set before the module is first required - hence
// the dynamic import here rather than a static one, and this living in its
// own file (vitest gives each test file a fresh module registry).
process.env.SITE_URL = "https://shop.example"
const { default: app } = await import("../server.js")
const { closeDb } = await import("./helpers/db.js")

afterAll(async () => {
  await closeDb()
})

describe("CORS allowlist (SITE_URL set)", () => {
  it("allows only the configured SITE_URL origin", async () => {
    const res = await request(app).get("/api/definitely-not-a-route").set("Origin", "https://anywhere.example")
    expect(res.headers["access-control-allow-origin"]).toBe("https://shop.example")
  })
})
