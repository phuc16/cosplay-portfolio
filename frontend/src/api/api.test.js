import { describe, it, expect, afterEach } from "vitest"
import axios from "axios"
import { api } from "./api"

afterEach(() => {
  delete axios.defaults.headers.common["Authorization"]
})

// A custom adapter runs after every request interceptor has resolved, so it
// sees the final outgoing config regardless of interceptor registration order.
function captureRequestHeader(config = {}) {
  return new Promise((resolve) => {
    api
      .get("/whatever", {
        ...config,
        adapter: (cfg) => {
          resolve(cfg.headers.Authorization)
          return Promise.reject(new Error("stop-before-send"))
        },
      })
      .catch(() => {})
  })
}

describe("api instance auth header", () => {
  it("carries the global Authorization default set after instance creation", async () => {
    axios.defaults.headers.common["Authorization"] = "Bearer TOKEN123"
    const header = await captureRequestHeader()
    expect(header).toBe("Bearer TOKEN123")
  })

  it("carries no Authorization header once the global default is removed (logout)", async () => {
    axios.defaults.headers.common["Authorization"] = "Bearer TOKEN123"
    delete axios.defaults.headers.common["Authorization"]
    const header = await captureRequestHeader()
    expect(header).toBeUndefined()
  })

  it("preserves an explicit per-request Authorization header instead of overwriting it", async () => {
    axios.defaults.headers.common["Authorization"] = "Bearer GLOBAL"
    const header = await captureRequestHeader({ headers: { Authorization: "Bearer EXPLICIT" } })
    expect(header).toBe("Bearer EXPLICIT")
  })
})
