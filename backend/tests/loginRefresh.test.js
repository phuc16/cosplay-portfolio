import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import redis from "../redis.js"

const CREDS = { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }

beforeEach(async () => {
  const keys = await redis.keys("login_*")
  if (keys.length) await redis.del(...keys)
  const refreshKeys = await redis.keys("refresh_token:*")
  if (refreshKeys.length) await redis.del(...refreshKeys)
})

// Loose bounds rather than an exact second count - asserts "about 1 day" /
// "about 30 days" without being brittle to the few seconds elapsed between
// jwt.sign()/redis.set() and this assertion running.
function expiresWithin(expSeconds, expectedSeconds, toleranceSeconds = 60) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const remaining = expSeconds - nowSeconds
  return Math.abs(remaining - expectedSeconds) <= toleranceSeconds
}

describe("POST /api/login", () => {
  it("returns both an access token and a refresh_token on success", async () => {
    const res = await request(app).post("/api/login").send(CREDS)
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe("string")
    expect(typeof res.body.refresh_token).toBe("string")
  })

  it("the access token expires in ~1 day, the refresh token TTL is ~30 days", async () => {
    const res = await request(app).post("/api/login").send(CREDS)
    const decoded = jwt.decode(res.body.token)
    expect(expiresWithin(decoded.exp, 24 * 60 * 60)).toBe(true)

    const ttl = await redis.ttl(`refresh_token:${res.body.refresh_token}`)
    expect(expiresWithin(Math.floor(Date.now() / 1000) + ttl, 30 * 24 * 60 * 60)).toBe(true)
  })

  it("the refresh_token is usable at POST /api/refresh", async () => {
    const login = await request(app).post("/api/login").send(CREDS)
    const res = await request(app).post("/api/refresh").send({ refresh_token: login.body.refresh_token })
    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe("string")
  })
})

describe("POST /api/refresh", () => {
  it("issues a fresh access token that itself passes admin auth", async () => {
    const login = await request(app).post("/api/login").send(CREDS)
    const refreshed = await request(app).post("/api/refresh").send({ refresh_token: login.body.refresh_token })

    const res = await request(app).get("/api/admin/orders").set("Authorization", `Bearer ${refreshed.body.token}`)
    expect(res.status).toBe(200)
  })

  it("rotates the refresh token - the old one is a single-use credential", async () => {
    const login = await request(app).post("/api/login").send(CREDS)
    const first = await request(app).post("/api/refresh").send({ refresh_token: login.body.refresh_token })
    expect(first.status).toBe(200)
    expect(first.body.refresh_token).not.toBe(login.body.refresh_token)

    const reuse = await request(app).post("/api/refresh").send({ refresh_token: login.body.refresh_token })
    expect(reuse.status).toBe(401)
  })

  it("401s for an unknown/invalid refresh_token", async () => {
    const res = await request(app).post("/api/refresh").send({ refresh_token: "not-a-real-token" })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("invalid_refresh_token")
  })

  it("400s when refresh_token is missing", async () => {
    const res = await request(app).post("/api/refresh").send({})
    expect(res.status).toBe(400)
  })

  it("never accepts an admin JWT as a refresh_token (different credential, different check)", async () => {
    const adminJwt = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" })
    const res = await request(app).post("/api/refresh").send({ refresh_token: adminJwt })
    expect(res.status).toBe(401)
  })
})
