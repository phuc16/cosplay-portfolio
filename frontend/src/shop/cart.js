const KEY = "shop_cart"

// Every write (add/update/remove/clear) goes through writeCart, so notifying
// there is the one place that reaches every subscriber — no poller needed.
const listeners = new Set()

/** Subscribe to cart writes. Returns an unsubscribe function. */
export function subscribeCart(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const listener of listeners) listener()
}

/** A stored entry is only trusted if it still has a usable id, qty and price. */
function isValid(entry) {
  return (
    entry &&
    Number.isInteger(entry.variant_id) &&
    Number.isInteger(entry.qty) && entry.qty > 0 &&
    Number.isInteger(entry.price) && entry.price >= 0
  )
}

/**
 * localStorage is user-writable and survives deploys, so anything read back
 * is treated as untrusted input rather than assumed well-formed.
 */
export function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid)
  } catch {
    return []
  }
}

function writeCart(cart) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart))
  } catch (error) {
    console.warn("Failed to persist cart to localStorage:", error)
  }
  notify()
  return cart
}

export function addToCart(item) {
  const cart = readCart()
  const existing = cart.find((c) => c.variant_id === item.variant_id)

  if (existing) existing.qty += item.qty
  else cart.push({ ...item })

  return writeCart(cart)
}

export function updateQty(variantId, qty) {
  const cart = readCart()
  if (!Number.isInteger(qty) || qty <= 0) {
    return writeCart(cart.filter((c) => c.variant_id !== variantId))
  }
  return writeCart(cart.map((c) => (c.variant_id === variantId ? { ...c, qty } : c)))
}

export function removeFromCart(variantId) {
  return writeCart(readCart().filter((c) => c.variant_id !== variantId))
}

export function clearCart() {
  return writeCart([])
}

/** Total units across the cart, not the number of distinct lines. */
export function cartCount(cart) {
  return cart.reduce((sum, c) => sum + c.qty, 0)
}

/**
 * Display only. The server recomputes the authoritative total from catalog
 * prices at checkout, so a tampered localStorage cannot change what is charged.
 */
export function cartTotal(cart) {
  return cart.reduce((sum, c) => sum + c.price * c.qty, 0)
}
