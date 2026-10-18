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

describe("AdminAlbums - error handling via the shared api instance", () => {
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

function mockAlbumsApi(rows, handlers = {}) {
  api.defaults.adapter = (config) => {
    const key = `${config.method} ${config.url}`
    if (handlers[key]) return handlers[key](config)
    if (key === "get /api/albums") return Promise.resolve({ data: rows, status: 200, config, headers: {} })
    return Promise.reject(new Error(`unexpected request: ${key}`))
  }
}

describe("AdminAlbums - sub-album nesting", () => {
  const rows = [
    { id: 1, title: "Cosplay", description: "", parent_id: null },
    { id: 11, title: "Nino", description: "", parent_id: 1 },
    { id: 2, title: "Event", description: "", parent_id: null },
  ]
  const originalAdapter = api.defaults.adapter
  afterEach(() => { api.defaults.adapter = originalAdapter })

  it("renders sub-albums indented under their parent", async () => {
    mockAlbumsApi(rows)
    const c = await renderAlbums()
    await flush()
    const all = [...c.querySelectorAll("[data-album-row]")]
    expect(all.map((r) => r.querySelector("h3").textContent)).toEqual(["Cosplay", "Nino", "Event"])
    expect(c.querySelectorAll("[data-sub-album-row]")).toHaveLength(1)
    expect(c.querySelector("[data-sub-album-row]").querySelector("h3").textContent).toBe("Nino")
  })

  it("adds a sub-album under the chosen parent", async () => {
    let posted
    mockAlbumsApi(rows, {
      "post /api/albums": (config) => {
        posted = JSON.parse(config.data)
        return Promise.resolve({ data: { ok: true, id: 50 }, status: 200, config, headers: {} })
      },
    })
    const c = await renderAlbums()
    await flush()
    const addButtons = [...c.querySelectorAll("button")].filter((b) => b.textContent === "+ Album con")
    expect(addButtons).toHaveLength(2)
    await act(async () => { addButtons[0].click() })
    expect(c.textContent).toContain("Tạo album con trong: Cosplay")
    const input = c.querySelector('input[type="text"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Miku")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { c.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flush()
    expect(posted).toMatchObject({ title: "Miku", parent_id: 1 })
  })

  it("reorders only siblings and ignores cross-parent drops", async () => {
    const two = [
      { id: 1, title: "A", description: "", parent_id: null },
      { id: 11, title: "A1", description: "", parent_id: 1 },
      { id: 12, title: "A2", description: "", parent_id: 1 },
      { id: 2, title: "B", description: "", parent_id: null },
    ]
    const reorderBodies = []
    mockAlbumsApi(two, {
      "put /api/albums/reorder": (config) => {
        reorderBodies.push(JSON.parse(config.data))
        return Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} })
      },
    })
    const c = await renderAlbums()
    await flush()
    const rowOf = (title) => [...c.querySelectorAll("[data-album-row]")].find((r) => r.querySelector("h3").textContent === title)
    const drag = async (from, to) => {
      const dt = { effectAllowed: "", dropEffect: "", setData() {} }
      await act(async () => {
        rowOf(from).querySelector("[draggable]").dispatchEvent(Object.assign(new Event("dragstart", { bubbles: true }), { dataTransfer: dt }))
      })
      await act(async () => {
        rowOf(to).dispatchEvent(Object.assign(new Event("drop", { bubbles: true, cancelable: true }), { dataTransfer: dt }))
      })
    }
    await drag("A2", "A1")
    expect(reorderBodies).toEqual([{ albumIds: [12, 11] }])
    await drag("A1", "B")
    expect(reorderBodies).toHaveLength(1)
    expect([...c.querySelectorAll("[data-album-row] h3")].map((h) => h.textContent)).toEqual(["A", "A2", "A1", "B"])
  })

  it("warns about sub-albums in the delete confirmation", async () => {
    mockAlbumsApi(rows, {
      "delete /api/albums/1": (config) => Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} }),
      "delete /api/albums/11": (config) => Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} }),
    })
    const c = await renderAlbums()
    await flush()
    const delButtons = [...c.querySelectorAll("button")].filter((b) => b.textContent === "Xóa")
    await act(async () => { delButtons[0].click() })
    expect(window.confirm).toHaveBeenCalledWith("Xóa album, 1 album con và tất cả ảnh?")
    window.confirm.mockClear()
    await act(async () => { delButtons[1].click() })
    expect(window.confirm).toHaveBeenCalledWith("Xóa album con và tất cả ảnh trong album con?")
    window.confirm.mockClear()
    await act(async () => { delButtons[2].click() })
    expect(window.confirm).toHaveBeenCalledWith("Xóa album và tất cả ảnh trong album?")
  })
})
