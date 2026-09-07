import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { api } from "../api/api"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminAlbums } = await import("./AdminAlbums")

async function renderAlbums() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminAlbums />) })
  return container
}

async function flush() { await act(async () => {}) }

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true)
})

afterEach(() => {
  window.confirm.mockRestore()
})

describe("AdminAlbums — error handling via the shared api instance", () => {
  it("routes reads/writes through the shared api instance (so the refresh interceptor applies) and surfaces a failed delete instead of failing silently", async () => {
    const originalAdapter = api.defaults.adapter
    let deleteCalled = false
    api.defaults.adapter = (config) => {
      if (config.method === "get" && config.url === "/api/albums") {
        return Promise.resolve({
          data: [{ id: 1, title: "Album 1", description: "" }],
          status: 200, config, headers: {},
        })
      }
      if (config.method === "delete" && config.url === "/api/albums/1") {
        deleteCalled = true
        return Promise.reject({
          response: { status: 500, data: { message: "Xóa thất bại từ server" } },
          isAxiosError: true,
        })
      }
      return Promise.reject(new Error(`unexpected request: ${config.method} ${config.url}`))
    }

    try {
      const container = await renderAlbums()
      await flush()
      expect(container.textContent).toContain("Album 1")

      const deleteBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xóa")
      await act(async () => { deleteBtn.click() })
      await flush()

      expect(deleteCalled).toBe(true)
      expect(container.textContent).toContain("Xóa thất bại từ server")
    } finally {
      api.defaults.adapter = originalAdapter
    }
  })
})
