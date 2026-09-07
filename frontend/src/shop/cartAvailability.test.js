import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchCollection = vi.fn()

vi.mock("../api/shop", () => ({
  fetchCollection: (...args) => fetchCollection(...args),
}))

const { checkCartAvailability } = await import("./cartAvailability")

const physicalCollection = (overrides = {}) => ({
  status: "active",
  products: [
    { type: "physical", variants: [{ id: 1, stock_qty: 5 }, { id: 2, stock_qty: 0 }] },
  ],
  ...overrides,
})

const digitalCollection = (overrides = {}) => ({
  status: "active",
  products: [
    { type: "digital", variant_id: 10, stock_qty: 3 },
  ],
  ...overrides,
})

beforeEach(() => {
  fetchCollection.mockReset()
})

describe("checkCartAvailability", () => {
  it("returns an empty map when every line is valid", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
  })

  it("flags a sold-out physical variant", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 2, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(2)).toBe("sold_out")
  })

  it("flags a sold-out digital product via its flattened stock_qty", async () => {
    fetchCollection.mockResolvedValue(digitalCollection({ products: [{ type: "digital", variant_id: 10, stock_qty: 0 }] }))
    const cart = [{ variant_id: 10, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(10)).toBe("sold_out")
  })

  it("does not flag an in-stock digital product", async () => {
    fetchCollection.mockResolvedValue(digitalCollection())
    const cart = [{ variant_id: 10, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
  })

  it("flags a line as unavailable when the collection fetch fails (404 — hidden, deleted, or not started)", async () => {
    fetchCollection.mockRejectedValue(new Error("not found"))
    const cart = [{ variant_id: 1, collection_slug: "gone" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(1)).toBe("unavailable")
  })

  it("flags every line as ended when the collection's status is closed", async () => {
    fetchCollection.mockResolvedValue(physicalCollection({ status: "closed" }))
    const cart = [{ variant_id: 1, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(1)).toBe("ended")
  })

  it("flags a line as unavailable when its variant is no longer in the collection's products (deleted since added to cart)", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [{ variant_id: 999, collection_slug: "drop" }]

    const problems = await checkCartAvailability(cart)
    expect(problems.get(999)).toBe("unavailable")
  })

  it("never flags a line with no collection_slug", async () => {
    const cart = [{ variant_id: 1, collection_slug: null }]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(0)
    expect(fetchCollection).not.toHaveBeenCalled()
  })

  it("fetches each distinct collection_slug only once, even with multiple lines from it", async () => {
    fetchCollection.mockResolvedValue(physicalCollection())
    const cart = [
      { variant_id: 1, collection_slug: "drop" },
      { variant_id: 2, collection_slug: "drop" },
    ]

    await checkCartAvailability(cart)
    expect(fetchCollection).toHaveBeenCalledTimes(1)
  })

  it("handles a cart spanning two different collections independently", async () => {
    fetchCollection.mockImplementation((slug) =>
      slug === "a" ? Promise.resolve(physicalCollection()) : Promise.resolve(physicalCollection({ status: "closed" }))
    )
    const cart = [
      { variant_id: 1, collection_slug: "a" },
      { variant_id: 1, collection_slug: "b" },
    ]

    const problems = await checkCartAvailability(cart)
    expect(problems.size).toBe(1)
  })
})
