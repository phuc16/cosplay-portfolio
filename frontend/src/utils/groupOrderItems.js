/**
 * Collapses order-item rows that represent the same purchasable thing into
 * one row with a summed qty, for display only. Each gacha draw snapshots
 * its own order_items row with qty 1 (see backend/shop/gacha/sessionRepo.js)
 * so identical prizes drawn more than once render as repeated "X × 1" lines
 * unless grouped - a normal cart line never needs this (createOrder already
 * coalesces same-variant cart lines into one row), so this is a no-op for
 * every non-gacha order.
 */
export function groupOrderItems(items, keyOf) {
  const groups = []
  const indexByKey = new Map()
  for (const item of items) {
    const key = keyOf(item)
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length)
      groups.push({ ...item })
    } else {
      groups[existingIndex] = { ...groups[existingIndex], qty: groups[existingIndex].qty + item.qty }
    }
  }
  return groups
}
