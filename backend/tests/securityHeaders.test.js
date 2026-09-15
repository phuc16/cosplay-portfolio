import { describe, it, expect, afterAll, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => {
  await closeDb()
})

describe("security headers (helmet)", () => {
  it("sets the standard hardening headers on a plain response", async () => {
    const res = await request(app).get("/api/definitely-not-a-route")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN")
  })

  it("does not set a Content-Security-Policy (this API returns JSON/images, never HTML)", async () => {
    const res = await request(app).get("/api/definitely-not-a-route")
    expect(res.headers["content-security-policy"]).toBeUndefined()
  })

  it("does not set Cross-Origin-Resource-Policy (would block cross-origin <img> loads from /api/storage)", async () => {
    const res = await request(app).get("/api/definitely-not-a-route")
    expect(res.headers["cross-origin-resource-policy"]).toBeUndefined()
  })
})

describe("CORS", () => {
  it("falls back to allow-all when SITE_URL is unset (test env leaves it unset)", async () => {
    expect(process.env.SITE_URL).toBeFalsy()
    const res = await request(app).get("/api/definitely-not-a-route").set("Origin", "https://anywhere.example")
    expect(res.headers["access-control-allow-origin"]).toBe("*")
  })
})

describe("client IP resolution (rate limiting / login lockout)", () => {
  it("ignores a client-supplied X-Forwarded-For prefix and trusts only the configured proxy hop count", async () => {
    // With `trust proxy: 2` (server.js), req.ip is derived by walking in 2
    // hops from the socket peer - a spoofed leftmost entry must not become
    // req.ip, or every rate limiter/login lockout keyed on it is trivially
    // bypassable by sending a new fake IP on every request. The request
    // logger logs getClientIp(req) directly, so spying on it is the
    // simplest way to observe what req.ip actually resolved to.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    try {
      await request(app)
        .get("/api/definitely-not-a-route")
        .set("X-Forwarded-For", "1.2.3.4, 5.6.7.8, 9.10.11.12")
      const logged = logSpy.mock.calls.map((c) => c[0]).find((line) => line.includes('"msg":"request"'))
      expect(logged).toBeTruthy()
      expect(JSON.parse(logged).ip).not.toBe("1.2.3.4")
    } finally {
      logSpy.mockRestore()
    }
  })
})

describe("JWT algorithm pinning", () => {
  it("rejects a token signed with a different algorithm than the one verify() pins", async () => {
    const wrongAlgToken = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { algorithm: "HS384" })
    const res = await request(app)
      .get("/api/admin/email-templates")
      .set("Authorization", `Bearer ${wrongAlgToken}`)
    expect(res.status).toBe(403)
  })

  it("still accepts a normally-signed (default HS256) token", async () => {
    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET)
    const res = await request(app)
      .get("/api/admin/email-templates")
      .set("Authorization", `Bearer ${token}`)
    expect(res.status).toBe(200)
  })
})

describe("admin auth requires role: admin, not just a validly-signed token", () => {
  it("rejects a buyer's order-access session token on an admin route (same JWT_SECRET, different token type)", async () => {
    // This is exactly the shape orderAccess.js's issueOrderSessionToken
    // hands to every buyer in the checkout response (POST /api/orders) - it
    // is signed with the same JWT_SECRET as an admin login, but carries no
    // `role`. Without a role check, this token would verify successfully
    // here and grant full admin access to any buyer who ever placed an
    // order.
    const buyerOrderToken = jwt.sign({ order_access: "some-order-token" }, process.env.JWT_SECRET)
    const res = await request(app)
      .get("/api/admin/email-templates")
      .set("Authorization", `Bearer ${buyerOrderToken}`)
    expect(res.status).toBe(403)
  })

  it("rejects a validly-signed token with no role claim at all", async () => {
    const noRoleToken = jwt.sign({ some: "payload" }, process.env.JWT_SECRET)
    const res = await request(app)
      .get("/api/admin/email-templates")
      .set("Authorization", `Bearer ${noRoleToken}`)
    expect(res.status).toBe(403)
  })

  it("rejects a token claiming a role other than admin", async () => {
    const wrongRoleToken = jwt.sign({ role: "buyer" }, process.env.JWT_SECRET)
    const res = await request(app)
      .get("/api/admin/email-templates")
      .set("Authorization", `Bearer ${wrongRoleToken}`)
    expect(res.status).toBe(403)
  })
})
