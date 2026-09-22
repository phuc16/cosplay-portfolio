import { formatVnd } from "../utils/money"

/**
 * Deep-link back to one specific product (and its variant, if it has more
 * than one) inside a collection - the closest thing this shop has to a
 * per-product page (see docs/DECISIONS.md's 2026-08-11 "Cart items link
 * back to their product": no per-product route exists by design).
 * Absolute, built from the running page's own origin - the frontend has no
 * SITE_URL-equivalent env var (only the backend reads one, for CORS).
 */
export function buildShareUrl(collectionSlug, productId, variantId) {
  const params = new URLSearchParams({ product: String(productId) })
  if (variantId !== null && variantId !== undefined) {
    params.set("variant", String(variantId))
  }
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}/merchandise/${collectionSlug}?${params.toString()}`
}

/**
 * { title, text } for navigator.share / shown alongside the copied link.
 * productName/variantLabel are buyer-supplied catalog data, never
 * translated; the connecting copy comes from translations.js via t() so it
 * stays bilingual, same convention as every other buyer-facing string.
 */
export function buildShareText(t, productName, variantLabel, price) {
  const product = variantLabel ? `${productName} · ${variantLabel}` : productName
  return {
    title: product,
    text: t("shopShareText", { product, price: formatVnd(price), shop: t("shopTitle") }),
  }
}
