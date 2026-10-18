import { describe, it, expect, vi, afterEach } from "vitest"
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

  it("wraps cards in a grid with no count cap", async () => {
    const c = await render({ album: { ...album, subAlbums: makeSubs(10) } })
    expect(c.querySelectorAll('[data-testid="sub-album-card"]')).toHaveLength(10)
    const grid = c.querySelector('[data-testid="sub-album-card"]').parentElement
    expect(grid.style.display).toBe("grid")
    expect(c.querySelector('[data-testid="sub-prev"]')).toBeNull()
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

describe("height cap", () => {
  const subs = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, title: `S${i}`, count: 1, cover: `/c${i}`, items: [`/f${i}`], thumbs: [`/c${i}`] }))
  const many = { ...album, subAlbums: subs }
  let rectSpy

  function mockLayout(scrollHeight, regionTop = 90) {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => scrollHeight })
    rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      return { top: this.getAttribute("data-testid") === "sub-region" ? regionTop : 0, height: 0 }
    })
  }
  afterEach(() => {
    delete HTMLElement.prototype.scrollHeight
    rectSpy?.mockRestore()
  })

  const region = (c) => c.querySelector('[data-testid="sub-region"]')
  const more = (c) => c.querySelector('[data-testid="sub-show-more"]')

  it("collapses to maxHeight minus region offset and show-more block and shows the button when overflowing", async () => {
    mockLayout(900)
    const c = await render({ album: many, maxHeight: 500 })
    expect(region(c).style.maxHeight).toBe("354px")
    expect(more(c).textContent).toBe("Xem thêm")
    expect(c.querySelector('[data-testid="sub-fade"]')).not.toBeNull()
  })

  it("reserves exactly 56px for the show-more block", async () => {
    mockLayout(900)
    const c = await render({ album: many, maxHeight: 500 })
    expect(more(c).parentElement.style.height).toBe("56px")
  })

  it("uses an English label", async () => {
    mockLayout(900)
    const c = await render({ album: many, maxHeight: 500, lang: "en" })
    expect(more(c).textContent).toBe("Show all")
  })

  it("never collapses below one row of cards", async () => {
    mockLayout(900)
    const c = await render({ album: many, maxHeight: 150 })
    expect(region(c).style.maxHeight).toBe("260px")
  })

  it("expands on click and removes the cap", async () => {
    mockLayout(900)
    const c = await render({ album: many, maxHeight: 500 })
    await act(async () => { more(c).click() })
    expect(more(c)).toBeNull()
    expect(region(c).style.maxHeight).toBe("")
    expect(c.querySelector('[data-testid="sub-fade"]')).toBeNull()
  })

  it("shows no button when the content fits", async () => {
    mockLayout(350)
    const c = await render({ album: many, maxHeight: 500 })
    expect(more(c)).toBeNull()
    expect(c.querySelector('[data-testid="sub-fade"]')).toBeNull()
  })

  it("does not cap without a maxHeight", async () => {
    mockLayout(900)
    const c = await render({ album: many })
    expect(region(c).style.maxHeight).toBe("")
    expect(more(c)).toBeNull()
  })
})
