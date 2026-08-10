import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const css = readFileSync(join(__dirname, "../index.css"), "utf8")

/** Returns the content between the first balanced { ... } pair after `selector`. */
function extractBlock(css, selector) {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`selector ${selector} not found in index.css`)
  const braceStart = css.indexOf("{", start)
  let depth = 0
  let i = braceStart
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++
    if (css[i] === "}") { depth--; if (depth === 0) break }
  }
  return css.slice(braceStart + 1, i)
}

const rootBlock = extractBlock(css, ":root")
const darkBlock = extractBlock(css, ".dark {")

const VARIANTS = ["success", "danger", "warning", "neutral"]
const SHADES = ["surface", "border", "text"]

describe("semantic colour tokens (admin UI & shop state)", () => {
  VARIANTS.forEach((variant) => {
    SHADES.forEach((shade) => {
      const name = `--${shade}-${variant}`
      it(`${name} is defined in :root (light mode)`, () => {
        expect(rootBlock).toMatch(new RegExp(`${name}:`))
      })
      it(`${name} is overridden in .dark`, () => {
        expect(darkBlock).toMatch(new RegExp(`${name}:`))
      })
    })
  })

  it("does not define success/warning aliases against --brand, which is admin-configurable", () => {
    const successLine = rootBlock.match(/--text-success:\s*([^;]+);/)?.[1] ?? ""
    const warningLine = rootBlock.match(/--text-warning:\s*([^;]+);/)?.[1] ?? ""
    expect(successLine).not.toMatch(/--brand/)
    expect(warningLine).not.toMatch(/--brand/)
  })
})
