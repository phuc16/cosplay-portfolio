import { describe, it, expect, beforeEach, afterAll } from "vitest"
import request from "supertest"
import app from "../server.js"
import db from "../db.js"
import repo from "../shop/giftSettings.js"

beforeEach(async () => {
  await db.query("DELETE FROM gift_settings")
})

// createOrder (backend/shop/orders/orderRepo.js) now reads gift_settings
// directly, so a row left behind by this file's last test would otherwise
// leak into whichever test file runs next and calls createOrder.
afterAll(async () => {
  await db.query("DELETE FROM gift_settings")
})

describe("GET /api/shop/gift-settings", () => {
  it("returns defaults with nothing configured", async () => {
    const res = await request(app).get("/api/shop/gift-settings")
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })

  it("exposes is_digital, never the raw delivery_link", async () => {
    await repo.updateSettings({
      enabled: true, name: "Wallpaper", min_total: 100000,
      delivery_link: "https://secret-drive-link",
    })
    const res = await request(app).get("/api/shop/gift-settings")
    expect(res.body.is_digital).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain("secret-drive-link")
  })
})
