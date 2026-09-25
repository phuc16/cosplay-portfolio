import { describe, it, expect, beforeEach, vi } from "vitest"
import { readCart, addToCart, updateQty, removeFromCart, clearCart, cartCount, cartTotal, gachaCartConflict } from "./cart"

const item = (over = {}) => ({
  variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1",
  price: 35000, image_url: null, collection_slug: "drop", ...over,
})

beforeEach(() => localStorage.clear())

describe("cart", () => {
  it("starts empty", () => {
    expect(readCart()).toEqual([])
  })

  it("adds an item", () => {
    addToCart(item())
    expect(readCart()).toHaveLength(1)
  })

  it("merges quantity when the same variant is added twice", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ qty: 3 }))

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0].qty).toBe(5)
  })

  it("keeps different variants separate", () => {
    addToCart(item({ variant_id: 1 }))
    addToCart(item({ variant_id: 2, variant_label: "A2" }))
    expect(readCart()).toHaveLength(2)
  })

  it("persists across reads", () => {
    addToCart(item())
    expect(readCart()[0].variant_id).toBe(1)
  })

  it("updates a quantity", () => {
    addToCart(item())
    updateQty(1, 7)
    expect(readCart()[0].qty).toBe(7)
  })

  it("removes an item when quantity drops to zero", () => {
    addToCart(item())
    updateQty(1, 0)
    expect(readCart()).toHaveLength(0)
  })

  it("refuses a negative quantity", () => {
    addToCart(item())
    updateQty(1, -5)
    expect(readCart()).toHaveLength(0)
  })

  it("removes an item explicitly", () => {
    addToCart(item())
    removeFromCart(1)
    expect(readCart()).toEqual([])
  })

  it("clears everything", () => {
    addToCart(item())
    addToCart(item({ variant_id: 2 }))
    clearCart()
    expect(readCart()).toEqual([])
  })

  it("counts total units, not lines", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ variant_id: 2, qty: 3 }))
    expect(cartCount(readCart())).toBe(5)
  })

  it("totals price times quantity", () => {
    addToCart(item({ qty: 2 }))
    addToCart(item({ variant_id: 2, price: 90000, qty: 1 }))
    expect(cartTotal(readCart())).toBe(160000)
  })

  it("recovers from corrupt storage instead of throwing", () => {
    localStorage.setItem("shop_cart", "{not json")
    expect(readCart()).toEqual([])
  })

  it("ignores stored data that is not an array", () => {
    localStorage.setItem("shop_cart", JSON.stringify({ nope: true }))
    expect(readCart()).toEqual([])
  })

  it("drops malformed entries rather than trusting them", () => {
    localStorage.setItem("shop_cart", JSON.stringify([
      { variant_id: 1, qty: 2, price: 35000 },
      { qty: 1 },
      { variant_id: 3, qty: 0, price: 100 },
      { variant_id: 4, qty: 1, price: -5 },
    ]))
    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0].variant_id).toBe(1)
  })

  it("does not crash when localStorage.setItem throws (private browsing, quota exceeded)", () => {
    const mock = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })

    const result = addToCart(item())
    expect(result).toEqual([{ variant_id: 1, qty: 1, product_name: "Card", variant_label: "A1", price: 35000, image_url: null, collection_slug: "drop" }])

    mock.mockRestore()
  })
})

describe("gachaCartConflict", () => {
  const gachaLine = (over = {}) => item({ variant_id: 77, is_gacha: true, product_name: "Mystery Case", ...over })

  it("allows a gacha turn into an empty cart", () => {
    expect(gachaCartConflict(gachaLine(), [])).toBeNull()
  })

  it("allows more turns of the gacha product already in the cart", () => {
    expect(gachaCartConflict(gachaLine(), [gachaLine()])).toBeNull()
  })

  it("blocks a gacha turn when the cart already holds another product", () => {
    expect(gachaCartConflict(gachaLine(), [item()])).toBe("gacha_needs_own_order")
  })

  it("blocks a gacha turn when the cart already holds a different gacha product", () => {
    expect(gachaCartConflict(gachaLine({ variant_id: 88 }), [gachaLine()])).toBe("gacha_needs_own_order")
  })

  it("blocks an ordinary product when the cart already holds gacha turns", () => {
    expect(gachaCartConflict(item(), [gachaLine()])).toBe("cart_has_gacha")
  })

  it("leaves two ordinary products alone", () => {
    expect(gachaCartConflict(item({ variant_id: 2 }), [item()])).toBeNull()
  })

  it("reads the live cart when no cart is passed", () => {
    addToCart(gachaLine())
    expect(gachaCartConflict(item())).toBe("cart_has_gacha")
  })
})
