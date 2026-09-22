import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(__dirname, "../../index.html"), "utf8")

describe("index.html PWA wiring", () => {
  it("links the web app manifest", () => {
    expect(html).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/)
  })

  it("sets a theme-color meta tag matching the manifest", () => {
    expect(html).toMatch(/<meta[^>]+name="theme-color"[^>]+content="#[0-9a-fA-F]{6}"/)
  })
})
