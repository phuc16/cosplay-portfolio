import { describe, it, expect } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { MemoryRouter } from "react-router-dom"
import { LanguageProvider } from "../contexts/LanguageContext"
import { ThemeProvider } from "../contexts/ThemeContext"
import { FAQ_ITEMS } from "../shop/faq"
import Faq from "./Faq"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function renderFaq() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/merchandise/faq"]}>
        <ThemeProvider>
          <LanguageProvider>
            <Faq />
          </LanguageProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
  })
  return container
}

describe("Faq", () => {
  it("renders every FAQ question as a collapsed summary", async () => {
    const container = await renderFaq()
    const summaries = [...container.querySelectorAll("summary")]
    expect(summaries.length).toBe(FAQ_ITEMS.length)
    expect(summaries[0].textContent).toContain(FAQ_ITEMS[0].question.en)
  })

  it("renders each item as a native <details> element, collapsed by default", async () => {
    const container = await renderFaq()
    const items = [...container.querySelectorAll("details")]
    expect(items.length).toBe(FAQ_ITEMS.length)
    expect(items.every((d) => !d.open)).toBe(true)
  })

  it("puts the answer text inside its item's <details>", async () => {
    const container = await renderFaq()
    const first = container.querySelector("details")
    expect(first.textContent).toContain(FAQ_ITEMS[0].answer.en)
  })
})
