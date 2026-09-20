import { useEffect } from "react"

/**
 * Tiny hand-rolled <head> tag manager for this client-rendered SPA (Vite,
 * no SSR/prerendering - a react-helmet-async-style provider exists mainly to
 * coordinate head tags across a streaming/hydrating server render, which
 * this app never does; see the SEO metadata design doc for the full
 * reasoning). Sets document.title, upserts <meta> tags, and an optional
 * JSON-LD <script>, then reverses all of it on unmount/deps-change so a
 * page that never calls this hook (Cart, Checkout, Order, admin) never
 * inherits a previous page's title, meta tags, or structured data.
 *
 * @param {Object} opts
 * @param {string} [opts.title] - document.title. Skipped (title left alone)
 *   if falsy, so a caller can wait for async data without a flash of "".
 * @param {Array<{name?: string, property?: string, content: any}>} [opts.meta]
 *   - one <meta> per entry. `name` (e.g. "description") or `property` (e.g.
 *   "og:title") - exactly one should be set. An entry whose `content` is
 *   null/undefined/"" is skipped entirely, so callers can pass optional
 *   fields (og:image when there's no image, etc.) without rendering an
 *   empty/misleading tag.
 * @param {Object} [opts.jsonLd] - serialized into one
 *   <script type="application/ld+json">. Omit for no structured data.
 * @param {Array} deps - effect dependency array, exactly like useEffect's -
 *   pass every value the title/meta/jsonLd are derived from so the tags
 *   re-apply when they change (e.g. on navigating between collections).
 */
export function useSeoMeta({ title, meta = [], jsonLd } = {}, deps) {
  useEffect(() => {
    const prevTitle = document.title
    if (title) document.title = title

    const createdMeta = meta
      .filter((m) => m.content !== null && m.content !== undefined && m.content !== "")
      .map(({ name, property, content }) => {
        const el = document.createElement("meta")
        el.setAttribute(name ? "name" : "property", name || property)
        el.setAttribute("content", String(content))
        document.head.appendChild(el)
        return el
      })

    let script = null
    if (jsonLd) {
      script = document.createElement("script")
      script.type = "application/ld+json"
      script.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(script)
    }

    return () => {
      document.title = prevTitle
      createdMeta.forEach((el) => el.remove())
      if (script) script.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
