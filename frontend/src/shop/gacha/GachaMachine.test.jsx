import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import GachaMachine from "./GachaMachine"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const prizes = [
  { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000, quantity_remaining: 10 },
]

const winner = { id: 1, name: "Sticker", tier: "common", display_price: 5000 }

// The real reel runs for 7.5-9.5s of wall clock. Drive requestAnimationFrame
// off the microtask queue with a coarse clock so a full spin finishes inside a
// handful of act() flushes instead of timing the suite out.
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

async function renderMachine(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<GachaMachine prizes={prizes} {...props} />)
  })
  return container
}

function spinButton(container) {
  return [...container.querySelectorAll("button")].find((b) =>
    /mở hộp|open case|đang mở|hết lượt|no turns/i.test(b.textContent),
  )
}

function click(el) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

beforeEach(() => {
  restoreRaf = installFastRaf()
})

afterEach(() => {
  restoreRaf()
  document.body.innerHTML = ""
})

describe("GachaMachine", () => {
  it("calls drawFn when the spin button is pressed, and shows the result", async () => {
    const drawFn = vi.fn().mockResolvedValue({
      prize: winner,
      turns_used: 1,
      turns_total: 3,
      session_completed: false,
    })
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    expect(drawFn).toHaveBeenCalledTimes(1)

    await flush()
    const result = container.querySelector('[role="dialog"]')
    expect(result).not.toBeNull()
    expect(result.textContent).toContain("Sticker")
  })

  it("disables the spin button once turnsUsed reaches turnsTotal", async () => {
    const container = await renderMachine({ turnsTotal: 1, turnsUsed: 1, drawFn: vi.fn() })
    expect(spinButton(container).disabled).toBe(true)
  })

  it("never calls drawFn twice for one click while a draw is in flight", async () => {
    let resolveDraw
    const drawFn = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDraw = resolve
        }),
    )
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    const button = spinButton(container)
    await act(async () => {
      click(button)
      click(button)
      click(button)
    })
    expect(drawFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDraw({ prize: winner, turns_used: 1, turns_total: 3, session_completed: false })
    })
    await flush()
    expect(container.querySelector('[role="dialog"]').textContent).toContain("Sticker")
  })

  it("reports the drawFn response and session completion to the caller", async () => {
    const response = { prize: winner, turns_used: 3, turns_total: 3, session_completed: true }
    const onDrawResult = vi.fn()
    const onSessionComplete = vi.fn()
    const container = await renderMachine({
      turnsTotal: 3,
      turnsUsed: 2,
      drawFn: vi.fn().mockResolvedValue(response),
      onDrawResult,
      onSessionComplete,
    })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(onDrawResult).toHaveBeenCalledWith(response)
    expect(onSessionComplete).toHaveBeenCalledTimes(1)
    expect(spinButton(container).disabled).toBe(true)
  })

  it("re-enables the button and surfaces an error when drawFn rejects", async () => {
    const drawFn = vi.fn().mockRejectedValue(new Error("hết lượt rồi"))
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(container.textContent).toContain("hết lượt rồi")
    expect(spinButton(container).disabled).toBe(false)

    await act(async () => {
      click(spinButton(container))
    })
    expect(drawFn).toHaveBeenCalledTimes(2)
  })

  it("retries a failed draw with the SAME key, so a lost response cannot burn a second turn", async () => {
    const drawFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue({ prize: winner, turns_used: 1, turns_total: 3, session_completed: false })
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(drawFn).toHaveBeenCalledTimes(2)
    expect(drawFn.mock.calls[0][0]).toBeTypeOf("string")
    expect(drawFn.mock.calls[1][0]).toBe(drawFn.mock.calls[0][0])
  })

  it("uses a fresh key for the next spin once a draw has succeeded", async () => {
    const drawFn = vi
      .fn()
      .mockResolvedValue({ prize: winner, turns_used: 1, turns_total: 3, session_completed: false })
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()
    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(drawFn).toHaveBeenCalledTimes(2)
    expect(drawFn.mock.calls[1][0]).not.toBe(drawFn.mock.calls[0][0])
  })

  it("uses a fresh key after a settled failure, which cannot have left a turn in doubt", async () => {
    const settled = new Error("Request failed with status code 409")
    settled.response = { data: { error: "gacha_sold_out", message: "Hết quà" } }
    const drawFn = vi
      .fn()
      .mockRejectedValueOnce(settled)
      .mockResolvedValue({ prize: winner, turns_used: 1, turns_total: 3, session_completed: false })
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()
    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(drawFn.mock.calls[1][0]).not.toBe(drawFn.mock.calls[0][0])
  })

  it("shows the readable API message, not the machine error code, when the draw is rejected", async () => {
    const err = new Error("Request failed with status code 500")
    err.response = { data: { error: "server_error", message: "Lỗi server. Thử lại sau." } }
    const drawFn = vi.fn().mockRejectedValue(err)
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    await act(async () => {
      click(spinButton(container))
    })
    await flush()

    expect(container.textContent).toContain("Lỗi server. Thử lại sau.")
    expect(container.textContent).not.toContain("server_error")
  })
})
