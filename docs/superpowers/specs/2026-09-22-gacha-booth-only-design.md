# Gacha booth-only products — design

## 1. Problem

An admin can already sell a gacha product two ways: online (buyer draws turns on their own
order page, prizes ship) and at the booth (staff runs the kiosk, cash paid in person). Today
every gacha product is sellable both ways with no way to opt out of one. A seller who wants a
product exclusively for in-person festival sales — a scarcer, higher-value case reserved for
walk-up traffic, say — has no way to keep it off the online shop; it's automatically listed
and orderable there the moment it's created.

## 2. Goal

Let an admin mark a gacha product "booth-only": it disappears from the public storefront and
can never be bought through the normal online checkout flow, while remaining fully usable at
the booth kiosk (and, deliberately, still reachable via the free practice page - see §5).

## 3. Non-goals

- No change to booth-cash purchasing, the kiosk, the admin prize editor, or practice mode.
- No retroactive effect on sessions/orders that already exist. Flipping this flag on never
  strands a buyer mid-session or invalidates a placed order.
- No collection-level version of this flag. It's a per-product toggle, matching how the
  request is scoped ("if I create *a product* only for kiosk booth gacha").

## 4. Data model

Add one column to `products`, in the existing `040_add_product_type_gacha.js` migration
(edited in place, per project convention for this not-yet-deployed feature — no new migration
file):

```js
table.boolean("gacha_booth_only").notNullable().defaultTo(false)
```

Meaningful only when `type = 'gacha'`, same convention as `delivery_link` only mattering for
`type = 'digital'` — no CHECK constraint enforcing that pairing, consistent with how the rest
of the schema handles type-conditional columns.

## 5. Enforcement — two independent layers

**Layer 1 — hidden from the public storefront.** The public collection-read path in
`backend/shop/catalogRepo.js` (the function `GET /api/shop/collections/:slug` calls to build
its `products` array) excludes any row where `type = 'gacha' AND gacha_booth_only = true`.
Admin-facing reads (product editor list, prize editor, kiosk's own prize fetch) are separate
queries that were never scoped to public visibility, so they need no change and keep showing
every gacha product regardless of this flag.

The free practice page (`GET /api/shop/gacha/:productId/practice`,
`POST /api/shop/gacha/:productId/practice-draw`) is **deliberately left unfiltered** — per the
approved design discussion, practice is structurally incapable of touching money or stock
(`practiceDraw` has no transaction and no write statement at all), so a booth-only product's
practice page staying reachable by direct URL is a harmless preview, not a purchase path worth
blocking. Nothing in this feature touches those two routes.

**Layer 2 — `createOrder` rejects it too, not just relies on it being unlisted.** Hidden from
the UI is never treated as a security boundary on its own in this codebase (the same reasoning
already governs collection scheduling and stock checks) — a buyer with an old bookmarked link,
a leaked variant id, or a scripted request could otherwise still buy turns for a product the
UI never shows them. `backend/shop/orders/orderRepo.js`'s `createOrder` gains a check, alongside its existing
gacha guards (`MixedGachaCartError`, `NoCodForGachaError`, `GachaPoolSoldOutError`): if any
line item's product is `type = 'gacha' AND gacha_booth_only`, throw the **existing
`VariantNotFoundError`** (not a new error class) — the same one already thrown when a
variant_id matches no row at all. This is deliberate, not a shortcut: reusing it means the
route layer needs zero new branches (it already maps `VariantNotFoundError` to
`409 variant_not_found`, `"...không còn tồn tại..."`, with `variant_ids` so the frontend
auto-drops the stale cart line), and a booth-only product is genuinely indistinguishable from
a nonexistent one to an online buyer, which is exactly the non-enumerable behavior wanted -
no new message, no new error code, nothing that could tell a prober "this id exists but is
booth-only" versus "this id never existed."

This check runs inside the same transaction and at the same point in `createOrder` as the
existing gacha guards (right after the product/variant rows are locked and their `type` is
known), so it's zero extra queries — just one more condition on data already fetched.

## 6. Never retroactive

- Flipping `gacha_booth_only` on for a product with existing online orders/sessions has zero
  effect on those - `drawForSession` never looks at this column at all. A buyer mid-session
  keeps drawing normally to completion.
- Flipping it off later simply makes the product orderable online again going forward; no
  backfill, no migration of past behavior needed.

## 7. Admin UI

One checkbox in the product editor, shown only when the product's type is `gacha`:
**"Chỉ bán tại quầy (ẩn khỏi shop online)"** ("Booth-only (hidden from the online shop)").
Wired exactly like every other product field already saved via `adminUpdateProduct`/
`adminCreateProduct` - no new endpoint, no new page.

## 8. Testing

- **Backend:** `catalogRepo` public-read test asserting a booth-only gacha product is absent
  from a collection's `products` array, while an ordinary gacha product in the same collection
  still appears. `orderRepo.createOrder` test asserting `VariantNotFoundError` for a
  booth-only product's variant, and that the *same* product is still purchasable once the
  flag is turned back off. A test confirming an already-active session for a product later flipped
  booth-only keeps drawing successfully (the "never retroactive" invariant).
- **Frontend:** admin product editor test that the checkbox only renders for `type: 'gacha'`
  and round-trips through save/reload.

## 9. Documentation follow-up

`docs/GACHA_ANTI_CHEAT.md` should gain a short new bullet once this ships, alongside its
existing "can't get more turns than were paid for" section: `createOrder` also refuses a
booth-only product's variant (reusing `VariantNotFoundError`, never a distinguishing message).
Not a new anti-cheat *category* - the file's existing invariants (prize-decision integrity,
session ownership, rate limits) are entirely unaffected, since no route shapes or the actual
draw logic change here.

## 10. Open questions / risks

None identified — this is a narrow, additive feature with no schema migration risk (a single
boolean column with a safe default) and no interaction with money, stock accounting, or the
draw/session logic itself.
