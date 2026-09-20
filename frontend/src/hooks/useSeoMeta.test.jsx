import { describe, it, expect, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { useSeoMeta } from "./useSeoMeta"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function TestHead({ title, description, ogImage, jsonLd }) {
  useSeoMeta(
    {
      title,
      meta: [
        { name: "description", content: description },
        { property: "og:image", content: ogImage },
      ],
      jsonLd,
    },
    [title, description, ogImage, jsonLd]
  )
  return null
}

let container
let root

beforeEach(() => {
  document.title = "Kamidayhehe"
  document.head.querySelectorAll('meta[name="description"], meta[property="og:image"], script[type="application/ld+json"]')
    .forEach((el) => el.remove())
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

async function render(ui) {
  await act(async () => { root.render(ui) })
}

describe("useSeoMeta", () => {
  it("sets document.title and a description meta tag", async () => {
    await render(<TestHead title="Drop - Kamidayhehe" description="Buy stuff" />)

    expect(document.title).toBe("Drop - Kamidayhehe")
    expect(document.querySelector('meta[name="description"]').getAttribute("content")).toBe("Buy stuff")
  })

  it("skips a meta entry whose content is null/undefined/empty", async () => {
    await render(<TestHead title="Drop" description="Buy stuff" ogImage={null} />)

    expect(document.querySelector('meta[property="og:image"]')).toBeNull()
  })

  it("emits a JSON-LD script tag with the object serialized", async () => {
    const jsonLd = { "@context": "https://schema.org", "@type": "ItemList", numberOfItems: 2 }
    await render(<TestHead title="Drop" description="Buy stuff" jsonLd={jsonLd} />)

    const script = document.querySelector('script[type="application/ld+json"]')
    expect(script).toBeTruthy()
    expect(JSON.parse(script.textContent)).toEqual(jsonLd)
  })

  it("re-applies tags when deps change, without leaving duplicates", async () => {
    await render(<TestHead title="Drop A" description="First" ogImage="https://x/a.jpg" />)
    await render(<TestHead title="Drop B" description="Second" ogImage="https://x/b.jpg" />)

    expect(document.title).toBe("Drop B")
    expect(document.querySelectorAll('meta[name="description"]').length).toBe(1)
    expect(document.querySelector('meta[name="description"]').getAttribute("content")).toBe("Second")
    expect(document.querySelector('meta[property="og:image"]').getAttribute("content")).toBe("https://x/b.jpg")
  })

  it("restores the previous title and removes tags/JSON-LD on unmount", async () => {
    const jsonLd = { "@type": "ItemList" }
    await render(<TestHead title="Drop" description="Buy stuff" jsonLd={jsonLd} />)
    expect(document.title).toBe("Drop")

    await act(async () => { root.unmount() })

    expect(document.title).toBe("Kamidayhehe")
    expect(document.querySelector('meta[name="description"]')).toBeNull()
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull()
  })

  it("leaves the title alone when no title is given", async () => {
    await render(<TestHead description="Buy stuff" />)
    expect(document.title).toBe("Kamidayhehe")
  })
})
