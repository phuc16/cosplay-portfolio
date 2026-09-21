# One-Click Reorder - Implementation Plan

**Goal:** Let a buyer re-add a past order's real items to their cart from
the order page in one click, reusing the cart's existing live-availability
revalidation instead of building a new one.

**Architecture:** `attachItems` (backend) gains a `collection_slug` per
item via a `LEFT JOIN` onto the already-existing `collection_id_snapshot`
column - no migration. `toPublicOrder` already passes item fields through
unprojected, so no backend route change beyond the join. `Order.jsx`
(frontend) gets a "Đặt lại" button that maps reorderable items into
`cart.js`'s `addToCart` shape and shows the existing no-toast-library inline
confirmation pattern, linking to `/cart` (not auto-navigating).

**Tech Stack:** Node/Express, mysql2, React/Vite, Vitest.

---

### Task 1: `collection_slug` on order items

**Files:**
- Modify: `backend/shop/orders/orderRepo.js` (`attachItems`)
- Test: `backend/tests/orderRepo.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/orderRepo.test.js` (near existing `attachItems`/item
snapshot coverage):

```js
describe("attachItems: collection_slug", () => {
  it("includes the item's collection slug, resolved from collection_id_snapshot", async () => {
    const { variantId, collectionSlug } = await seedVariant(5)
    const res = await repo.createOrder(order(variantId, 1))
    const full = await repo.getOrderById(res.id)
    expect(full.items[0].collection_slug).toBe(collectionSlug)
  })

  it("is null for a gift line, which has no collection", async () => {
    const { variantId } = await seedVariant(5)
    await db.query(
      "INSERT INTO gift_settings (enabled, name, min_total) VALUES (1, 'Postcard', 1)"
    )
    const res = await repo.createOrder(order(variantId, 1))
    const full = await repo.getOrderById(res.id)
    const gift = full.items.find((i) => i.is_gift)
    expect(gift.collection_slug).toBeNull()
  })
})
```

