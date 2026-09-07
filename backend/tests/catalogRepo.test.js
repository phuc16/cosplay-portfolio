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

describe("variant thumbnail_image", () => {
  it("is never included in images - separate cover, not part of the gallery", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [
      { label: "A1", images: ["https://x/a.jpg", "https://x/b.jpg"], thumbnail_image: "https://x/thumb.jpg", stock_qty: 5 },
    ])

    const detail = await repo.getCollectionDetailById(cid)
    const variant = detail.products[0].variants[0]
    expect(variant.thumbnail_image).toBe("https://x/thumb.jpg")
    expect(variant.images).toEqual(["https://x/a.jpg", "https://x/b.jpg"])
  })

  it("defaults to null when not submitted, so callers fall back to images[0]/image_url", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", images: ["https://x/a.jpg"], stock_qty: 5 }])

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].thumbnail_image).toBeNull()
  })

  it("can be set and cleared on an existing variant via replaceVariants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    let detail = await repo.getCollectionDetailById(cid)
    const variantId = detail.products[0].variants[0].id

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", thumbnail_image: "https://x/thumb.jpg", stock_qty: 5 }])
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].thumbnail_image).toBe("https://x/thumb.jpg")

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", thumbnail_image: "", stock_qty: 5 }])
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].thumbnail_image).toBeNull()
  })
})

describe("variant description", () => {
  it("saves and returns a variant's own markdown description, independent of the product's", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Áo Tài", price: 319000, description: "Product-level description",
    })
    await repo.replaceVariants(pid, [
      { label: "Size khác", description: "**Bảng size**\n\n| SIZE | XL |\n| --- | --- |", stock_qty: 5 },
    ])

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].description).toBe("Product-level description")
    expect(detail.products[0].variants[0].description).toBe("**Bảng size**\n\n| SIZE | XL |\n| --- | --- |")
  })

  it("defaults to null when not submitted", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].description).toBeNull()
  })

  it("can be set and cleared on an existing variant via replaceVariants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    let detail = await repo.getCollectionDetailById(cid)
    const variantId = detail.products[0].variants[0].id

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", description: "Size chart here", stock_qty: 5 }])
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].description).toBe("Size chart here")

    await repo.replaceVariants(pid, [{ id: variantId, label: "A1", description: "", stock_qty: 5 }])
    detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].variants[0].description).toBeNull()
  })
})

