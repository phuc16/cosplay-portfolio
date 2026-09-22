const KEY = "shop_wishlist"

// Mirrors cart.js's writer/subscriber shape exactly - every write (add/
// remove/toggle) goes through writeWishlist, so notifying there is the one
// place that reaches every subscriber (the header badge, any open
// ProductCard) - no poller needed.
const listeners = new Set()

/** Subscribe to wishlist writes. Returns an unsubscribe function. */
export function subscribeWishlist(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}

/**
 * A stored entry is only trusted if it still carries what's needed to look
 * the item back up on the server (variant_id, product_id, collection_slug).
 * Unlike cart.js, price/name are NOT required here - this is deliberately
 * not a price/availability snapshot (see the wishlist design doc), just a
 * pointer to re-fetch live data by. They're kept only as optional display
 * fields for the header badge/list before a live fetch resolves.
 */
function isValid(entry) {
  return (
    entry &&
    Number.isInteger(entry.variant_id) &&
    Number.isInteger(entry.product_id) &&
    typeof entry.collection_slug === "string" && entry.collection_slug.length > 0
  )
}

/**
 * localStorage is user-writable and survives deploys, so anything read back
 * is treated as untrusted input rather than assumed well-formed.
 */
export function readWishlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid)
  } catch {
    return []
  }
}

function writeWishlist(wishlist) {
  try {
    localStorage.setItem(KEY, JSON.stringify(wishlist))
  } catch (error) {
    console.warn("Failed to persist wishlist to localStorage:", error)
  }
  notify()
  return wishlist
}

/** No qty/merge concept, unlike cart.js - a variant is either saved or not. Adding an already-saved variant is a no-op. */
export function addToWishlist(item) {
  const wishlist = readWishlist()
  if (wishlist.some((w) => w.variant_id === item.variant_id)) return wishlist
  return writeWishlist([...wishlist, { ...item }])
}

export function removeFromWishlist(variantId) {
  return writeWishlist(readWishlist().filter((w) => w.variant_id !== variantId))
}

/** Add if absent, remove if present - what the heart-icon toggle button drives. */
export function toggleWishlist(item) {
  const wishlist = readWishlist()
  const exists = wishlist.some((w) => w.variant_id === item.variant_id)
  return exists
    ? writeWishlist(wishlist.filter((w) => w.variant_id !== item.variant_id))
    : writeWishlist([...wishlist, { ...item }])
}

export function isWishlisted(variantId, wishlist = readWishlist()) {
  return wishlist.some((w) => w.variant_id === variantId)
}

/** Distinct items, not units - there's no qty concept in a wishlist. */
export function wishlistCount(wishlist) {
  return wishlist.length
}
