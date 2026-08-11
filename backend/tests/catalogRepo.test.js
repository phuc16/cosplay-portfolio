import { describe, it, expect, beforeEach, afterAll } from "vitest"
import repo from "../shop/catalogRepo.js"
import db from "../db.js"
import { resetTables, closeDb } from "./helpers/db.js"

beforeEach(async () => {
  // order_items/orders must be reset too: TRUNCATE resets product_variants'
  // autoincrement, so a leftover order from a previous run/file can reference
  // a variant id that a new test's variant then reuses, false-tripping the
  // live-order delete guard in replaceVariants.
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

afterAll(async () => {
  await closeDb()
})

describe("createCollection", () => {
  it("generates a slug from the Vietnamese title", async () => {
    const id = await repo.createCollection({ title: "Bộ sưu tập Hè", status: "active" })
    const all = await repo.listAllCollections()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(id)
    expect(all[0].slug).toBe("bo-suu-tap-he")
  })

  it("de-duplicates slugs across collections with the same title", async () => {
    await repo.createCollection({ title: "Summer", status: "active" })
    await repo.createCollection({ title: "Summer", status: "active" })
    const slugs = (await repo.listAllCollections()).map((c) => c.slug).sort()
    expect(slugs).toEqual(["summer", "summer-2"])
  })

  it("returns fulfillment flags as booleans", async () => {
    await repo.createCollection({ title: "Fes", status: "active", allow_ship: true, allow_pickup: true })
    const [c] = await repo.listAllCollections()
    expect(c.allow_ship).toBe(true)
    expect(c.allow_pickup).toBe(true)
  })
})

describe("listPublicCollections", () => {
  it("hides draft and archived collections but shows active and closed", async () => {
    await repo.createCollection({ title: "Draft one", status: "draft" })
    await repo.createCollection({ title: "Active one", status: "active" })
    await repo.createCollection({ title: "Closed one", status: "closed" })
    await repo.createCollection({ title: "Archived one", status: "archived" })

    const titles = (await repo.listPublicCollections()).map((c) => c.title).sort()
    expect(titles).toEqual(["Active one", "Closed one"])
  })

  it("includes a product count", async () => {
    const cid = await repo.createCollection({ title: "Has products", status: "active" })
    await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.createProduct({ collection_id: cid, name: "Poster", price: 90000 })

    const [c] = await repo.listPublicCollections()
    expect(c.product_count).toBe(2)
  })
})

describe("getPublicCollectionBySlug", () => {
  it("returns null for a draft collection", async () => {
    await repo.createCollection({ title: "Secret", status: "draft" })
    expect(await repo.getPublicCollectionBySlug("secret")).toBeNull()
  })

  it("nests products and their variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [
      { label: "A1", stock_qty: 3, image_url: "/api/storage/a1.webp" },
      { label: "A2", stock_qty: null, image_url: null },
    ])

    const detail = await repo.getPublicCollectionBySlug("drop")
    expect(detail.title).toBe("Drop")
    expect(detail.products).toHaveLength(1)
    expect(detail.products[0].price).toBe(35000)
    expect(detail.products[0].variants.map((v) => v.label)).toEqual(["A1", "A2"])
    expect(detail.products[0].variants[0].stock_qty).toBe(3)
    expect(detail.products[0].variants[1].stock_qty).toBeNull()
  })
})

describe("getCollectionDetailById", () => {
  it("returns full product/variant detail for an archived collection, unlike getPublicCollectionBySlug", async () => {
    const cid = await repo.createCollection({ title: "Vault", status: "archived" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Photocard", price: 35000 })
    await repo.replaceVariants(pid, [
      { label: "A1", stock_qty: 3 },
      { label: "A2", stock_qty: null },
    ])

    expect(await repo.getPublicCollectionBySlug("vault")).toBeNull()

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.title).toBe("Vault")
    expect(detail.status).toBe("archived")
    expect(detail.products).toHaveLength(1)
    expect(detail.products[0].name).toBe("Photocard")
    expect(detail.products[0].variants.map((v) => v.label)).toEqual(["A1", "A2"])
    expect(detail.products[0].variants[0].stock_qty).toBe(3)
    expect(detail.products[0].variants[1].stock_qty).toBeNull()
  })

  it("returns null for a nonexistent id", async () => {
    expect(await repo.getCollectionDetailById(999999)).toBeNull()
  })
})

describe("replaceVariants", () => {
  it("inserts, updates and deletes to match the given list", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }, { label: "A2", stock_qty: 2 }])

    let detail = await repo.getPublicCollectionBySlug("drop")
    const a1 = detail.products[0].variants.find((v) => v.label === "A1")

    // Keep A1 (restocked), drop A2, add A3.
    await repo.replaceVariants(pid, [
      { id: a1.id, label: "A1", stock_qty: 9 },
      { label: "A3", stock_qty: 5 },
    ])

    detail = await repo.getPublicCollectionBySlug("drop")
    const byLabel = Object.fromEntries(detail.products[0].variants.map((v) => [v.label, v.stock_qty]))
    expect(byLabel).toEqual({ A1: 9, A3: 5 })
  })

  it("rolls back the entire write when a later item in the list fails", async () => {
    const cid = await repo.createCollection({ title: "Rollback", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [
      { label: "A1", stock_qty: 1 },
      { label: "A2", stock_qty: 2 },
    ])

    const [before] = await db.query(
      "SELECT id, label, stock_qty, sort_order FROM product_variants WHERE product_id = ? ORDER BY id ASC",
      [pid]
    )
    expect(before).toHaveLength(2)

    const tooLong = "x".repeat(192)
    await expect(
      repo.replaceVariants(pid, [
        { label: "A1-renamed", stock_qty: 1 },
        { label: tooLong, stock_qty: 99 },
      ])
    ).rejects.toThrow()

    const [after] = await db.query(
      "SELECT id, label, stock_qty, sort_order FROM product_variants WHERE product_id = ? ORDER BY id ASC",
      [pid]
    )
    expect(after).toEqual(before)
  })

  it("no-ops silently when passed a variant id belonging to a different product", async () => {
    const cidA = await repo.createCollection({ title: "Product A owner", status: "active" })
    const pidA = await repo.createProduct({ collection_id: cidA, name: "A", price: 1000 })
    await repo.replaceVariants(pidA, [{ label: "A1", stock_qty: 1 }])

    const cidB = await repo.createCollection({ title: "Product B owner", status: "active" })
    const pidB = await repo.createProduct({ collection_id: cidB, name: "B", price: 2000 })
    await repo.replaceVariants(pidB, [{ label: "B1", stock_qty: 5 }])

    const [[variantB]] = await db.query(
      "SELECT * FROM product_variants WHERE product_id = ?",
      [pidB]
    )

    await expect(
      repo.replaceVariants(pidA, [{ id: variantB.id, label: "Hijacked", stock_qty: 999 }])
    ).resolves.not.toThrow()

    const [[variantBAfter]] = await db.query(
      "SELECT * FROM product_variants WHERE id = ?",
      [variantB.id]
    )
    expect(variantBAfter).toEqual(variantB)
  })
})

