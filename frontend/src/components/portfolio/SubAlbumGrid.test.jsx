import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: SubAlbumGrid } = await import("./SubAlbumGrid")

const album = {
  id: 2, title: "Cosplay", count: 3, cover: "/c", items: [], thumbs: [],
  subAlbums: [
    { id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] },
    { id: 22, title: "Empty", count: 0, cover: "", items: [], thumbs: [] },
  ],
}

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<SubAlbumGrid album={album} lang="vi" onBack={() => {}} onOpenPhotos={() => {}} {...props} />) })
  return container
}

describe("SubAlbumGrid cards", () => {
  it("renders name, count and cover per sub-album", async () => {
    const c = await render()
    const cards = c.querySelectorAll('[data-testid="sub-album-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain("Nino")
    expect(cards[0].textContent).toContain("2 ảnh")
    expect(cards[0].querySelector("img").getAttribute("src")).toBe("/n1")
  })

  it("opens the lightbox for a sub-album", async () => {
    const onOpenPhotos = vi.fn()
    const c = await render({ onOpenPhotos })
    await act(async () => { c.querySelectorAll('[data-testid="sub-album-card"]')[0].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/n1f", "/n2f"], 0)
  })

  it("empty sub-album has no image and does nothing on click", async () => {
    const onOpenPhotos = vi.fn()
    const c = await render({ onOpenPhotos })
    const empty = c.querySelectorAll('[data-testid="sub-album-card"]')[1]
    expect(empty.querySelector("img")).toBeNull()
    expect(empty.getAttribute("aria-disabled")).toBe("true")
    await act(async () => { empty.click() })
    expect(onOpenPhotos).not.toHaveBeenCalled()
  })

  it("Enter opens a card and the back button calls onBack", async () => {
    const onOpenPhotos = vi.fn()
    const onBack = vi.fn()
    const c = await render({ onOpenPhotos, onBack })
    await act(async () => {
      c.querySelectorAll('[data-testid="sub-album-card"]')[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(onOpenPhotos).toHaveBeenCalledTimes(1)
    await act(async () => { c.querySelector('[data-testid="sub-back"]').click() })
    expect(onBack).toHaveBeenCalled()
  })

  it("renders English copy", async () => {
    const c = await render({ lang: "en" })
    expect(c.textContent).toContain("Back")
    expect(c.textContent).toContain("2 photos")
  })
})

describe("direct photos", () => {
  const withDirect = { ...album, items: ["/d0f", "/d1f"], thumbs: ["/d0", "/d1"] }

  it("shows them below the cards and opens the lightbox at the clicked index", async () => {
    const onOpenPhotos = vi.fn()
    const container = await render({ album: withDirect, onOpenPhotos })
    expect(container.querySelector('[data-testid="direct-photos-title"]').textContent).toBe("Ảnh khác")
    const photos = container.querySelectorAll('[data-testid="direct-photo"]')
    expect(photos).toHaveLength(2)
    expect(photos[1].getAttribute("src")).toBe("/d1")
    await act(async () => { photos[1].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/d0f", "/d1f"], 1)
  })

  it("direct photos are keyboard accessible", async () => {
    const onOpenPhotos = vi.fn()
    const container = await render({ album: withDirect, onOpenPhotos })
    const photo = container.querySelectorAll('[data-testid="direct-photo"]')[1]
    expect(photo.getAttribute("role")).toBe("button")
    expect(photo.tabIndex).toBe(0)
    await act(async () => { photo.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })) })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/d0f", "/d1f"], 1)
  })

  it("renders nothing extra when there are no direct photos", async () => {
    const c = await render()
    expect(c.querySelector('[data-testid="direct-photos-title"]')).toBeNull()
  })
})
