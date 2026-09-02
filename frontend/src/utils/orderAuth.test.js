import { describe, it, expect, beforeEach, vi } from "vitest"
import axios from "axios"
import {
  hasAdminSession, orderAuthHeaders, refreshAdminSession,
  getOrderSessionToken, setOrderSessionToken, clearOrderSessionToken,
} from "./orderAuth"

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  delete axios.defaults.headers.common["Authorization"]
  vi.restoreAllMocks()
})

describe("hasAdminSession", () => {
  it("is false with neither an in-memory header nor a persisted admin_token", () => {
    expect(hasAdminSession()).toBe(false)
  })

  it("is true when Admin.jsx has set the in-memory axios header this tab", () => {
    axios.defaults.headers.common["Authorization"] = "Bearer some-token"
    expect(hasAdminSession()).toBe(true)
  })

  // Regression: a buyer's order link opened directly (never having visited
  // /admin in this tab/page-load) has admin_token in localStorage but no
  // in-memory axios header — caught live via devtools showing admin_token
  // present while the PIN gate still rendered.
  it("is true from a persisted admin_token alone, with no in-memory header set", () => {
    localStorage.setItem("admin_token", "persisted-token")
    expect(hasAdminSession()).toBe(true)
  })
})

describe("orderAuthHeaders", () => {
  it("returns no explicit header when the in-memory admin header is already set (interceptor attaches it)", () => {
    axios.defaults.headers.common["Authorization"] = "Bearer in-memory-token"
    expect(orderAuthHeaders("tok123")).toEqual({})
  })

  it("explicitly attaches a persisted admin_token when there is no in-memory header", () => {
    localStorage.setItem("admin_token", "persisted-token")
    expect(orderAuthHeaders("tok123")).toEqual({ Authorization: "Bearer persisted-token" })
  })

  it("falls back to the PIN-verified order session token when there is no admin token at all", () => {
    setOrderSessionToken("tok123", "pin-session-token")
    expect(orderAuthHeaders("tok123")).toEqual({ Authorization: "Bearer pin-session-token" })
  })

  it("prefers a persisted admin_token over an order session token for the same order", () => {
    localStorage.setItem("admin_token", "persisted-token")
    setOrderSessionToken("tok123", "pin-session-token")
    expect(orderAuthHeaders("tok123")).toEqual({ Authorization: "Bearer persisted-token" })
  })

  it("returns no header when nothing is available (triggers the PIN gate)", () => {
    expect(orderAuthHeaders("tok123")).toEqual({})
  })
})

describe("refreshAdminSession", () => {
  it("returns false immediately, with no network call, when there is no refresh token", async () => {
    const spy = vi.spyOn(axios, "post")
    expect(await refreshAdminSession()).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it("redeems the refresh token, writes the fresh admin_token/refresh_token, and returns true", async () => {
    localStorage.setItem("admin_refresh_token", "still-good")
    vi.spyOn(axios, "post").mockResolvedValue({ data: { token: "fresh-jwt", refresh_token: "new-refresh" } })

    expect(await refreshAdminSession()).toBe(true)
    expect(axios.post).toHaveBeenCalledWith("/api/refresh", { refresh_token: "still-good" })
    expect(localStorage.getItem("admin_token")).toBe("fresh-jwt")
    expect(localStorage.getItem("admin_refresh_token")).toBe("new-refresh")
  })

  it("clears the dead refresh token and returns false when the server rejects it", async () => {
    localStorage.setItem("admin_refresh_token", "expired")
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status: 401 } })

    expect(await refreshAdminSession()).toBe(false)
    expect(localStorage.getItem("admin_refresh_token")).toBeNull()
  })
})

describe("order session token storage", () => {
  it("round-trips set/get/clear, scoped per order token", () => {
    setOrderSessionToken("tok-a", "a-session")
    setOrderSessionToken("tok-b", "b-session")
    expect(getOrderSessionToken("tok-a")).toBe("a-session")
    expect(getOrderSessionToken("tok-b")).toBe("b-session")

    clearOrderSessionToken("tok-a")
    expect(getOrderSessionToken("tok-a")).toBeNull()
    expect(getOrderSessionToken("tok-b")).toBe("b-session")
  })
})
