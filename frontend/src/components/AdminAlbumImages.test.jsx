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

describe("AdminAlbumImages - before/after pairing", () => {
  it("PUTs pairedImageId when a partner is picked, then shows the Trước/Sau badges after refetch", async () => {
    const originalAdapter = api.defaults.adapter
    let putBody = null
    let paired = false
    api.defaults.adapter = (config) => {
      if (config.method === "get" && config.url === "/api/gallery") {
        const items = paired
          ? [
              { id: 10, url: "https://example.com/a.jpg", pairRole: "before", pairImageId: 20 },
              { id: 20, url: "https://example.com/b.jpg", pairRole: "after", pairImageId: 10 },
            ]
          : [
              { id: 10, url: "https://example.com/a.jpg" },
              { id: 20, url: "https://example.com/b.jpg" },
            ]
        return Promise.resolve({ data: [{ id: 1, items }], status: 200, config, headers: {} })
      }
      if (config.method === "put" && config.url === "/api/images/10/pair") {
        putBody = JSON.parse(config.data)
        paired = true
        return Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} })
      }
      return Promise.reject(new Error(`unexpected request: ${config.method} ${config.url}`))
    }

    try {
      const container = await renderAlbumImages()
      await flush()

      const selects = container.querySelectorAll("select")
      expect(selects.length).toBe(2)
      const firstSelect = selects[0]
      await act(async () => {
        firstSelect.value = "20"
        firstSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await flush()

      expect(putBody).toEqual({ pairedImageId: 20 })
      expect(container.textContent).toContain("Trước")
      expect(container.textContent).toContain("Sau")
      // The "after" image no longer gets its own picker - pairing is only
      // ever driven from the "before" side.
      expect(container.querySelectorAll("select").length).toBe(1)
    } finally {
      api.defaults.adapter = originalAdapter
    }
  })

  it("surfaces a failed pairing request instead of failing silently", async () => {
    const originalAdapter = api.defaults.adapter
    api.defaults.adapter = (config) => {
      if (config.method === "get" && config.url === "/api/gallery") {
        return Promise.resolve({
          data: [{ id: 1, items: [{ id: 10, url: "https://example.com/a.jpg" }, { id: 20, url: "https://example.com/b.jpg" }] }],
          status: 200, config, headers: {},
        })
      }
      if (config.method === "put" && config.url === "/api/images/10/pair") {
        return Promise.reject({ response: { status: 400, data: { message: "Hai ảnh phải thuộc cùng một album." } }, isAxiosError: true })
      }
      return Promise.reject(new Error(`unexpected request: ${config.method} ${config.url}`))
    }

    try {
      const container = await renderAlbumImages()
      await flush()

      const select = container.querySelector("select")
      await act(async () => {
        select.value = "20"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await flush()

      expect(container.textContent).toContain("Hai ảnh phải thuộc cùng một album.")
    } finally {
      api.defaults.adapter = originalAdapter
    }
  })
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
