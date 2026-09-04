import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminCreateCollection = vi.fn()
const adminUpdateCollection = vi.fn()
const adminDeleteCollection = vi.fn()
const adminCopyCollection = vi.fn()
const adminUploadImage = vi.fn()

vi.mock("../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminCreateCollection: (...args) => adminCreateCollection(...args),
  adminUpdateCollection: (...args) => adminUpdateCollection(...args),
  adminDeleteCollection: (...args) => adminDeleteCollection(...args),
  adminCopyCollection: (...args) => adminCopyCollection(...args),
  adminUploadImage: (...args) => adminUploadImage(...args),
}))

vi.mock("./AdminProducts", () => ({ default: () => <div>products</div> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminCollections } = await import("./AdminCollections")

function collection(over = {}) {
  return {
    id: 1, title: "Hobby Horizon 2030", slug: "hobby-horizon-2030", description: null,
    status: "active", allow_ship: true, allow_pickup: false,
    pickup_location: null, pickup_note: null, payment_deadline_hours: null,
    cover_image: null, thumbnail_image: null,
    ...over,
  }
}

async function renderCollections() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminCollections />) })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  adminListCollections.mockReset()
  adminCreateCollection.mockReset()
  adminUpdateCollection.mockReset()
  adminDeleteCollection.mockReset()
  adminCopyCollection.mockReset()
  adminUploadImage.mockReset()
})

describe("AdminCollections — edit", () => {
  it("scrolls the shared edit form into view when 'Sửa' is clicked, so it isn't left invisible below a long list", async () => {
    adminListCollections.mockResolvedValue([
      collection({ id: 1, title: "First" }),
      collection({ id: 2, title: "Second" }),
    ])
    const container = await renderCollections()
    await flush()

    const scrollSpy = vi.fn()
    const form = container.querySelector("p.font-medium.mb-3")?.closest("div")
    form.scrollIntoView = scrollSpy

    const editButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Sửa")
    await act(async () => { editButtons[1].click() })

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
  })

  it("populates the shared form with the clicked collection's own fields, not the previous one", async () => {
    adminListCollections.mockResolvedValue([
      collection({ id: 1, title: "First" }),
      collection({ id: 2, title: "Second" }),
    ])
    const container = await renderCollections()
    await flush()

    const form = container.querySelector("p.font-medium.mb-3")?.closest("div")
    form.scrollIntoView = vi.fn()

    const editButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Sửa")
    await act(async () => { editButtons[1].click() })

    expect(container.textContent).toContain("Sửa bộ sưu tập")
    const titleInput = container.querySelector('input[placeholder="Tên bộ sưu tập"]')
    expect(titleInput.value).toBe("Second")
  })
})

describe("AdminCollections — search, filter, sort", () => {
  it("filters the list by title or slug, case-insensitively", async () => {
    adminListCollections.mockResolvedValue([
      collection({ id: 1, title: "Hobby Horizon", slug: "hobby-horizon" }),
      collection({ id: 2, title: "Winter Fest", slug: "winter-fest" }),
    ])
    const container = await renderCollections()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tìm theo tên hoặc đường dẫn..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "winter")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Winter Fest")
    expect(container.textContent).not.toContain("Hobby Horizon")
  })

  it("filters the list by status", async () => {
    adminListCollections.mockResolvedValue([
      collection({ id: 1, title: "Active One", status: "active" }),
      collection({ id: 2, title: "Closed One", status: "closed" }),
    ])
    const container = await renderCollections()
    await flush()

    const statusSelect = [...container.querySelectorAll("select")][0]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(statusSelect, "closed")
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Closed One")
    expect(container.textContent).not.toContain("Active One")
  })

  it("sorts the list by title A-Z", async () => {
    adminListCollections.mockResolvedValue([
      collection({ id: 1, title: "Zebra Drop" }),
      collection({ id: 2, title: "Apple Drop" }),
    ])
    const container = await renderCollections()
    await flush()

    const sortSelect = [...container.querySelectorAll("select")][1]
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
      setter.call(sortSelect, "title_asc")
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const titles = [...container.querySelectorAll("p.font-semibold")].map((p) => p.textContent)
    expect(titles).toEqual(["Apple Drop", "Zebra Drop"])
  })

  it("shows a no-match message when the search matches nothing", async () => {
    adminListCollections.mockResolvedValue([collection({ id: 1, title: "Hobby Horizon" })])
    const container = await renderCollections()
    await flush()

    const searchInput = container.querySelector('input[placeholder="Tìm theo tên hoặc đường dẫn..."]')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
      setter.call(searchInput, "nobody")
      searchInput.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(container.textContent).toContain("Không tìm thấy bộ sưu tập nào khớp")
  })
})