(If `seedVariant` doesn't already return `collectionSlug`, read it via a
follow-up query on the collection row it created rather than modifying the
shared helper's return shape for every other test - check the helper's
current implementation first and adapt to match, keeping this test
self-contained.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run tests/orderRepo.test.js -t "collection_slug"`
Expected: FAIL - `collection_slug` is `undefined` on returned items.

- [ ] **Step 3: Add the join in `attachItems`**

In `backend/shop/orders/orderRepo.js`, change the `attachItems` query:

```js
async function attachItems(order) {
  if (!order) return null
  const [rows] = await db.query(
    `SELECT oi.*, pv.thumbnail_image AS variant_thumbnail, pv.image_url AS variant_image_url,
            p.images AS product_images, col.slug AS collection_slug
       FROM order_items oi
       LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
       LEFT JOIN products p ON p.id = pv.product_id
       LEFT JOIN collections col ON col.id = oi.collection_id_snapshot
      WHERE oi.order_id = ? ORDER BY oi.id ASC`,
    [order.id]
  )
  const items = rows.map(({ variant_thumbnail, variant_image_url, product_images, ...item }) => ({
    ...item,
    is_gift: Boolean(item.is_gift),
    image_url: item.image_url_snapshot || variant_thumbnail || variant_image_url || firstImage(product_images),
  }))
  return { ...order, items }
}
```

(Only the `SELECT`'s added `col.slug AS collection_slug` and the new
`LEFT JOIN collections col ...` line change - `collection_slug` rides
through in `...item` unchanged, same as every other raw column.)

- [ ] **Step 4: Run to verify the new tests pass**

Run: `cd backend && npx vitest run tests/orderRepo.test.js -t "collection_slug"`
Expected: PASS (2/2)

- [ ] **Step 5: Run the full `orderRepo.test.js` file, then the full backend suite**

Run: `cd backend && npx vitest run tests/orderRepo.test.js`
Expected: PASS - every pre-existing test still green (an added `LEFT JOIN`
column changes nothing about existing assertions, which don't check for its
absence).

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/orders/orderRepo.js backend/tests/orderRepo.test.js
git commit -m "feat(shop): expose each order item's collection_slug for reorder"
```

---

### Task 2: "Đặt lại" (Reorder) button on the buyer order page

**Files:**
- Modify: `frontend/src/pages/Order.jsx`
- Modify: `frontend/src/pages/Order.test.jsx`
- Modify: `frontend/src/i18n/translations.js`

**Interfaces:**
- Consumes: `order.items[].collection_slug` (Task 1), `addToCart` from
  `../shop/cart` (existing, unchanged).
- Produces: nothing consumed elsewhere - self-contained UI action.

- [ ] **Step 1: Add i18n keys**

In `frontend/src/i18n/translations.js`, `en` block, near `orderItems`:

```js
orderReorder: "Reorder", orderReorderedMsg: "Added {count} item(s) to your cart",
```

`vi` block, near its own `orderItems`:

```js
orderReorder: "Đặt lại", orderReorderedMsg: "Đã thêm {count} sản phẩm vào giỏ hàng",
```

- [ ] **Step 2: Write the failing tests**

Add to `frontend/src/pages/Order.test.jsx` (uses the file's existing
`baseOrder`/`renderOrder` helpers; `localStorage.clear()` already runs in
`beforeEach`, and `cart.js`/`readCart` is real, not mocked, matching how
`Cart.test.jsx` seeds carts):

```jsx
import { readCart } from "../shop/cart"

describe("Order - reorder", () => {
  it("shows a Reorder button and adds the order's real items to the cart", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [
        { id: 1, product_variant_id: 10, product_name_snapshot: "Card", variant_label_snapshot: "A1",
          unit_price_snapshot: 35000, qty: 2, image_url: "https://x/a1.png", collection_slug: "drop-1", is_gift: false },
      ],
    }))
    const container = await renderOrder()

    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Reorder")
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ variant_id: 10, qty: 2, price: 35000, collection_slug: "drop-1" })
  })

  it("excludes the free gift line from reorder", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [
        { id: 1, product_variant_id: 10, product_name_snapshot: "Card", variant_label_snapshot: "A1",
          unit_price_snapshot: 35000, qty: 1, image_url: null, collection_slug: "drop-1", is_gift: false },
        { id: 2, product_variant_id: null, product_name_snapshot: "Postcard", variant_label_snapshot: "",
          unit_price_snapshot: 0, qty: 1, image_url: null, collection_slug: null, is_gift: true },
      ],
    }))
    const container = await renderOrder()
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Reorder")
    await act(async () => { btn.click() })

    expect(readCart()).toHaveLength(1)
    expect(readCart()[0].variant_id).toBe(10)
  })

  it("does not render the Reorder button when nothing in the order is reorderable", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [
        { id: 1, product_variant_id: null, product_name_snapshot: "Postcard", variant_label_snapshot: "",
          unit_price_snapshot: 0, qty: 1, image_url: null, collection_slug: null, is_gift: true },
      ],
    }))
    const container = await renderOrder()
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Reorder")).toBeUndefined()
  })

  it("shows an inline confirmation linking to /cart after reordering", async () => {
    fetchOrder.mockResolvedValue(baseOrder({
      items: [
        { id: 1, product_variant_id: 10, product_name_snapshot: "Card", variant_label_snapshot: "A1",
          unit_price_snapshot: 35000, qty: 1, image_url: null, collection_slug: "drop-1", is_gift: false },
      ],
    }))
    const container = await renderOrder()
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Reorder")
    await act(async () => { btn.click() })

    const link = [...container.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/cart")
    expect(link).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run to verify failures**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx -t "reorder"`
Expected: FAIL - no "Reorder" button exists yet.

- [ ] **Step 4: Implement in `Order.jsx`**

Add the import (alongside the existing `import { useParams } from
"react-router-dom"` - keep both from the same package):

```js
import { useParams, Link } from "react-router-dom"
import { addToCart } from "../shop/cart"
```

Inside the component, after `order` is loaded (same place `isPending`/other
derived flags are already computed - do not compute before the `order &&
...` render guard that already exists in this file):

```js
const [reorderedCount, setReorderedCount] = useState(null)

const reorderableItems = order.items.filter(
  (i) => !i.is_gift && i.product_variant_id && i.collection_slug
)

const reorder = () => {
  for (const i of reorderableItems) {
    addToCart({
      variant_id: i.product_variant_id,
      qty: i.qty,
      product_name: i.product_name_snapshot,
      variant_label: i.variant_label_snapshot,
      price: i.unit_price_snapshot,
      image_url: i.image_url,
      collection_slug: i.collection_slug,
    })
  }
  setReorderedCount(reorderableItems.length)
  setTimeout(() => setReorderedCount(null), 4000)
}
```

Render, immediately after the existing total block
(`{t("orderTotalLabel")}` / `formatVnd(order.total)` div):

```jsx
{reorderableItems.length > 0 && (
  <div className="mt-3">
    <button
      type="button"
      onClick={reorder}
      className="px-4 py-2 rounded-lg border border-[var(--border-brand)] hover:bg-[var(--brand-soft)] text-sm font-medium"
    >
      {t("orderReorder")}
    </button>
    {reorderedCount !== null && (
      <Link to="/cart" className="ml-3 text-sm text-[var(--text-link)] underline">
        {t("orderReorderedMsg", { count: reorderedCount })}
      </Link>
    )}
  </div>
)}
```

(`t(key, vars)` interpolation already exists in `LanguageContext` - same
mechanism `shopAddedToCart`'s `{item}` placeholder already uses.)

- [ ] **Step 5: Run to verify tests pass**

Run: `cd frontend && npx vitest run src/pages/Order.test.jsx`
Expected: PASS - all pre-existing Order tests plus the 4 new ones.

- [ ] **Step 6: Run the full frontend suite + lint**

Run: `cd frontend && npx vitest run`
Expected: all pass.

Run: `cd frontend && npx eslint src/pages/Order.jsx src/pages/Order.test.jsx`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Order.jsx frontend/src/pages/Order.test.jsx frontend/src/i18n/translations.js
git commit -m "feat(shop): add one-click reorder button to the buyer order page"
```
