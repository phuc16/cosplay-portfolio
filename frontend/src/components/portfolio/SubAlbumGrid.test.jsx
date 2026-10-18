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
  it("renders overlaid name, count and cover per visible sub-album", async () => {
    const c = await render()
    const cards = c.querySelectorAll('[data-testid="sub-album-card"]')
    expect(cards).toHaveLength(1)
    expect(cards[0].textContent).toContain("Nino")
    expect(cards[0].textContent).toContain("2 ảnh")
    const img = cards[0].querySelector("img")
    expect(img.getAttribute("src")).toBe("/n1")
    expect(img.getAttribute("alt")).toBe("Nino")
  })

  it("opens the lightbox for a sub-album", async () => {
    const onOpenPhotos = vi.fn()
    const c = await render({ onOpenPhotos })
    await act(async () => { c.querySelectorAll('[data-testid="sub-album-card"]')[0].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/n1f", "/n2f"], 0)
  })

  it("hides empty sub-albums entirely", async () => {
    const c = await render()
    expect(c.textContent).not.toContain("Empty")
    expect(c.textContent).not.toContain("Chưa có ảnh")
  })

  it("shows one muted line when nothing has photos", async () => {
    const onlyEmpty = { ...album, subAlbums: [album.subAlbums[1]] }
    const c = await render({ album: onlyEmpty })
    expect(c.querySelectorAll('[data-testid="sub-album-card"]')).toHaveLength(0)
    expect(c.querySelector('[data-testid="sub-empty"]').textContent).toBe("Chưa có ảnh")
    const en = await render({ album: onlyEmpty, lang: "en" })
    expect(en.querySelector('[data-testid="sub-empty"]').textContent).toBe("No photos yet")
  })

  it("shows only direct photos when all sub-albums are empty", async () => {
    const onlyDirect = { ...album, subAlbums: [album.subAlbums[1]], items: ["/d0f"], thumbs: ["/d0"] }
    const c = await render({ album: onlyDirect })
    expect(c.querySelector('[data-testid="sub-empty"]')).toBeNull()
    expect(c.querySelector('[data-testid="direct-photos-title"]')).toBeNull()
    expect(c.querySelectorAll('[data-testid="direct-photo"]')).toHaveLength(1)
  })

  const makeSubs = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, title: `S${i}`, count: 1, cover: `/c${i}`, items: [`/f${i}`], thumbs: [`/c${i}`] }))

  it("lays cards out in one scrollable row with no cap", async () => {
    const c = await render({ album: { ...album, subAlbums: makeSubs(10) } })
    expect(c.querySelectorAll('[data-testid="sub-album-card"]')).toHaveLength(10)
    const row = c.querySelector('[data-testid="sub-album-card"]').parentElement
    expect(row.style.flexWrap).toBe("nowrap")
    expect(row.style.overflowX).toBe("auto")
    expect(c.querySelector('[data-testid="sub-show-more"]')).toBeNull()
  })

  it("hides arrows at 6 cards and shows them at 7", async () => {
    const six = await render({ album: { ...album, subAlbums: makeSubs(6) } })
    expect(six.querySelector('[data-testid="sub-prev"]')).toBeNull()
    expect(six.querySelector('[data-testid="sub-next"]')).toBeNull()
    const seven = await render({ album: { ...album, subAlbums: makeSubs(7) } })
    expect(seven.querySelector('[data-testid="sub-prev"]').getAttribute("aria-label")).toBe("Trước")
    expect(seven.querySelector('[data-testid="sub-next"]').getAttribute("aria-label")).toBe("Sau")
  })

  it("arrows scroll the row by 80% of its width", async () => {
    const c = await render({ album: { ...album, subAlbums: makeSubs(7) }, lang: "en" })
    const row = c.querySelector('[data-testid="sub-album-card"]').parentElement
    Object.defineProperty(row, "clientWidth", { value: 500 })
    row.scrollBy = vi.fn()
    expect(c.querySelector('[data-testid="sub-next"]').getAttribute("aria-label")).toBe("Next")
    await act(async () => { c.querySelector('[data-testid="sub-next"]').click() })
    expect(row.scrollBy).toHaveBeenCalledWith({ left: 400, behavior: "smooth" })
    await act(async () => { c.querySelector('[data-testid="sub-prev"]').click() })
    expect(row.scrollBy).toHaveBeenLastCalledWith({ left: -400, behavior: "smooth" })
  })

  it("does not throw when scrollBy is unavailable", async () => {
    const c = await render({ album: { ...album, subAlbums: makeSubs(7) } })
    await act(async () => { c.querySelector('[data-testid="sub-next"]').click() })
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
