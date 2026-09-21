import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import GachaMachine from "./GachaMachine"
import { gachaAudio } from "./gachaAudio"
import { formatVnd } from "../../utils/money"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const prizes = [
  { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000, quantity_remaining: 10 },
]

// Three tiers, uneven stock: enough to prove the legend only lists tiers that
// actually have prizes and that the rates come out of tierOdds().
const catalogPrizes = [
  { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000, quantity_remaining: 50, description: "Sticker die-cut" },
  { id: 2, name: "Poster", tier: "rare", image_url: null, display_price: 20000, quantity_remaining: 30, description: "Poster A2" },
  { id: 3, name: "Figure", tier: "ancient", image_url: null, display_price: 900000, quantity_remaining: 20, description: "Figure 1/7" },
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

const roots = []

async function renderMachine(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
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

afterEach(async () => {
  // Unmount before resetting the audio singleton: its subscriber list would
  // otherwise call setState on a still-mounted root after teardown.
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  restoreRaf()
  document.body.innerHTML = ""
  // gachaAudio is a module singleton whose on/off state is persisted, so a
  // toggle in one test would otherwise leak into the next.
  gachaAudio.setEnabled(true)
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

describe("GachaMachine - catalogue panel", () => {
  function peekDialog(container) {
    return container.querySelector('[aria-label="Chi tiết phần thưởng"]')
  }

  function catalogButton(container, name) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(name))
  }

  it("lists every prize with its name, price and tier label", async () => {
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn(),
    })

    expect(container.textContent).toContain("3 món")
    expect(container.textContent).toContain("Figure")
    expect(container.textContent).toContain("900.000₫")
    expect(container.textContent).toContain("CỔ VẬT")
  })

  it("shows a tier legend of only the tiers that have prizes, with their live odds", async () => {
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn(),
    })

    const legend = [...container.querySelectorAll("span")]
      .map((s) => s.textContent)
      .join(" ")
    expect(legend).toContain("THƯỜNG 50%")
    expect(legend).toContain("HIẾM 30%")
    expect(legend).toContain("CỔ VẬT 20%")
    expect(legend).not.toContain("SỬ THI")
  })

  it("paints each tier in the mockup's colour", async () => {
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn(),
    })

    const swatches = [...container.querySelectorAll("i")].map((i) => i.style.background)
    expect(swatches).toEqual([
      "rgb(230, 230, 230)",
      "rgb(62, 139, 255)",
      "rgb(232, 182, 44)",
    ])
  })

  it("opens a peek modal for the tapped prize and closes it again", async () => {
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn(),
    })
    expect(peekDialog(container)).toBeNull()

    await act(async () => click(catalogButton(container, "Poster")))

    const peek = peekDialog(container)
    expect(peek).not.toBeNull()
    expect(peek.textContent).toContain("Poster A2")
    expect(peek.textContent).toContain("×30")

    await act(async () => click(peek))
    expect(peekDialog(container)).toBeNull()
  })

  it("never calls drawFn from the catalogue, only from the spin button", async () => {
    const drawFn = vi.fn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 3, turnsUsed: 0, drawFn,
    })

    await act(async () => click(catalogButton(container, "Figure")))

    expect(drawFn).not.toHaveBeenCalled()
  })
})

describe("GachaMachine - sound toggle", () => {
  function soundButton(container) {
    return container.querySelector('button[aria-pressed]')
  }

  it("toggles the shared sound preference and reflects it in the control", async () => {
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn() })

    const button = soundButton(container)
    expect(button.getAttribute("aria-pressed")).toBe("true")

    await act(async () => click(button))

    expect(gachaAudio.enabled).toBe(false)
    expect(soundButton(container).getAttribute("aria-pressed")).toBe("false")
  })

  it("hides its own toggle when the host page renders one", async () => {
    const container = await renderMachine({
      turnsTotal: 3, turnsUsed: 0, drawFn: vi.fn(), showSoundToggle: false,
    })

    expect(soundButton(container)).toBeNull()
  })
})

describe("GachaMachine - unlimited turns", () => {
  const UNLIMITED_TURNS = 1_000_000

  async function spinOnce(container) {
    await act(async () => {
      click(spinButton(container))
    })
    await flush()
  }

  function eyebrow(container) {
    return container.querySelector(".gacha-machine section > div > div").textContent
  }

  function continueButton(container) {
    return [...container.querySelectorAll('[role="dialog"] button')].find((b) =>
      /lượt tiếp|xong/i.test(b.textContent),
    )
  }

  it("keeps the sentinel turn count out of the header and the continue button", async () => {
    const drawFn = vi.fn().mockResolvedValue({
      prize: winner,
      turns_used: 1,
      turns_total: UNLIMITED_TURNS,
      session_completed: false,
    })
    const container = await renderMachine({
      turnsTotal: UNLIMITED_TURNS, turnsUsed: 0, drawFn,
    })

    expect(eyebrow(container)).toBe("Chạm để mở")

    await spinOnce(container)

    expect(continueButton(container).textContent).toBe("Lượt tiếp")
    expect(container.textContent).not.toContain("999999")
    expect(container.textContent).not.toContain("1000000 lượt")
  })

  it("still shows the real count for a finite session", async () => {
    const drawFn = vi.fn().mockResolvedValue({
      prize: winner,
      turns_used: 1,
      turns_total: 3,
      session_completed: false,
    })
    const container = await renderMachine({ turnsTotal: 3, turnsUsed: 0, drawFn })

    expect(eyebrow(container)).toBe("Chạm để mở · còn 3 lượt")

    await spinOnce(container)

    expect(continueButton(container).textContent).toBe("Lượt tiếp (còn 2)")
  })
})

