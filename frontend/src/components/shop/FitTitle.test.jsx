import { describe, it, expect } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: FitTitle } = await import("./FitTitle")

async function renderFitTitle(props) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<FitTitle {...props} />) })
  return container
}

describe("FitTitle", () => {
  it("renders the given text in an <h1> by default", async () => {
    const container = await renderFitTitle({ text: "Mid-Autumn Festival 2026" })
    const h1 = container.querySelector("h1")
    expect(h1).toBeTruthy()
    expect(h1.textContent).toBe("Mid-Autumn Festival 2026")
  })

  it("renders in a custom tag when `as` is given", async () => {
    const container = await renderFitTitle({ text: "Drop", as: "h2" })
    expect(container.querySelector("h2")?.textContent).toBe("Drop")
    expect(container.querySelector("h1")).toBeNull()
  })

  it("applies the given className to the visible heading", async () => {
    const container = await renderFitTitle({ text: "Drop", className: "font-bold mb-2" })
    const h1 = container.querySelector("h1")
    expect(h1.className).toBe("font-bold mb-2")
  })

  it("does not crash in an environment with no ResizeObserver (e.g. this test env)", async () => {
    expect(typeof globalThis.ResizeObserver).toBe("undefined")
    await expect(renderFitTitle({ text: "Drop" })).resolves.toBeTruthy()
  })

  it("includes a hidden measuring span with the same text, out of the accessibility tree", async () => {
    const container = await renderFitTitle({ text: "Mid-Autumn Festival 2026" })
    const span = container.querySelector('span[aria-hidden="true"]')
    expect(span).toBeTruthy()
    expect(span.textContent).toBe("Mid-Autumn Festival 2026")
  })
})
