import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchCollections = vi.fn()
const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollections: (...args) => fetchCollections(...args),
  fetchCollection: (...args) => fetchCollection(...args),
}))

const { hasReorderableItems, reorderOrderItems } = await import("./reorder")
const { readCart } = await import("./cart")

beforeEach(() => {
  localStorage.clear()
  fetchCollections.mockReset()
  fetchCollection.mockReset()
})

function listedCollection(over = {}) {
  return { id: 1, slug: "drop", status: "active", not_started_yet: false, ...over }
}

function physicalDetail(over = {}) {
  return {
    id: 1, slug: "drop", status: "active", not_started_yet: false,
    products: [
      {
        id: 10, name: "Card", price: 40000, type: "physical", images: ["/p.webp"],
        variants: [{ id: 100, label: "A1", stock_qty: 5, image_url: "/a1.webp" }],
      },
    ],
    ...over,
  }
}

function digitalDetail(over = {}) {
  return {
    id: 1, slug: "drop", status: "active", not_started_yet: false,
    products: [
      {
        id: 20, name: "Album", price: 99000, type: "digital", images: ["/album.webp"],
        variant_id: 200, stock_qty: 3, thumbnail_image: "/album-thumb.webp",
      },
    ],
    ...over,
  }
}

function orderItem(over = {}) {
  return {
    id: 1, product_variant_id: 100, product_name_snapshot: "Card",
    variant_label_snapshot: "A1", unit_price_snapshot: 35000, qty: 2,
    collection_id_snapshot: 1, is_gift: false,
    ...over,
  }
}

describe("hasReorderableItems", () => {
  it("is false for an empty order", () => {
    expect(hasReorderableItems([])).toBe(false)
    expect(hasReorderableItems(undefined)).toBe(false)
  })

  it("is false when every item is a gift", () => {
    expect(hasReorderableItems([orderItem({ is_gift: true })])).toBe(false)
  })

  it("is false when every item's variant was deleted (product_variant_id NULL)", () => {
    expect(hasReorderableItems([orderItem({ product_variant_id: null })])).toBe(false)
  })

  it("is true when at least one item is non-gift with a live variant id", () => {
    expect(hasReorderableItems([orderItem({ is_gift: true }), orderItem()])).toBe(true)
  })

  it("treats a missing is_gift field as reorderable (pre-free-gift-feature order shape)", () => {
    expect(hasReorderableItems([{ product_variant_id: 100 }])).toBe(true)
  })
})