describe("GachaMachine - session summary", () => {
  const first = { id: 1, name: "Sticker", tier: "common", image_url: null, display_price: 5000 }
  const second = { id: 2, name: "Poster", tier: "rare", image_url: null, display_price: 20000 }

  function summaryDialog(container) {
    return container.querySelector('[aria-label="Quà của bạn"]')
  }

  function summaryButton(container) {
    return [...summaryDialog(container).querySelectorAll("button")].find((b) =>
      /khách tiếp theo|đóng/i.test(b.textContent),
    )
  }

  async function playSession(container, drawFn, turns) {
    for (let i = 0; i < turns; i++) {
      await act(async () => click(spinButton(container)))
      await flush()
      await act(async () => click(continueOut(container)))
    }
  }

  function twoDrawFn() {
    return vi
      .fn()
      .mockResolvedValueOnce({ prize: first, turns_used: 1, turns_total: 2, session_completed: false })
      .mockResolvedValueOnce({ prize: second, turns_used: 2, turns_total: 2, session_completed: true })
  }

  it("lists every drop of the session and its total value after the final turn", async () => {
    const drawFn = twoDrawFn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn,
    })

    await playSession(container, drawFn, 2)

    const summary = summaryDialog(container)
    expect(summary).not.toBeNull()
    expect(summary.textContent).toContain("Quà của bạn")
    expect(summary.textContent).toContain("Sticker")
    expect(summary.textContent).toContain("Poster")
    expect(summary.textContent).toContain("2 món")
    expect(summary.textContent).toContain(`Tổng giá trị ${formatVnd(25000)}`)
    expect(summary.textContent).toContain("Lượt 1")
    expect(summary.textContent).toContain("Lượt 2")
  })

  it("shows the staff-handover footer and the claim code at the booth kiosk", async () => {
    const drawFn = twoDrawFn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn, onFinish: vi.fn(),
    })

    await playSession(container, drawFn, 2)

    const summary = summaryDialog(container)
    expect(summary.textContent).toMatch(/Mã nhận quà [ACDEFHJKLMNPRTUVWXY3479]{3}-[ACDEFHJKLMNPRTUVWXY3479]{3}/)
    expect(summary.textContent).toContain("Đưa màn hình này cho nhân viên để nhận quà")
  })

  it("hides the staff-handover footer and the claim code off the booth kiosk", async () => {
    const drawFn = twoDrawFn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn,
    })

    await playSession(container, drawFn, 2)

    const summary = summaryDialog(container)
    expect(summary.textContent).not.toContain("Mã nhận quà")
    expect(summary.textContent).not.toContain("nhân viên")
    expect(summary.textContent).toContain("Sticker")
    expect(summary.textContent).toContain("Poster")
    expect(summary.textContent).toContain("2 món")
    expect(summary.textContent).toContain(`Tổng giá trị ${formatVnd(25000)}`)
    expect(summaryButton(container).textContent).toBe("Đóng")
  })

  it("returns to the idle reel, with no summary, when turns remain", async () => {
    const drawFn = twoDrawFn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn,
    })

    await playSession(container, drawFn, 1)

    expect(summaryDialog(container)).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(spinButton(container).disabled).toBe(false)
  })

  it("hands the summary's action to onFinish when the host owns the reset", async () => {
    const drawFn = twoDrawFn()
    const onFinish = vi.fn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn, onFinish,
    })

    await playSession(container, drawFn, 2)
    const button = summaryButton(container)
    expect(button.textContent).toBe("Khách tiếp theo")

    await act(async () => click(button))

    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(summaryDialog(container)).not.toBeNull()
  })

  it("dismisses itself back to the idle reel when no onFinish is supplied", async () => {
    const drawFn = twoDrawFn()
    const container = await renderMachine({
      prizes: catalogPrizes, turnsTotal: 2, turnsUsed: 0, drawFn,
    })

    await playSession(container, drawFn, 2)
    const button = summaryButton(container)
    expect(button.textContent).toBe("Đóng")

    await act(async () => click(button))

    expect(summaryDialog(container)).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe("GachaMachine - audio failures", () => {
  afterEach(() => {
    delete window.AudioContext
    gachaAudio.ctx = null
    gachaAudio.buffers = {}
  })

  it("completes a spin when the AudioContext constructor throws", async () => {
    window.AudioContext = function ThrowingAudioContext() {
      throw new Error("AudioContext is not allowed")
    }
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
    await flush()

    expect(container.querySelector('[role="dialog"]').textContent).toContain("Sticker")

    await act(async () => {
      click(continueOut(container))
    })
    expect(spinButton(container).disabled).toBe(false)

    await act(async () => {
      click(spinButton(container))
    })
    expect(drawFn).toHaveBeenCalledTimes(2)
  })

  it("swallows a throw from any node the AudioContext hands out", async () => {
    window.AudioContext = function BrokenAudioContext() {
      this.state = "running"
      this.currentTime = 0
      this.destination = {}
      this.createGain = () => ({ gain: {}, connect: () => {} })
      this.createOscillator = () => {
        throw new Error("no oscillators for you")
      }
      this.createBufferSource = () => {
        throw new Error("no sources for you")
      }
    }
    gachaAudio.buffers["tick.mp3"] = {}

    expect(() => gachaAudio.click()).not.toThrow()
    expect(() => gachaAudio.tick()).not.toThrow()
    expect(() => gachaAudio.crateOpen()).not.toThrow()
    expect(() => gachaAudio.chime("common")).not.toThrow()
    expect(() => gachaAudio.preload()).not.toThrow()
  })
})

function continueOut(container) {
  return [...container.querySelectorAll('[role="dialog"] button')].find((b) =>
    /lượt tiếp|xong/i.test(b.textContent),
  )
}
