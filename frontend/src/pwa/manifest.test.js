import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../../public/manifest.webmanifest"), "utf8")
)

describe("manifest.webmanifest", () => {
  it("has the required top-level fields", () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe("/")
    expect(manifest.display).toBe("standalone")
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it("matches the site's current --brand color", () => {
    const css = readFileSync(join(__dirname, "../index.css"), "utf8")
    const brand = css.match(/--brand:\s*(#[0-9a-fA-F]{6})/)?.[1]
    expect(brand).toBeTruthy()
    expect(manifest.theme_color).toBe(brand)
    expect(manifest.background_color).toBe(brand)
  })

  it("declares at least a 192x192 and a 512x512 icon", () => {
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true)
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true)
    manifest.icons.forEach((i) => {
      expect(i.src).toBeTruthy()
      expect(i.type).toBe("image/png")
    })
  })
})
