import { describe, it, expect, beforeEach, afterAll } from "vitest"
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

describe("getSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    const s = await repo.getSettings()
    expect(s.enabled).toBe(false)
    expect(s.name).toBe("")
    expect(s.min_total).toBe(0)
    expect(s.image_url).toBeNull()
    expect(s.note).toBeNull()
    expect(s.delivery_link).toBeNull()
  })
})

describe("updateSettings", () => {
  it("persists a physical gift and survives a reload", async () => {
    await repo.updateSettings({ enabled: true, name: "Postcard", min_total: 200000 })
    const s = await repo.getSettings()
    expect(s.enabled).toBe(true)
    expect(s.name).toBe("Postcard")
    expect(s.min_total).toBe(200000)
    expect(s.delivery_link).toBeNull()
  })

  it("persists a digital gift's delivery_link", async () => {
    await repo.updateSettings({
      enabled: true, name: "Wallpaper pack", min_total: 100000,
      delivery_link: "https://drive.google.com/gift",
    })
    const s = await repo.getSettings()
    expect(s.delivery_link).toBe("https://drive.google.com/gift")
  })

  it("keeps a single row rather than inserting repeatedly", async () => {
    await repo.updateSettings({ enabled: true, name: "A" })
    await repo.updateSettings({ enabled: false, name: "B" })
    const [rows] = await db.query("SELECT id FROM gift_settings")
    expect(rows).toHaveLength(1)
  })

  it("clears optional fields back to null when sent empty", async () => {
    await repo.updateSettings({ enabled: true, name: "A", image_url: "https://x/y.png" })
    await repo.updateSettings({ enabled: true, name: "A", image_url: "" })
    const s = await repo.getSettings()
    expect(s.image_url).toBeNull()
  })
})

describe("publicSettings", () => {
  it("exposes is_digital instead of the raw delivery_link", () => {
    const digital = repo.publicSettings({
      enabled: true, name: "Wallpaper", min_total: 1, image_url: null, note: null,
      delivery_link: "https://secret-link",
    })
    expect(digital.is_digital).toBe(true)
    expect(digital.delivery_link).toBeUndefined()
    expect(JSON.stringify(digital)).not.toContain("secret-link")

    const physical = repo.publicSettings({
      enabled: true, name: "Postcard", min_total: 1, image_url: null, note: null,
      delivery_link: null,
    })
    expect(physical.is_digital).toBe(false)
  })
})
