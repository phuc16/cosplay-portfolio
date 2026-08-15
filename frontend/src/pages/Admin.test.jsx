import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import axios from "axios"
import { api } from "../api/api"
import { ThemeProvider } from "../contexts/ThemeContext"

vi.mock("../components/AdminAlbums", () => ({ default: () => <div data-testid="tab-albums" /> }))
vi.mock("../components/AdminSettings", () => ({ default: () => <div /> }))
vi.mock("../components/AdminCollections", () => ({ default: () => <div /> }))
vi.mock("../components/AdminOrders", () => ({ default: () => <div /> }))
vi.mock("../components/AdminPaymentSettings", () => ({ default: () => <div /> }))
vi.mock("../components/AdminEmailTemplates", () => ({ default: () => <div /> }))
vi.mock("../components/AdminStats", () => ({ default: () => <div /> }))
vi.mock("../components/AdminShipping", () => ({ default: () => <div /> }))

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal()
  return { default: { ...actual.default, post: vi.fn() } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: Admin } = await import("./Admin")

async function renderAdmin() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ThemeProvider>
        <Admin />
      </ThemeProvider>
    )
  })
  return container
}

beforeEach(() => {
  localStorage.clear()
  delete axios.defaults.headers.common["Authorization"]
  axios.post.mockReset()
})

describe("Admin — session persistence", () => {
  it("shows the login form when there is no saved token", async () => {
    const container = await renderAdmin()
    expect(container.textContent).toContain("Đăng nhập Admin")
  })

  it("saves the token to localStorage after a successful login", async () => {
    axios.post.mockResolvedValue({ data: { token: "abc123" } })
    const container = await renderAdmin()

    const userInput = container.querySelector('input[type="text"]')
    const passInput = container.querySelector('input[type="password"]')
    await act(async () => {
      userInput.dispatchEvent(new Event("input", { bubbles: true }))
    })
    userInput.value = "admin"
    passInput.value = "secret"
    userInput.dispatchEvent(new Event("input", { bubbles: true }))
    passInput.dispatchEvent(new Event("input", { bubbles: true }))

    const form = container.querySelector("form")
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(localStorage.getItem("admin_token")).toBe("abc123")
    expect(container.querySelector('[data-testid="tab-albums"]')).toBeTruthy()
  })

  it("restores the session (skips login) when a token is already saved", async () => {
    localStorage.setItem("admin_token", "saved-token")
    const container = await renderAdmin()

    expect(container.textContent).not.toContain("Đăng nhập Admin")
    expect(container.querySelector('[data-testid="tab-albums"]')).toBeTruthy()
    expect(axios.defaults.headers.common["Authorization"]).toBe("Bearer saved-token")
  })

  it("clears the saved token and drops back to login on logout", async () => {
    localStorage.setItem("admin_token", "saved-token")
    const container = await renderAdmin()

    const logoutBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Đăng xuất")
    await act(async () => logoutBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(localStorage.getItem("admin_token")).toBeNull()
    expect(container.textContent).toContain("Đăng nhập Admin")
  })

  it("logs out automatically when an admin API call comes back 401 (expired session) and there is no refresh token", async () => {
    localStorage.setItem("admin_token", "expired-token")
    const container = await renderAdmin()
    expect(container.querySelector('[data-testid="tab-albums"]')).toBeTruthy()

    const originalAdapter = api.defaults.adapter
    api.defaults.adapter = () => Promise.reject({ response: { status: 401 }, isAxiosError: true })
    try {
      await act(async () => {
        await api.get("/api/admin/anything").catch(() => {})
      })
    } finally {
      api.defaults.adapter = originalAdapter
    }

    expect(localStorage.getItem("admin_token")).toBeNull()
    expect(container.textContent).toContain("Đăng nhập Admin")
  })

  it("saves the refresh_token to localStorage alongside the access token after login", async () => {
    axios.post.mockResolvedValue({ data: { token: "abc123", refresh_token: "refresh-abc" } })
    const container = await renderAdmin()

    const userInput = container.querySelector('input[type="text"]')
    const passInput = container.querySelector('input[type="password"]')
    userInput.value = "admin"
    passInput.value = "secret"
    userInput.dispatchEvent(new Event("input", { bubbles: true }))
    passInput.dispatchEvent(new Event("input", { bubbles: true }))

    const form = container.querySelector("form")
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(localStorage.getItem("admin_refresh_token")).toBe("refresh-abc")
  })

  it("silently refreshes and retries the request on a 401 when a refresh token is saved, instead of logging out", async () => {
    localStorage.setItem("admin_token", "expired-token")
    localStorage.setItem("admin_refresh_token", "refresh-abc")
    axios.post.mockResolvedValue({ data: { token: "new-token", refresh_token: "new-refresh" } })
    const container = await renderAdmin()

    const originalAdapter = api.defaults.adapter
    let calls = 0
    api.defaults.adapter = (config) => {
      calls += 1
      if (calls === 1) return Promise.reject({ response: { status: 401 }, isAxiosError: true, config })
      return Promise.resolve({ data: { ok: true }, status: 200, config, headers: {} })
    }
    try {
      await act(async () => {
        await api.get("/api/admin/anything")
      })
    } finally {
      api.defaults.adapter = originalAdapter
    }

    expect(axios.post).toHaveBeenCalledWith("/api/refresh", { refresh_token: "refresh-abc" })
    expect(localStorage.getItem("admin_token")).toBe("new-token")
    expect(localStorage.getItem("admin_refresh_token")).toBe("new-refresh")
    expect(container.textContent).not.toContain("Đăng nhập Admin")
  })

  it("logs out when the refresh token itself is rejected", async () => {
    localStorage.setItem("admin_token", "expired-token")
    localStorage.setItem("admin_refresh_token", "dead-refresh")
    axios.post.mockRejectedValue({ response: { status: 401 }, isAxiosError: true })
    const container = await renderAdmin()

    const originalAdapter = api.defaults.adapter
    api.defaults.adapter = () => Promise.reject({ response: { status: 401 }, isAxiosError: true })
    try {
      await act(async () => {
        await api.get("/api/admin/anything").catch(() => {})
      })
    } finally {
      api.defaults.adapter = originalAdapter
    }

    expect(localStorage.getItem("admin_token")).toBeNull()
    expect(localStorage.getItem("admin_refresh_token")).toBeNull()
    expect(container.textContent).toContain("Đăng nhập Admin")
  })
})