describe("deleteCollection", () => {
  it("cascades to products and variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])

    await repo.deleteCollection(cid)

    const [products] = await db.query("SELECT id FROM products")
    const [variants] = await db.query("SELECT id FROM product_variants")
    expect(products).toHaveLength(0)
    expect(variants).toHaveLength(0)
  })
})

describe("updateCollection", () => {
  it("re-derives the slug from a renamed title", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "draft" })

    await repo.updateCollection(cid, { title: "Fes HH2027", status: "draft" })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.slug).toBe("fes-hh2027")
  })

  it("keeps the same slug when the title is unchanged (no needless -2 bump)", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "draft" })

    await repo.updateCollection(cid, { title: "Fes HH2026", status: "active" })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.slug).toBe("fes-hh2026")
  })

  it("de-duplicates the new slug against other collections", async () => {
    await repo.createCollection({ title: "Summer", status: "draft" })
    const cid = await repo.createCollection({ title: "Other", status: "draft" })

    await repo.updateCollection(cid, { title: "Summer", status: "draft" })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.slug).toBe("summer-2")
  })
})

describe("copyCollection", () => {
  it("returns null for a nonexistent collection", async () => {
    expect(await repo.copyCollection(999999)).toBeNull()
  })

  it("creates a new draft collection with '(Copy)' appended to the title, regardless of the source's status", async () => {
    const cid = await repo.createCollection({
      title: "Fes HH2026", status: "active", description: "Desc",
      cover_image: "https://x/cover.jpg", thumbnail_image: "https://x/thumb.jpg",
      allow_ship: true, allow_pickup: true,
      pickup_location: "Trạm sự kiện", pickup_note: "Quầy check-in",
    })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)

    expect(copy.title).toBe("Fes HH2026 (Copy)")
    expect(copy.slug).toBe("fes-hh2026-copy")
    expect(copy.status).toBe("draft")
    expect(copy.description).toBe("Desc")
    expect(copy.cover_image).toBe("https://x/cover.jpg")
    expect(copy.thumbnail_image).toBe("https://x/thumb.jpg")
    expect(copy.allow_ship).toBe(true)
    expect(copy.allow_pickup).toBe(true)
    expect(copy.pickup_location).toBe("Trạm sự kiện")
    expect(copy.pickup_note).toBe("Quầy check-in")
  })

  it("copies every product and variant into the new collection, leaving the source untouched", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Photocard", description: "d", price: 35000, images: ["https://x/p.jpg"],
    })
    await repo.replaceVariants(pid, [
      { label: "A1", image_url: "https://x/a1.jpg", stock_qty: 12 },
      { label: "B2", image_url: null, stock_qty: null },
    ])

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)

    expect(copy.products).toHaveLength(1)
    expect(copy.products[0].name).toBe("Photocard")
    expect(copy.products[0].price).toBe(35000)
    expect(copy.products[0].images).toEqual(["https://x/p.jpg"])
    const labels = copy.products[0].variants.map((v) => v.label).sort()
    expect(labels).toEqual(["A1", "B2"])
    const a1 = copy.products[0].variants.find((v) => v.label === "A1")
    expect(a1.image_url).toBe("https://x/a1.jpg")
    expect(a1.stock_qty).toBe(12)
    const b2 = copy.products[0].variants.find((v) => v.label === "B2")
    expect(b2.stock_qty).toBeNull()

    // Source collection and its product/variant ids must be untouched.
    const source = await repo.getCollectionDetailById(cid)
    expect(source.products).toHaveLength(1)
    expect(source.products[0].id).not.toBe(copy.products[0].id)
  })

  it("second copy of the same source gets a further-deduplicated slug", async () => {
    const cid = await repo.createCollection({ title: "Fes HH2026", status: "active" })

    await repo.copyCollection(cid)
    const secondCopyId = await repo.copyCollection(cid)

    const secondCopy = await repo.getCollectionDetailById(secondCopyId)
    expect(secondCopy.slug).toBe("fes-hh2026-copy-2")
  })
})
