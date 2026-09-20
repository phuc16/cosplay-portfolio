import { renderMarkdown } from "./markdown"

/**
 * Markdown -> plain text, for meta descriptions/OG text (which can't render
 * HTML). Reuses the same sanitized-HTML renderer the visible page already
 * uses (renderMarkdown) rather than a second markdown parser, then reads
 * `textContent` off a detached element instead of regex-stripping tags -
 * robust against nested/malformed markup without inventing a second parser.
 * The detached element is never attached to the document, so this is safe
 * to call with already-sanitized (but still HTML) content.
 */
export function stripMarkdownToText(markdown) {
  const html = renderMarkdown(markdown)
  if (!html) return ""
  const el = document.createElement("div")
  el.innerHTML = html
  return (el.textContent || "").replace(/\s+/g, " ").trim()
}

/**
 * Truncates near maxLen on a word boundary (never mid-word) and appends an
 * ellipsis, but only when text actually got cut - a string already under
 * the limit comes back untouched, with no trailing "…".
 */
export function truncateText(text, maxLen = 160) {
  if (!text) return ""
  if (text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(" ")
  // Only break on a space if it doesn't throw away most of the excerpt -
  // otherwise (e.g. one very long word) just hard-cut at maxLen.
  const trimmed = lastSpace > maxLen * 0.4 ? cut.slice(0, lastSpace) : cut
  return `${trimmed.trim()}…`
}

/**
 * `/api/storage/...`-style paths (what every image URL in this app already
 * is - see backend/storage.js) resolve fine for an in-page <img> but are
 * meaningless to an external crawler/link-unfurler, which needs a full
 * absolute URL to fetch og:image/twitter:image/JSON-LD image from. Already-
 * absolute URLs pass through unchanged.
 */
export function toAbsoluteUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  if (typeof window === "undefined" || !window.location) return path
  return path.startsWith("/") ? `${window.location.origin}${path}` : `${window.location.origin}/${path}`
}

/**
 * Same "what single image best represents this product" resolution
 * ProductCard.jsx uses for its own grid-card cover (thumbnail_image, then
 * the product's own images, then the first variant that has one) -
 * duplicated narrowly here rather than imported, since ProductCard derives
 * it from local view-state (which variant list is active) that this
 * page-load-time, SEO-only helper has no equivalent of.
 */
export function productSeoImage(product) {
  if (!product) return null
  if (product.thumbnail_image) return product.thumbnail_image
  if (product.images?.length) return product.images[0]
  for (const v of product.variants || []) {
    if (v.thumbnail_image) return v.thumbnail_image
    if (v.images?.length) return v.images[0]
    if (v.image_url) return v.image_url
  }
  return null
}
