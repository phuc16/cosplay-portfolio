import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const adminStartBoothSession = vi.fn()
const adminDrawSession = vi.fn()
const adminFetchPrizes = vi.fn()
const hasAdminSession = vi.fn()
const navigate = vi.fn()

vi.mock("../api/shop", () => ({
  adminStartBoothSession: (...args) => adminStartBoothSession(...args),
  adminDrawSession: (...args) => adminDrawSession(...args),
  adminFetchPrizes: (...args) => adminFetchPrizes(...args),
}))

vi.mock("../utils/orderAuth", () => ({
  hasAdminSession: (...args) => hasAdminSession(...args),
}))

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: GachaKiosk } = await import("./GachaKiosk")

const prizes = [
  { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000 },
  { id: 2, name: "Poster", tier: "rare", image_url: null, display_price: 20000 },
]

// Mirrors GachaMachine.test.jsx: the real reel runs for 7.5-9.5s of wall
// clock, so drive requestAnimationFrame off the microtask queue with a coarse
// clock to let a whole spin finish inside a few act() flushes.
let restoreRaf

function installFastRaf() {
  const original = globalThis.requestAnimationFrame
  let now = 0
  globalThis.requestAnimationFrame = (cb) => {
    now += 1000
    const at = now
    queueMicrotask(() => cb(at))
    return at
  }
  return () => {
    globalThis.requestAnimationFrame = original
  }
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {})
  }
}

async function renderKiosk() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/admin/gacha/1/kiosk"]}>
        <Routes>
          <Route path="/admin/gacha/:productId/kiosk" element={<GachaKiosk />} />
        </Routes>
      </MemoryRouter>
    )
  })
  return container
}

function buttonMatching(container, re) {
  return [...container.querySelectorAll("button")].find((b) => re.test(b.textContent))
}

function startButton(container) {
  return buttonMatching(container, /bắt đầu phiên/i)
}

function spinButton(container) {
  return buttonMatching(container, /mở hộp|đang mở|hết lượt/i)
}

function retryButton(container) {
  return buttonMatching(container, /thử lại/i)
}

function nextBuyerButton(container) {
  return buttonMatching(container, /khách tiếp theo/i)
}

function click(el) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function change(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  restoreRaf = installFastRaf()
  adminStartBoothSession.mockReset()
  adminDrawSession.mockReset()
  adminFetchPrizes.mockReset().mockResolvedValue(prizes)
  hasAdminSession.mockReset().mockReturnValue(true)
  navigate.mockReset()
})

afterEach(() => {
  restoreRaf()
  document.body.innerHTML = ""
})

