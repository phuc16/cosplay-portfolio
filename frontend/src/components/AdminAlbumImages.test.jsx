import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { api } from "../api/api"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminAlbumImages } = await import("./AdminAlbumImages")

async function renderAlbumImages(album = { id: 1, title: "Album 1" }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminAlbumImages album={album} onClose={() => {}} />) })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true)
})

afterEach(() => {
  window.confirm.mockRestore()
})

describe("AdminAlbumImages - error handling via the shared api instance", () => {
  it("routes reads/writes through the shared api instance (so the refresh interceptor applies) and surfaces a failed delete instead of failing silently", async () => {
    const originalAdapter = api.defaults.adapter
    let deleteCalled = false
    api.defaults.adapter = (config) => {
      if (config.method === "get" && config.url === "/api/gallery") {
        return Promise.resolve({
          data: [{ id: 1, items: [{ id: 10, url: "https://example.com/a.jpg" }] }],
          status: 200, config, headers: {},
        })
      }
      if (config.method === "delete" && config.url === "/api/image/10") {
        deleteCalled = true
        return Promise.reject({
          response: { status: 500, data: { message: "Xóa ảnh thất bại từ server" } },
          isAxiosError: true,
        })
      }
      return Promise.reject(new Error(`unexpected request: ${config.method} ${config.url}`))
    }

    try {
      const container = await renderAlbumImages()
      await flush()

      const deleteBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "×")
      expect(deleteBtn).toBeTruthy()
      await act(async () => { deleteBtn.click() })
      await flush()

      expect(deleteCalled).toBe(true)
      expect(container.textContent).toContain("Xóa ảnh thất bại từ server")
    } finally {
      api.defaults.adapter = originalAdapter
    }
  })
})

describe("AdminAlbumImages - sub-albums", () => {
  it("loads the photos of a sub-album nested in the gallery payload", async () => {
    const originalAdapter = api.defaults.adapter
    api.defaults.adapter = (config) => {
      if (config.method === "get" && config.url === "/api/gallery") {
        return Promise.resolve({
          data: [{ id: 1, group: "P", items: [], subAlbums: [{ id: 5, title: "S", items: [{ id: 50, src: "/s.webp", fullSrc: "/s.webp" }] }] }],
          status: 200, config, headers: {},
        })
      }
      return Promise.reject(new Error(`unexpected request: ${config.method} ${config.url}`))
    }
    try {
      const container = await renderAlbumImages({ id: 5, title: "S" })
      await flush()
      const imgs = container.querySelectorAll("img")
      expect(imgs).toHaveLength(1)
      expect(imgs[0].getAttribute("src")).toBe("/s.webp")
    } finally {
      api.defaults.adapter = originalAdapter
    }
  })
})
