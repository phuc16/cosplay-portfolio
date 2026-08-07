import { marked } from "marked"
import DOMPurify from "dompurify"

marked.setOptions({ breaks: true, gfm: true })

/**
 * Render seller-authored markdown to HTML that is safe to inject.
 * Authors are admin-only, but sanitising costs nothing and closes the hole
 * if those credentials are ever compromised.
 */
export function renderMarkdown(text) {
  if (!text) return ""
  return DOMPurify.sanitize(marked.parse(String(text)), {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "del", "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "blockquote", "code", "pre", "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
  })
}