describe("GachaKiosk", () => {
  it("redirects to /admin without rendering the staff panel when there is no admin session", async () => {
    hasAdminSession.mockReturnValue(false)

    const container = await renderKiosk()

    expect(startButton(container)).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith("/admin")
    expect(adminFetchPrizes).not.toHaveBeenCalled()
  })

  it("shows the staff panel and loads the product's prize list", async () => {
    const container = await renderKiosk()

    expect(startButton(container)).toBeTruthy()
    expect(adminFetchPrizes).toHaveBeenCalledWith(1)
    expect(spinButton(container)).toBeUndefined()
  })

  it("explains a failed prize fetch in the alert region and offers a retry, keeping start disabled", async () => {
    adminFetchPrizes.mockRejectedValue(new Error("Network Error"))

    const container = await renderKiosk()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert.textContent).toMatch(/không tải được danh sách phần thưởng/i)
    expect(retryButton(container)).toBeTruthy()
    expect(startButton(container).disabled).toBe(true)
  })

  it("distinguishes a product with zero configured prizes from a failed fetch", async () => {
    adminFetchPrizes.mockResolvedValue([])

    const container = await renderKiosk()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(retryButton(container)).toBeUndefined()
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status.textContent).toMatch(/chưa được cấu hình phần thưởng/i)
    expect(status.textContent).not.toMatch(/không tải được/i)
    expect(startButton(container).disabled).toBe(true)
  })

  it("re-fetches on retry and enables the start button once prizes load", async () => {
    adminFetchPrizes.mockRejectedValueOnce(new Error("Network Error"))

    const container = await renderKiosk()
    expect(startButton(container).disabled).toBe(true)

    adminFetchPrizes.mockResolvedValue(prizes)
    await act(async () => click(retryButton(container)))

    expect(adminFetchPrizes).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(startButton(container).disabled).toBe(false)
  })

  it("starts a booth session with the entered buyer name and turn count, then shows the machine", async () => {
    adminStartBoothSession.mockResolvedValue({ session_id: 5, order_id: 9, order_token: "tok" })

    const container = await renderKiosk()
    const nameInput = container.querySelector('input[type="text"]')
    const turnsInput = container.querySelector('input[type="number"]')

    await act(async () => change(nameInput, "Mai"))
    await act(async () => change(turnsInput, "3"))
    await act(async () => click(startButton(container)))

    expect(adminStartBoothSession).toHaveBeenCalledWith(1, { buyerName: "Mai", turnsTotal: 3 })
    expect(spinButton(container)).toBeTruthy()
    expect(container.textContent).toContain("0/3")
  })

  it("passes the fetched prizes to the machine rather than an empty list", async () => {
    adminStartBoothSession.mockResolvedValue({ session_id: 5 })

    const container = await renderKiosk()
    await act(async () => click(startButton(container)))

    expect(container.textContent).toContain("Sticker")
  })

  it("draws against the started session with a fresh idempotency key each tap", async () => {
    adminStartBoothSession.mockResolvedValue({ session_id: 5 })
    adminDrawSession.mockResolvedValue({
      prize: prizes[0], turns_used: 1, turns_total: 5, session_completed: false,
    })

    const container = await renderKiosk()
    await act(async () => click(startButton(container)))
    await act(async () => click(spinButton(container)))
    await flush()
    await act(async () => click(spinButton(container)))
    await flush()

    expect(adminDrawSession).toHaveBeenCalledTimes(2)
    expect(adminDrawSession.mock.calls[0][0]).toBe(5)
    expect(adminDrawSession.mock.calls[0][1].length).toBeGreaterThan(0)
    expect(adminDrawSession.mock.calls[0][1]).not.toBe(adminDrawSession.mock.calls[1][1])
  })

  it("triggers a draw when Space is pressed, for a physical USB button wired as a keyboard emulator", async () => {
    adminStartBoothSession.mockResolvedValue({ session_id: 5 })
    adminDrawSession.mockResolvedValue({
      prize: prizes[0], turns_used: 1, turns_total: 5, session_completed: false,
    })

    const container = await renderKiosk()
    await act(async () => click(startButton(container)))

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }))
    })
    await flush()

    expect(adminDrawSession).toHaveBeenCalledTimes(1)
  })

  it("does not listen for Space before a session has started", async () => {
    const container = await renderKiosk()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true }))
    })

    expect(adminDrawSession).not.toHaveBeenCalled()
    expect(startButton(container)).toBeTruthy()
  })

  it("keeps the final reveal on screen when the session completes, until staff taps next buyer", async () => {
    adminStartBoothSession.mockResolvedValue({ session_id: 5 })
    adminDrawSession.mockResolvedValue({
      prize: prizes[1], turns_used: 1, turns_total: 1, session_completed: true,
    })

    const container = await renderKiosk()
    const turnsInput = container.querySelector('input[type="number"]')
    await act(async () => change(turnsInput, "1"))
    await act(async () => click(startButton(container)))
    await act(async () => click(spinButton(container)))
    await flush()

    const reveal = container.querySelector('[role="dialog"]')
    expect(reveal).not.toBeNull()
    expect(reveal.textContent).toContain("Poster")
    expect(nextBuyerButton(container)).toBeTruthy()

    await act(async () => click(nextBuyerButton(container)))

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(startButton(container)).toBeTruthy()
  })

  it("shows the readable API message, not the machine error code, when the prize fetch fails", async () => {
    const err = new Error("Request failed with status code 500")
    err.response = { data: { error: "server_error", message: "Lỗi server. Thử lại sau." } }
    adminFetchPrizes.mockRejectedValue(err)

    const container = await renderKiosk()

    const alert = container.querySelector('[role="alert"]')
    expect(alert.textContent).toContain("Lỗi server. Thử lại sau.")
    expect(alert.textContent).not.toContain("server_error")
  })

  it("shows the readable API message, not the machine error code, when starting a session fails", async () => {
    const err = new Error("Request failed with status code 409")
    err.response = { data: { error: "gacha_sold_out", message: "Gacha đã hết hàng." } }
    adminStartBoothSession.mockRejectedValue(err)

    const container = await renderKiosk()
    await act(async () => click(startButton(container)))

    const alert = container.querySelector('[role="alert"]')
    expect(alert.textContent).toContain("Gacha đã hết hàng.")
    expect(alert.textContent).not.toContain("gacha_sold_out")
  })
})
