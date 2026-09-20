import { fetchCollections, fetchCollection } from "../api/shop"
import { findProduct } from "./cartAvailability"
import { isSoldOut } from "../components/shop/ProductCard"
import { addToCart } from "./cart"

/**
 * Cheap, local (no network) check for whether "Order again" is even worth
 * offering - true iff at least one non-gift item still points at a variant
 * that hasn't been deleted since (product_variant_id goes NULL on delete,
 * see migration 011_create_order_items.js's ON DELETE SET NULL). This is
 * not a live-availability check - it only decides button visibility, so it
 * must stay free of any fetch (it runs on every Order.jsx render). A real
 * order can still end up "0 added" after a click if everything failed the
 * live check in the meantime (e.g. every remaining item sold out) - that
 * outcome is communicated in the summary, not by hiding the button.
 *
 * `is_gift` may be `undefined` on `main` until the free-gift feature
 * lands - that degrades to falsy, so every item is treated as reorderable
 * rather than throwing.
 */
export function hasReorderableItems(items) {
  return (items || []).some((i) => !i.is_gift && Number.isInteger(i.product_variant_id))
}

/** null/undefined stock_qty means unlimited - clamp only when a real ceiling exists. */
function clampToStock(qty, stockQty) {
  if (stockQty === null || stockQty === undefined) return qty
  return Math.max(0, Math.min(qty, stockQty))
}

/** Mirrors ProductCard.jsx's own digital-flattening: a digital product is
 *  treated as a single synthesized "variant" so the rest of this module
 *  never needs a separate digital/physical branch. */
function resolveVariant(product, variantId) {
  if (product.type === "digital") {
    return {
      id: product.variant_id, label: "", stock_qty: product.stock_qty,
      images: product.images, thumbnail_image: product.thumbnail_image,
    }
  }
  return product.variants?.find((v) => v.id === variantId) || null
}

function coverImage(product, variant) {
  const ownImages = variant.images?.length ? variant.images : (variant.image_url ? [variant.image_url] : [])
  return variant.thumbnail_image || ownImages[0] || product.images?.[0] || null
}

/**
 * Best-effort "buy it again": re-fetches live catalog data for each of the
 * order's non-gift, still-referenced items and adds whatever is still
 * orderable to the cart at CURRENT price/name/image (never the order's own
 * frozen snapshot fields - see CLAUDE.md's Snapshotting section), clamped
 * to current stock. No atomicity - this only ever mutates the local cart,
 * same as any other addToCart call; Cart.jsx and checkout both re-validate
 * everything again regardless of what this adds.
 */
export async function reorderOrderItems(order) {
  const items = (order.items || []).filter((i) => !i.is_gift && Number.isInteger(i.product_variant_id))
  const skipped = []
  let addedCount = 0

  if (items.length === 0) return { addedCount, skipped }

  let collectionsById
  try {
    collectionsById = new Map((await fetchCollections()).map((c) => [c.id, c]))
  } catch {
    // Catalog unreachable right now - every item fails the same way.
    return { addedCount, skipped: items.map((i) => ({ name: i.product_name_snapshot, reason: "unavailable" })) }
  }

  const slugs = new Set(
    items.map((i) => collectionsById.get(i.collection_id_snapshot)?.slug).filter(Boolean)
  )
  const detailBySlug = new Map()
  await Promise.all(
    [...slugs].map(async (slug) => {
      try {
        detailBySlug.set(slug, await fetchCollection(slug))
      } catch {
        detailBySlug.set(slug, null)
      }
    })
  )

  for (const item of items) {
    const name = item.product_name_snapshot
    const listed = collectionsById.get(item.collection_id_snapshot)
    if (!listed) { skipped.push({ name, reason: "unavailable" }); continue }

    const detail = detailBySlug.get(listed.slug)
    if (!detail) { skipped.push({ name, reason: "unavailable" }); continue }
    if (detail.status === "closed") { skipped.push({ name, reason: "ended" }); continue }
    if (detail.not_started_yet) { skipped.push({ name, reason: "not_started" }); continue }

    const product = findProduct(detail, item.product_variant_id)
    if (!product) { skipped.push({ name, reason: "unavailable" }); continue }

    const variant = resolveVariant(product, item.product_variant_id)
    if (!variant || isSoldOut(variant)) { skipped.push({ name, reason: "sold_out" }); continue }

    const qty = clampToStock(item.qty, variant.stock_qty)
    if (qty <= 0) { skipped.push({ name, reason: "sold_out" }); continue }

    addToCart({
      variant_id: variant.id,
      qty,
      product_name: product.name,
      variant_label: variant.label,
      price: product.price,
      image_url: coverImage(product, variant),
      collection_slug: detail.slug,
      is_digital: product.type === "digital",
    })
    addedCount += 1
  }

  return { addedCount, skipped }
}