describe("digital products", () => {
  it("creates a digital product with a hidden variant carrying stock_qty and delivery_link", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000,
      images: ["https://x/cover.jpg"], type: "digital",
      stock_qty: 50, delivery_link: "https://drive.google.com/abc",
    })

    const detail = await repo.getCollectionDetailById(cid)
    const product = detail.products[0]
    expect(product.type).toBe("digital")
    expect(product.images).toEqual(["https://x/cover.jpg"])
    expect(product.variants).toEqual([])
    expect(product.stock_qty).toBe(50)
    expect(product.delivery_link).toBe("https://drive.google.com/abc")
    expect(typeof product.variant_id).toBe("number")

    const [[hidden]] = await db.query("SELECT label FROM product_variants WHERE product_id = ?", [pid])
    expect(hidden.label).toBe("")
  })

  it("defaults type to physical when not submitted, unchanged from before", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.products[0].type).toBe("physical")
    expect(detail.products[0].variants).toEqual([])

    const [rows] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    expect(rows).toHaveLength(0)
  })

  it("updates a digital product's hidden variant in place, keeping the same variant_id", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 10, delivery_link: "https://drive.google.com/v1",
    })
    const before = (await repo.getCollectionDetailById(cid)).products[0]

    await repo.updateProduct(pid, {
      name: "Digital Album v2", price: 120000, images: [],
      stock_qty: 5, delivery_link: "https://drive.google.com/v2",
    })

    const after = (await repo.getCollectionDetailById(cid)).products[0]
    expect(after.name).toBe("Digital Album v2")
    expect(after.stock_qty).toBe(5)
    expect(after.delivery_link).toBe("https://drive.google.com/v2")
    expect(after.variant_id).toBe(before.variant_id)
  })

  it("does not throw VariantInUseError when updating a digital product with a live order", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital", stock_qty: 10,
    })
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variant_id
    await db.query(
      `INSERT INTO orders (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, expires_at, access_pin_hash)
       VALUES ('tok1', 'A', '0900000000', 'a@example.com', 'digital', 'pending', 'bank', 99000, NOW(), 'x')`
    )
    const [[o]] = await db.query("SELECT id FROM orders WHERE order_token = 'tok1'")
    await db.query(
      "INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty) VALUES (?, ?, 'Digital Album', '', 99000, 1)",
      [o.id, variantId]
    )

    await expect(repo.updateProduct(pid, { name: "Digital Album", price: 99000, stock_qty: 10 })).resolves.toBe(true)
  })

  it("copyCollection carries a digital product's type, stock_qty, and delivery_link through", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 3, delivery_link: "https://drive.google.com/orig",
    })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)
    expect(copy.products[0].type).toBe("digital")
    expect(copy.products[0].stock_qty).toBe(3)
    expect(copy.products[0].delivery_link).toBe("https://drive.google.com/orig")
  })

  it("never exposes delivery_link on the public path, but does on the admin path", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 10, delivery_link: "https://drive.google.com/secret",
    })

    const publicDetail = await repo.getPublicCollectionBySlug("drop")
    expect(publicDetail.products[0].delivery_link).toBeUndefined()
    expect(publicDetail.products[0].stock_qty).toBe(10)

    const adminDetail = await repo.getCollectionDetailById(cid)
    expect(adminDetail.products[0].delivery_link).toBe("https://drive.google.com/secret")
  })

  it("updateProduct preserves an omitted delivery_link/stock_qty instead of nulling them", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({
      collection_id: cid, name: "Digital Album", price: 99000, type: "digital",
      stock_qty: 7, delivery_link: "https://drive.google.com/keepme",
    })

    await repo.updateProduct(pid, { name: "Digital Album v2", price: 1, description: "" })

    const after = (await repo.getCollectionDetailById(cid)).products[0]
    expect(after.name).toBe("Digital Album v2")
    expect(after.stock_qty).toBe(7)
    expect(after.delivery_link).toBe("https://drive.google.com/keepme")
  })
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

  it("stores a custom payment_deadline_hours override", async () => {
    await repo.createCollection({ title: "Fes", status: "active", payment_deadline_hours: 24 })
    const [c] = await repo.listAllCollections()
    expect(c.payment_deadline_hours).toBe(24)
  })

  it("leaves payment_deadline_hours null when not given", async () => {
    await repo.createCollection({ title: "Fes", status: "active" })
    const [c] = await repo.listAllCollections()
    expect(c.payment_deadline_hours).toBeNull()
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

/** Inserts an order + single order_item referencing variantId, at the given status. */
async function insertOrderForVariant(variantId, status, token) {
  await db.query(
    `INSERT INTO orders (order_token, buyer_name, phone, email, fulfillment_method, status, payment_method, total, expires_at, access_pin_hash)
     VALUES (?, 'A', '0900000000', 'a@example.com', 'ship', ?, 'bank', 99000, NOW(), 'x')`,
    [token, status]
  )
  const [[o]] = await db.query("SELECT id FROM orders WHERE order_token = ?", [token])
  await db.query(
    "INSERT INTO order_items (order_id, product_variant_id, product_name_snapshot, variant_label_snapshot, unit_price_snapshot, qty) VALUES (?, ?, 'Card', 'A1', 99000, 1)",
    [o.id, variantId]
  )
}

describe("deleteProduct", () => {
  it("rejects with VariantInUseError when a variant is referenced by a pending/confirmed/shipped order", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variants[0].id
    await insertOrderForVariant(variantId, "pending", "tok-del-product-1")

    await expect(repo.deleteProduct(pid)).rejects.toThrow(repo.VariantInUseError)

    const [products] = await db.query("SELECT id FROM products WHERE id = ?", [pid])
    expect(products).toHaveLength(1)
  })

  it("deletes normally when no live orders reference its variants", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])

    await expect(repo.deleteProduct(pid)).resolves.toBe(true)

    const [products] = await db.query("SELECT id FROM products WHERE id = ?", [pid])
    expect(products).toHaveLength(0)
  })

  it("does not block deletion when the only referencing order is cancelled or completed", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variants[0].id
    await insertOrderForVariant(variantId, "cancelled", "tok-del-product-2")
    await insertOrderForVariant(variantId, "completed", "tok-del-product-3")

    await expect(repo.deleteProduct(pid)).resolves.toBe(true)
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

  it("rejects with VariantInUseError when any product's variant is referenced by a live order", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variants[0].id
    await insertOrderForVariant(variantId, "confirmed", "tok-del-collection-1")

    await expect(repo.deleteCollection(cid)).rejects.toThrow(repo.VariantInUseError)

    const [collections] = await db.query("SELECT id FROM collections WHERE id = ?", [cid])
    expect(collections).toHaveLength(1)
  })

  it("does not block deletion when the only referencing order is cancelled or completed", async () => {
    const cid = await repo.createCollection({ title: "Drop", status: "active" })
    const pid = await repo.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await repo.replaceVariants(pid, [{ label: "A1", stock_qty: 1 }])
    const variantId = (await repo.getCollectionDetailById(cid)).products[0].variants[0].id
    await insertOrderForVariant(variantId, "completed", "tok-del-collection-2")

    await expect(repo.deleteCollection(cid)).resolves.toBe(true)
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

  it("updates payment_deadline_hours, and clears it back to null when omitted", async () => {
    const cid = await repo.createCollection({ title: "Fes", status: "draft", payment_deadline_hours: 24 })

    await repo.updateCollection(cid, { title: "Fes", status: "draft", payment_deadline_hours: 72 })
    expect((await repo.getCollectionDetailById(cid)).payment_deadline_hours).toBe(72)

    await repo.updateCollection(cid, { title: "Fes", status: "draft" })
    expect((await repo.getCollectionDetailById(cid)).payment_deadline_hours).toBeNull()
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
      { label: "A1", image_url: "https://x/a1.jpg", thumbnail_image: "https://x/a1-thumb.jpg", stock_qty: 12 },
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
    expect(a1.thumbnail_image).toBe("https://x/a1-thumb.jpg")
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

describe("collection scheduling", () => {
  it("hides a not-yet-started collection from the public list and slug lookup", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Future Drop", status: "active", start_at: future })

    const list = await repo.listPublicCollections()
    expect(list.find((c) => c.id === cid)).toBeUndefined()
    expect(await repo.getPublicCollectionBySlug((await repo.getCollectionDetailById(cid)).slug)).toBeNull()
  })

  it("still shows a not-yet-started collection to the admin", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Future Drop", status: "active", start_at: future })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("active")
    // start_at is a DATETIME column (no fractional seconds), so MySQL
    // rounds sub-second precision on write - allow up to 1s of drift.
    expect(Math.abs(new Date(detail.start_at).getTime() - future.getTime())).toBeLessThanOrEqual(1000)
  })

  it("shows a collection once its start_at has passed", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Live Drop", status: "active", start_at: past })

    const list = await repo.listPublicCollections()
    expect(list.find((c) => c.id === cid)).toBeTruthy()
  })

  it("really closes a collection past end_at, on the admin path, persisted to the DB row", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("closed")

    const [[row]] = await db.query("SELECT status FROM collections WHERE id = ?", [cid])
    expect(row.status).toBe("closed")
  })

  it("really closes a collection past end_at, on the public path too", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })
    const slug = (await repo.getCollectionDetailById(cid)).slug

    const detail = await repo.getPublicCollectionBySlug(slug)
    expect(detail.status).toBe("closed")

    const [[row]] = await db.query("SELECT status FROM collections WHERE id = ?", [cid])
    expect(row.status).toBe("closed")
  })

  it("closes a collection past end_at when surfaced via listAllCollections/listPublicCollections too", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    const adminList = await repo.listAllCollections()
    expect(adminList.find((c) => c.id === cid).status).toBe("closed")

    const publicList = await repo.listPublicCollections()
    expect(publicList.find((c) => c.id === cid).status).toBe("closed")
  })

  it("is idempotent - reading an already-closed-by-expiry collection again does not error or change anything", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Ended Drop", status: "active", end_at: past })

    await repo.getCollectionDetailById(cid)
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("closed")
  })

  it("never auto-closes a collection with no end_at set", async () => {
    const cid = await repo.createCollection({ title: "Forever Drop", status: "active" })
    const detail = await repo.getCollectionDetailById(cid)
    expect(detail.status).toBe("active")
  })

  it("accepts start_at/end_at as raw ISO strings with milliseconds/Z (e.g. from .toISOString()) without throwing ER_TRUNCATED_WRONG_VALUE", async () => {
    const start = new Date(Date.now() - 60 * 60 * 1000)
    const end = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({
      title: "ISO String Drop",
      status: "active",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    })

    const detail = await repo.getCollectionDetailById(cid)
    // DATETIME has second precision, so allow up to 1s of drift.
    expect(Math.abs(new Date(detail.start_at).getTime() - start.getTime())).toBeLessThanOrEqual(1000)
    expect(Math.abs(new Date(detail.end_at).getTime() - end.getTime())).toBeLessThanOrEqual(1000)
  })

  it("treats a naive-looking ISO string with a Z suffix as an unambiguous UTC instant, not local time", async () => {
    // Pins the contract the frontend now always relies on: normalizeDatetime
    // must never re-interpret an already-unambiguous instant (Z suffix) in
    // any timezone other than the one it names - UTC. A value like
    // "2026-09-10T09:00:00.000Z" must always mean 09:00 UTC, regardless of
    // what timezone the Node process running this test happens to be in.
    const isoUtc = "2026-09-10T09:00:00.000Z"
    const cid = await repo.createCollection({ title: "UTC Pin Drop", status: "active", start_at: isoUtc })

    const detail = await repo.getCollectionDetailById(cid)
    expect(new Date(detail.start_at).getTime()).toBe(new Date(isoUtc).getTime())
    expect(new Date(detail.start_at).toISOString()).toBe(isoUtc)
  })

  it("does not carry start_at/end_at into a copyCollection duplicate", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const cid = await repo.createCollection({ title: "Scheduled", status: "active", start_at: future, end_at: future })

    const newId = await repo.copyCollection(cid)
    const copy = await repo.getCollectionDetailById(newId)
    expect(copy.start_at).toBeNull()
    expect(copy.end_at).toBeNull()
  })
})