describe("reorderOrderItems", () => {
  it("adds a still-available physical item at its CURRENT price/name/image, not the order's snapshot", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail())

    const result = await reorderOrderItems({ items: [orderItem({ qty: 2 })] })

    expect(result).toEqual({ addedCount: 1, skipped: [] })
    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({
      variant_id: 100, qty: 2, product_name: "Card", variant_label: "A1",
      price: 40000, image_url: "/a1.webp", collection_slug: "drop", is_digital: false,
    })
  })

  it("adds a still-available digital item, flattening the hidden variant like ProductCard.jsx does", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(digitalDetail())

    const result = await reorderOrderItems({
      items: [orderItem({ product_variant_id: 200, qty: 1 })],
    })

    expect(result).toEqual({ addedCount: 1, skipped: [] })
    const cart = readCart()
    expect(cart[0]).toMatchObject({ variant_id: 200, price: 99000, is_digital: true, image_url: "/album-thumb.webp" })
  })

  it("skips gift items entirely", async () => {
    const result = await reorderOrderItems({ items: [orderItem({ is_gift: true })] })
    expect(result).toEqual({ addedCount: 0, skipped: [] })
    expect(readCart()).toHaveLength(0)
    expect(fetchCollections).not.toHaveBeenCalled()
  })

  it("treats a missing is_gift as not-a-gift and reorders it normally", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail())
    const item = orderItem()
    delete item.is_gift

    const result = await reorderOrderItems({ items: [item] })
    expect(result.addedCount).toBe(1)
  })

  it("skips an item whose variant was deleted (product_variant_id already NULL) without any fetch", async () => {
    const result = await reorderOrderItems({ items: [orderItem({ product_variant_id: null })] })
    expect(result).toEqual({ addedCount: 0, skipped: [] })
    expect(fetchCollections).not.toHaveBeenCalled()
  })

  it("skips with reason 'unavailable' when the collection no longer exists (deleted/archived)", async () => {
    fetchCollections.mockResolvedValue([]) // nothing public any more
    const result = await reorderOrderItems({ items: [orderItem()] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Card", reason: "unavailable" }] })
    expect(fetchCollection).not.toHaveBeenCalled()
  })

  it("skips with reason 'ended' when the collection has closed", async () => {
    fetchCollections.mockResolvedValue([listedCollection({ status: "closed" })])
    fetchCollection.mockResolvedValue(physicalDetail({ status: "closed" }))

    const result = await reorderOrderItems({ items: [orderItem()] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Card", reason: "ended" }] })
  })

  it("skips with reason 'not_started' when the collection hasn't opened yet", async () => {
    fetchCollections.mockResolvedValue([listedCollection({ not_started_yet: true })])
    fetchCollection.mockResolvedValue(physicalDetail({ not_started_yet: true }))

    const result = await reorderOrderItems({ items: [orderItem()] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Card", reason: "not_started" }] })
  })

  it("skips with reason 'unavailable' when the variant/product itself is gone from the collection detail", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail({ products: [] }))

    const result = await reorderOrderItems({ items: [orderItem()] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Card", reason: "unavailable" }] })
  })

  it("skips with reason 'sold_out' for a physical variant with zero stock", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail({
      products: [{ id: 10, name: "Card", price: 40000, type: "physical", images: [], variants: [{ id: 100, label: "A1", stock_qty: 0 }] }],
    }))

    const result = await reorderOrderItems({ items: [orderItem()] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Card", reason: "sold_out" }] })
  })

  it("skips with reason 'sold_out' for a digital product with zero stock", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(digitalDetail({
      products: [{ id: 20, name: "Album", price: 99000, type: "digital", images: [], variant_id: 200, stock_qty: 0 }],
    }))

    const result = await reorderOrderItems({ items: [orderItem({ product_variant_id: 200, product_name_snapshot: "Album" })] })
    expect(result).toEqual({ addedCount: 0, skipped: [{ name: "Album", reason: "sold_out" }] })
  })

  it("clamps qty down to current stock when less is left than originally bought", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail({
      products: [{ id: 10, name: "Card", price: 40000, type: "physical", images: [], variants: [{ id: 100, label: "A1", stock_qty: 1 }] }],
    }))

    const result = await reorderOrderItems({ items: [orderItem({ qty: 3 })] })
    expect(result).toEqual({ addedCount: 1, skipped: [] })
    expect(readCart()[0].qty).toBe(1)
  })

  it("does not clamp qty when stock is unlimited (null stock_qty)", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail({
      products: [{ id: 10, name: "Card", price: 40000, type: "physical", images: [], variants: [{ id: 100, label: "A1", stock_qty: null }] }],
    }))

    const result = await reorderOrderItems({ items: [orderItem({ qty: 7 })] })
    expect(result.addedCount).toBe(1)
    expect(readCart()[0].qty).toBe(7)
  })

  it("fetches each distinct collection's detail only once, even with multiple items in it", async () => {
    fetchCollections.mockResolvedValue([listedCollection()])
    fetchCollection.mockResolvedValue(physicalDetail({
      products: [
        { id: 10, name: "Card A", price: 40000, type: "physical", images: [], variants: [{ id: 100, label: "A1", stock_qty: 5 }] },
        { id: 11, name: "Card B", price: 40000, type: "physical", images: [], variants: [{ id: 101, label: "B1", stock_qty: 5 }] },
      ],
    }))

    const result = await reorderOrderItems({
      items: [orderItem({ product_variant_id: 100, product_name_snapshot: "Card A" }),
        orderItem({ id: 2, product_variant_id: 101, product_name_snapshot: "Card B" })],
    })

    expect(result.addedCount).toBe(2)
    expect(fetchCollection).toHaveBeenCalledTimes(1)
  })

  it("degrades to 'unavailable' for every item when the catalog itself is unreachable", async () => {
    fetchCollections.mockRejectedValue(new Error("network down"))

    const result = await reorderOrderItems({
      items: [orderItem({ product_name_snapshot: "Card A" }), orderItem({ id: 2, product_variant_id: 101, product_name_snapshot: "Card B" })],
    })

    expect(result.addedCount).toBe(0)
    expect(result.skipped).toEqual([
      { name: "Card A", reason: "unavailable" },
      { name: "Card B", reason: "unavailable" },
    ])
  })

  it("returns addedCount 0 and no skips for an order with no reorderable items", async () => {
    const result = await reorderOrderItems({ items: [] })
    expect(result).toEqual({ addedCount: 0, skipped: [] })
  })
})
