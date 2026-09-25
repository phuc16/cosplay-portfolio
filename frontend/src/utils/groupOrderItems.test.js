import { describe, it, expect } from "vitest"
import { groupOrderItems } from "./groupOrderItems"

describe("groupOrderItems", () => {
  it("sums qty for items sharing the same key, preserving first-seen order", () => {
    const items = [
      { id: 1, name: "HIYU", qty: 1 },
      { id: 2, name: "CINDY", qty: 1 },
      { id: 3, name: "HIYU", qty: 1 },
      { id: 4, name: "HUYI", qty: 1 },
      { id: 5, name: "CINDY", qty: 1 },
    ]
    const grouped = groupOrderItems(items, (i) => i.name)
    expect(grouped).toEqual([
      { id: 1, name: "HIYU", qty: 2 },
      { id: 2, name: "CINDY", qty: 2 },
      { id: 4, name: "HUYI", qty: 1 },
    ])
  })

  it("does not merge items whose key differs even if their display name matches", () => {
    const items = [
      { name: "A1", price: 1000, qty: 1 },
      { name: "A1", price: 2000, qty: 1 },
    ]
    const grouped = groupOrderItems(items, (i) => `${i.name}|${i.price}`)
    expect(grouped).toHaveLength(2)
  })

  it("is a no-op for an already-distinct item list", () => {
    const items = [
      { name: "A", qty: 2 },
      { name: "B", qty: 3 },
    ]
    expect(groupOrderItems(items, (i) => i.name)).toEqual(items)
  })

  it("returns an empty array for an empty list", () => {
    expect(groupOrderItems([], (i) => i.name)).toEqual([])
  })
})
