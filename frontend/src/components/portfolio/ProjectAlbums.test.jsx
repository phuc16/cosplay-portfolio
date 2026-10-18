import { describe, it, expect, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ProjectAlbums } = await import("./ProjectAlbums")

const plain = { id: 1, title: "Event", count: 2, cover: "/e", items: ["/e1f", "/e2f"], thumbs: ["/e1", "/e2"], subAlbums: [] }
const withSubs = {
  id: 2, title: "Cosplay", count: 3, cover: "/d", items: ["/df"], thumbs: ["/d"],
  subAlbums: [
    { id: 21, title: "Nino", count: 2, cover: "/n1", items: ["/n1f", "/n2f"], thumbs: ["/n1", "/n2"] },
    { id: 22, title: "Empty", count: 0, cover: "", items: [], thumbs: [] },
  ],
}

async function render(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const all = { albums: [plain, withSubs], lang: "vi", onOpenAlbum: () => {}, onOpenPhotos: () => {}, ...props }
  await act(async () => { root.render(<ProjectAlbums {...all} />) })
  return { container, root, all }
}
const cards = (c) => c.querySelectorAll('[data-testid="album-card"]')

describe("ProjectAlbums", () => {
  it("shows total counts including sub-album photos", async () => {
    const { container } = await render()
    expect(cards(container)[1].textContent).toContain("3 ảnh")
  })

  it("an album without sub-albums opens the lightbox directly", async () => {
    const onOpenAlbum = vi.fn()
    const { container } = await render({ onOpenAlbum })
    await act(async () => { cards(container)[0].click() })
    expect(onOpenAlbum).toHaveBeenCalledWith(plain)
  })

  it("an album with sub-albums drills in instead of opening the lightbox", async () => {
    const onOpenAlbum = vi.fn()
    const { container } = await render({ onOpenAlbum })
    await act(async () => { cards(container)[1].click() })
    expect(onOpenAlbum).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Nino")
    expect(container.querySelector('[data-testid="sub-back"]')).not.toBeNull()
    expect(cards(container)).toHaveLength(0)
  })

  it("sub-album click opens its photos; back returns to the album list", async () => {
    const onOpenPhotos = vi.fn()
    const { container } = await render({ onOpenPhotos })
    await act(async () => { cards(container)[1].click() })
    await act(async () => { container.querySelectorAll('[data-testid="sub-album-card"]')[0].click() })
    expect(onOpenPhotos).toHaveBeenCalledWith(["/n1f", "/n2f"], 0)
    await act(async () => { container.querySelector('[data-testid="sub-back"]').click() })
    expect(cards(container)).toHaveLength(2)
  })

  it("falls back to the list when the open album disappears", async () => {
    const { container, root, all } = await render()
    await act(async () => { cards(container)[1].click() })
    await act(async () => { root.render(<ProjectAlbums {...all} albums={[plain]} />) })
    expect(cards(container)).toHaveLength(1)
  })

  it("shows the empty state", async () => {
    const { container } = await render({ albums: [] })
    expect(container.textContent).toContain("Chưa có album.")
  })
})
