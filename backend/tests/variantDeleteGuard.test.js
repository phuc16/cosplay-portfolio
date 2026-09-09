import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import settings from "../shop/payments/settingsRepo.js"
import { resetTables } from "./helpers/db.js"

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }, { label: "A2", stock_qty: 5 }])
  const [rows] = await db.query("SELECT id, label FROM product_variants ORDER BY label")
  return { pid, a1: rows[0], a2: rows[1] }
}

const place = (variantId) => orders.createOrder({
  items: [{ variant_id: variantId, qty: 1 }],
  buyer: { buyer_name: "A", phone: "09", email: "a@example.com", address_raw: "x" },
  fulfillment_method: "ship", payment_method: "bank",
})

beforeEach(async () => {
  await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")
  await db.query("DELETE FROM payment_settings")
  await settings.updateSettings({
    bank_enabled: true, bank_name: "ACB", bank_bin: "970416",
    bank_account_number: "1", bank_account_holder: "A",
  })
})

describe("variant deletion guard", () => {
  it("refuses to delete a variant with a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)

    const [rows] = await db.query("SELECT id FROM product_variants")
    expect(rows).toHaveLength(2) // nothing removed
  })

  it("allows deletion once the order is cancelled", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "cancelled")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("allows deletion once the order is completed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")
    await orders.transitionOrder(o.id, "shipped")
    await orders.transitionOrder(o.id, "completed")

    await catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    const [rows] = await db.query("SELECT label FROM product_variants")
    expect(rows.map((r) => r.label)).toEqual(["A2"])
  })

  it("still allows editing a variant that has a pending order", async () => {
    const { pid, a1, a2 } = await seed()
    await place(a1.id)

    await catalog.replaceVariants(pid, [
      { id: a1.id, label: "A1", stock_qty: 99 },
      { id: a2.id, label: "A2", stock_qty: 5 },
    ])
    const [[v]] = await db.query("SELECT stock_qty FROM product_variants WHERE id = ?", [a1.id])
    expect(v.stock_qty).toBe(99)
  })

  it("blocks a confirmed order too, since its stock is still committed", async () => {
    const { pid, a1, a2 } = await seed()
    const o = await place(a1.id)
    await orders.transitionOrder(o.id, "confirmed")

    await expect(
      catalog.replaceVariants(pid, [{ id: a2.id, label: "A2", stock_qty: 5 }])
    ).rejects.toThrow(catalog.VariantInUseError)
  })

  // Regression test for the TOCTOU race: replaceVariants used to check for
  // live orders on an unlocked read BEFORE opening its delete transaction, so
  // a checkout could commit a brand-new order against a variant in between
  // that check passing and the DELETE committing - reproducing the exact bug
  // the guard exists to prevent, just via a race window instead of a
  // straightforward miss. The fix moves the check inside the transaction,
  // behind a `FOR UPDATE` on the variant row, so the two calls serialize on
  // that lock instead of both reading a stale "no live orders yet" snapshot.
  //
  // Looping repeatedly is what makes this a real test of the race rather than
  // a single roll of the dice on whichever call's connection happens to reach
  // MySQL first: with the lock in place either interleaving is safe, so a
  // regression only shows up as the "impossible" outcome below on *some*
  // fraction of iterations under real contention, not necessarily the first.
  it("never lets a concurrent checkout and variant delete both win", async () => {
    for (let i = 0; i < 8; i += 1) {
      await resetTables("email_queue", "order_items", "orders", "product_variants", "products", "collections")

      const cid = await catalog.createCollection({ title: "Drop", status: "active" })
      const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
      await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
      const [[variant]] = await db.query("SELECT id FROM product_variants LIMIT 1")

      const [deleteResult, orderResult] = await Promise.all([
        catalog.replaceVariants(pid, []).then(
          () => ({ ok: true }),
          (e) => ({ ok: false, e })
        ),
        place(variant.id).then(
          (r) => ({ ok: true, r }),
          (e) => ({ ok: false, e })
        ),
      ])

      const [rows] = await db.query("SELECT id FROM product_variants WHERE id = ?", [variant.id])
      const variantStillExists = rows.length === 1

      const [orderRows] = await db.query(
        "SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE oi.product_variant_id = ?",
        [variant.id]
      )
      const orderReferencesVariant = orderRows.length > 0

      // The two "both succeeded" / "both failed silently into an inconsistent
      // state" combinations are the ones that must never happen. Either the
      // delete won (variant gone, order creation must then have failed since
      // the variant no longer exists to order against) or the order won
      // (variant kept, delete must have been blocked by VariantInUseError).
      if (!variantStillExists) {
        expect(orderResult.ok).toBe(false)
        expect(orderReferencesVariant).toBe(false)
      } else {
        expect(deleteResult.ok).toBe(false)
        expect(deleteResult.e).toBeInstanceOf(catalog.VariantInUseError)
      }

      // The one state that would prove the race got through regardless of
      // which side "won": an order pointing at a variant id that no longer
      // exists in product_variants.
      expect(variantStillExists || !orderReferencesVariant).toBe(true)
    }
  })
})
