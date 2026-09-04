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
