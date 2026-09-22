import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  readWishlist, addToWishlist, removeFromWishlist, toggleWishlist,
  isWishlisted, wishlistCount, subscribeWishlist,
} from "./wishlist"

const item = (over = {}) => ({
  variant_id: 1, product_id: 10, collection_slug: "drop",
  product_name: "Card", variant_label: "A1", price: 35000, image_url: null,
  ...over,
})

beforeEach(() => localStorage.clear())

describe("wishlist", () => {
  it("starts empty", () => {
    expect(readWishlist()).toEqual([])
  })

  it("adds an item", () => {
    addToWishlist(item())
    expect(readWishlist()).toHaveLength(1)
  })

  it("does not duplicate when the same variant is added twice", () => {
    addToWishlist(item())
    addToWishlist(item())
    expect(readWishlist()).toHaveLength(1)
  })

  it("keeps different variants separate", () => {
    addToWishlist(item({ variant_id: 1 }))
    addToWishlist(item({ variant_id: 2, variant_label: "A2" }))
    expect(readWishlist()).toHaveLength(2)
  })

  it("persists across reads", () => {
    addToWishlist(item())
    expect(readWishlist()[0].variant_id).toBe(1)
  })

  it("removes an item explicitly", () => {
    addToWishlist(item())
    removeFromWishlist(1)
    expect(readWishlist()).toEqual([])
  })

  it("removing a variant that isn't saved is a no-op", () => {
    addToWishlist(item())
    removeFromWishlist(999)
    expect(readWishlist()).toHaveLength(1)
  })

  describe("toggleWishlist", () => {
    it("adds when absent", () => {
      toggleWishlist(item())
      expect(readWishlist()).toHaveLength(1)
    })

    it("removes when present", () => {
      addToWishlist(item())
      toggleWishlist(item())
      expect(readWishlist()).toEqual([])
    })

    it("toggling twice returns to the original state", () => {
      toggleWishlist(item())
      toggleWishlist(item())
      expect(readWishlist()).toEqual([])
    })
  })

  describe("isWishlisted", () => {
    it("is true for a saved variant", () => {
      addToWishlist(item())
      expect(isWishlisted(1)).toBe(true)
    })

    it("is false for an unsaved variant", () => {
      addToWishlist(item())
      expect(isWishlisted(2)).toBe(false)
    })

    it("accepts a pre-read wishlist instead of re-reading storage", () => {
      const wishlist = addToWishlist(item())
      expect(isWishlisted(1, wishlist)).toBe(true)
    })
  })

  it("counts distinct items, not units - there is no qty concept", () => {
    addToWishlist(item({ variant_id: 1 }))
    addToWishlist(item({ variant_id: 2 }))
    expect(wishlistCount(readWishlist())).toBe(2)
  })

  it("recovers from corrupt storage instead of throwing", () => {
    localStorage.setItem("shop_wishlist", "{not json")
    expect(readWishlist()).toEqual([])
  })

  it("ignores stored data that is not an array", () => {
    localStorage.setItem("shop_wishlist", JSON.stringify({ nope: true }))
    expect(readWishlist()).toEqual([])
  })

  it("drops malformed entries rather than trusting them", () => {
    localStorage.setItem("shop_wishlist", JSON.stringify([
      { variant_id: 1, product_id: 10, collection_slug: "drop" },
      { variant_id: 2 },
      { variant_id: 3, product_id: 10, collection_slug: "" },
      { product_id: 10, collection_slug: "drop" },
    ]))
    const wishlist = readWishlist()
    expect(wishlist).toHaveLength(1)
    expect(wishlist[0].variant_id).toBe(1)
  })

  it("does not crash when localStorage.setItem throws (private browsing, quota exceeded)", () => {
    const mock = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })

    const result = addToWishlist(item())
    expect(result).toEqual([item()])

    mock.mockRestore()
  })

  describe("subscribeWishlist", () => {
    it("notifies subscribers on add/remove/toggle", () => {
      const listener = vi.fn()
      const unsubscribe = subscribeWishlist(listener)

      addToWishlist(item())
      expect(listener).toHaveBeenCalledTimes(1)

      toggleWishlist(item())
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      addToWishlist(item())
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  it("persists across a simulated reload (a fresh read reflects a prior write)", () => {
    addToWishlist(item({ variant_id: 1 }))
    addToWishlist(item({ variant_id: 2 }))
    // Simulate a reload: nothing but localStorage survives, so drop any
    // in-memory state and read fresh.
    expect(readWishlist().map((w) => w.variant_id).sort()).toEqual([1, 2])
  })
})
