import { describe, it, expect, afterAll } from "vitest"
import { randomInt } from "node:crypto"
import request from "supertest"
import app from "../server.js"
import { closeDb } from "./helpers/db.js"

afterAll(async () => {
  await closeDb()
})

// server.js dispatches the per-path rate limiters from a regex match on
// req.path, so a request that still reaches the same route but doesn't match
// the regex silently falls through to a weaker limiter. Express routes
// `/x/draw/` and `/x/draw` to the same handler, so the only observable
// difference is which limiter's headers come back - `RateLimit-Limit` is the
// limiter's configured `max`, and each limiter here has a distinct one
// (draw 60/min, booth session 30/min, proof 20/hour, practice 30/min,
// global fallback 600/min). These requests are unauthenticated and 401 on
// purpose: the limiter dispatcher runs ahead of `auth`, so the headers are
// still proof of which limiter ran.
const limitOf = (res) => res.headers["ratelimit-limit"]

const GLOBAL_LIMIT = "600"
const DRAW_LIMIT = "60"
const BOOTH_SESSION_LIMIT = "30"
const PROOF_LIMIT = "20"
const PRACTICE_LIMIT = 30

// `trust proxy: 2` makes req.ip the left-most of the two hops appended here,
// so each exhaustion test gets its own rate-limit bucket instead of spending
// the shared 127.0.0.1 budget other test files rely on. The bucket also has
// to be fresh per run: the Redis counters outlive the process for a full
// minute, so a fixed IP would carry its spent budget into a re-run.
const freshIp = () => `198.51.${randomInt(256)}.${randomInt(256)}, 10.0.0.1`

describe("per-path rate limiter dispatch is not bypassable with a trailing slash", () => {
  it("applies the gacha draw limiter to the admin draw path", async () => {
    const res = await request(app).post("/api/admin/gacha-sessions/1/draw").send({})
    expect(limitOf(res)).toBe(DRAW_LIMIT)
  })

  it("applies the gacha draw limiter to the admin draw path with a trailing slash", async () => {
    const res = await request(app).post("/api/admin/gacha-sessions/1/draw/").send({})
    expect(limitOf(res)).toBe(DRAW_LIMIT)
  })

  it("applies the booth-session limiter to the booth-session creation path", async () => {
    const res = await request(app).post("/api/admin/gacha-products/1/booth-sessions").send({})
    expect(limitOf(res)).toBe(BOOTH_SESSION_LIMIT)
  })

  it("applies the booth-session limiter to the booth-session creation path with a trailing slash", async () => {
    const res = await request(app).post("/api/admin/gacha-products/1/booth-sessions/").send({})
    expect(limitOf(res)).toBe(BOOTH_SESSION_LIMIT)
  })

  it("applies the proof-upload limiter to the buyer proof path, with or without a trailing slash", async () => {
    const plain = await request(app).post("/api/orders/deadbeefdeadbeefdeadbeefdeadbeef/proof").send({})
    const trailing = await request(app).post("/api/orders/deadbeefdeadbeefdeadbeefdeadbeef/proof/").send({})
    expect(limitOf(plain)).toBe(PROOF_LIMIT)
    expect(limitOf(trailing)).toBe(PROOF_LIMIT)
  })

  it("applies the buyer gacha draw limiter to the order draw path, with or without a trailing slash", async () => {
    const plain = await request(app).post("/api/orders/deadbeefdeadbeefdeadbeefdeadbeef/gacha-session/draw").send({})
    const trailing = await request(app).post("/api/orders/deadbeefdeadbeefdeadbeefdeadbeef/gacha-session/draw/").send({})
    expect(limitOf(plain)).toBe(DRAW_LIMIT)
    expect(limitOf(trailing)).toBe(DRAW_LIMIT)
  })

  // The practice path can't be checked by header alone: its limiter only
  // shadows publicLimiter, which runs next and overwrites `RateLimit-Limit`
  // with its own 120. Exhausting the 30 instead makes the dispatch observable
  // - publicLimiter's 120 is nowhere near spent at that point, so a 429 here
  // can only have come from the practice limiter.
  it("applies the gacha practice limiter to the practice-draw path with a trailing slash", async () => {
    const practiceIp = freshIp()
    let res
    for (let i = 0; i <= PRACTICE_LIMIT; i++) {
      res = await request(app)
        .post("/api/shop/gacha/1/practice-draw/")
        .set("X-Forwarded-For", practiceIp)
        .send({})
    }
    expect(res.status).toBe(429)
    expect(limitOf(res)).toBe(String(PRACTICE_LIMIT))
  })

  it("leaves an unmatched shop POST on the public limiter past the practice ceiling (guards the test above)", async () => {
    const controlIp = freshIp()
    let res
    for (let i = 0; i <= PRACTICE_LIMIT; i++) {
      res = await request(app)
        .post("/api/shop/collections")
        .set("X-Forwarded-For", controlIp)
        .send({})
    }
    expect(res.status).not.toBe(429)
  })

  it("leaves an unmatched admin POST on the global limiter (guards the assertions above)", async () => {
    const res = await request(app).post("/api/admin/email-templates").send({})
    expect(limitOf(res)).toBe(GLOBAL_LIMIT)
  })
})
