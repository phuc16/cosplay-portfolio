import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const fetchPracticePrizes = vi.fn()
const practiceDraw = vi.fn()

vi.mock("../api/shop", () => ({
  fetchPracticePrizes: (...args) => fetchPracticePrizes(...args),
  practiceDraw: (...args) => practiceDraw(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: GachaPractice } = await import("./GachaPractice")
const { gachaAudio } = await import("../shop/gacha/gachaAudio")

const prizes = [
  { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000 },
  { id: 2, name: "Poster", tier: "rare", image_url: null, display_price: 20000 },
]

// Mirrors GachaKiosk.test.jsx: the real reel runs for 7.5-9.5s of wall clock,
// so drive requestAnimationFrame off the microtask queue with a coarse clock
// to let a whole spin finish inside a few act() flushes.
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

async function renderPractice() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/merchandise/gacha/1/try"]}>
        <Routes>
          <Route path="/merchandise/gacha/:productId/try" element={<GachaPractice />} />
        </Routes>
      </MemoryRouter>
    )
  })
  return container
}

function buttonMatching(container, re) {
  return [...container.querySelectorAll("button")].find((b) => re.test(b.textContent))
}

function spinButton(container) {
  return buttonMatching(container, /mở hộp|đang mở|hết lượt/i)
}

function retryButton(container) {
  return buttonMatching(container, /thử lại/i)
}

function click(el) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

beforeEach(() => {
  restoreRaf = installFastRaf()
  fetchPracticePrizes.mockReset().mockResolvedValue({ prizes, tier_odds: [] })
  practiceDraw.mockReset()
})

afterEach(() => {
  restoreRaf()
  document.body.innerHTML = ""
})

describe("GachaPractice", () => {
  it("starts the ambient BGM on mount", async () => {
    const startSpy = vi.spyOn(gachaAudio, "startBgm")

    await renderPractice()

    expect(startSpy).toHaveBeenCalledTimes(1)
    startSpy.mockRestore()
  })

  it("loads the product's prize list and shows the machine", async () => {
    const container = await renderPractice()

    expect(fetchPracticePrizes).toHaveBeenCalledWith(1)
    expect(spinButton(container)).toBeTruthy()
    expect(container.textContent).toContain("Sticker")
  })

  it("explains a failed prize fetch and offers a retry instead of rendering the machine", async () => {
    fetchPracticePrizes.mockRejectedValue(new Error("Network Error"))

    const container = await renderPractice()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert.textContent).toMatch(/không tải được danh sách phần thưởng/i)
    expect(retryButton(container)).toBeTruthy()
    expect(spinButton(container)).toBeUndefined()
  })

  it("distinguishes a product with zero configured prizes from a failed fetch", async () => {
    fetchPracticePrizes.mockResolvedValue({ prizes: [], tier_odds: [] })

    const container = await renderPractice()

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(retryButton(container)).toBeUndefined()
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status.textContent).toMatch(/chưa được cấu hình phần thưởng/i)
    expect(spinButton(container)).toBeUndefined()
  })

  it("re-fetches on retry and renders the machine once prizes load", async () => {
    fetchPracticePrizes.mockRejectedValueOnce(new Error("Network Error"))

    const container = await renderPractice()
    expect(spinButton(container)).toBeUndefined()

    fetchPracticePrizes.mockResolvedValue({ prizes, tier_odds: [] })
    await act(async () => click(retryButton(container)))

    expect(fetchPracticePrizes).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(spinButton(container)).toBeTruthy()
  })

  it("allows unlimited free spins, counting each one without ever running out of turns", async () => {
    practiceDraw.mockResolvedValue({ prize: prizes[0] })

    const container = await renderPractice()

    await act(async () => click(spinButton(container)))
    await flush()
    expect(container.textContent).toContain("Lượt: 1/")

    await act(async () => click(spinButton(container)))
    await flush()

    expect(practiceDraw).toHaveBeenCalledTimes(2)
    expect(practiceDraw).toHaveBeenCalledWith(1)
    expect(container.textContent).toContain("Lượt: 2/")
    expect(spinButton(container).disabled).toBe(false)
    expect(container.querySelector('[role="dialog"]').textContent).toContain("Sticker")
  })

  it("surfaces a rejected practice draw and re-enables the button instead of faking a prize", async () => {
    practiceDraw.mockRejectedValue(new Error("Internal server error"))

    const container = await renderPractice()

    await act(async () => click(spinButton(container)))
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert.textContent).toMatch(/internal server error/i)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(spinButton(container).disabled).toBe(false)
  })

  it("shows the readable API message, not the machine error code, when the prize fetch fails", async () => {
    const err = new Error("Request failed with status code 500")
    err.response = { data: { error: "server_error", message: "Lỗi server. Thử lại sau." } }
    fetchPracticePrizes.mockRejectedValue(err)

    const container = await renderPractice()

    const alert = container.querySelector('[role="alert"]')
    expect(alert.textContent).toContain("Lỗi server. Thử lại sau.")
    expect(alert.textContent).not.toContain("server_error")
  })
})
