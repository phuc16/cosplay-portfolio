import { fetchCollection } from "../api/shop"
import { hasFlattenedVariant, isProductSoldOut, isSoldOut } from "../components/shop/ProductCard"

/** Finds this cart line's product within a fetched collection - digital and gacha products are flattened (variant_id lives on the product itself), physical products carry a real variants array. */
function findProduct(collection, variantId) {
  return collection.products.find((p) =>
    hasFlattenedVariant(p.type) ? p.variant_id === variantId : p.variants?.some((v) => v.id === variantId)
  )
}

/**
 * Classifies every cart line into valid or one of four reasons a buyer
 * can't actually check out with it. A 404 collapses deleted and archived
 * into one "unavailable" bucket, since the public API deliberately can't
 * (and shouldn't) tell those apart from the outside - but a not-yet-started
 * collection is now itself visible (see catalogRepo.js's not_started_yet),
 * so it gets its own distinct reason instead of falling into that bucket.
 */
export async function checkCartAvailability(cart) {
  const slugs = [...new Set(cart.map((c) => c.collection_slug).filter(Boolean))]
  const entries = await Promise.all(
    slugs.map((slug) => fetchCollection(slug).then((data) => [slug, data]).catch(() => [slug, null]))
  )
  const bySlug = new Map(entries)

  const problems = new Map()
  for (const line of cart) {
    if (!line.collection_slug) continue

    const collection = bySlug.get(line.collection_slug)
    if (!collection) {
      problems.set(line.variant_id, "unavailable")
      continue
    }
    if (collection.status === "closed") {
      problems.set(line.variant_id, "ended")
      continue
    }
    if (collection.not_started_yet) {
      problems.set(line.variant_id, "not_started")
      continue
    }

    const product = findProduct(collection, line.variant_id)
    if (!product) {
      problems.set(line.variant_id, "unavailable")
      continue
    }

    const soldOut = hasFlattenedVariant(product.type)
      ? isProductSoldOut(product)
      : isSoldOut(product.variants.find((v) => v.id === line.variant_id))
    if (soldOut) problems.set(line.variant_id, "sold_out")
  }
  return problems
}
