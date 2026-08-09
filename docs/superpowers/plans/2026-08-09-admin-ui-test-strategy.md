# Admin UI & Semantic Colour — Test Strategy

Covers `2026-08-09-admin-ui.md` only. Builds on, and does not repeat, the philosophy and conventions of `2026-08-07-merch-shop-test-strategy.md` (Plans 1–3), `2026-08-08-merch-shop-4-test-strategy.md` (Plan 4), `2026-08-08-merch-shop-5-test-strategy.md` (Plan 5), and `2026-08-09-merch-shop-6-test-strategy.md` (Plan 6) — read those first for the risk-weighting approach and regression-suite conventions this document assumes.

This phase is presentation-only and frontend-only: seven tasks, no new backend route, no query, no money rule, no shipping logic. Its worst outcome is not a lost parcel or a miscomputed total — it is a seller trusting a button that looks safe when it is not, or a statistics figure silently changing while the spec calls this "emphasis only."

---

## 1. Risk register

| # | Risk | Consequence | Severity | Primary defense |
|---|---|---|---|---|
| R1 | A destructive action (cancel) and a confirm-type action (confirm/ship/complete) render with the same or a visually indistinguishable style | Seller clicks cancel believing it is as safe as any other button — an irreversible, stock-releasing, buyer-emailing action (`TRANSITIONS.cancelled` is empty, there is no undo) — because nothing on screen told them otherwise. This is the exact defect the spec was written to remove | **High** | Task 5: `ACTION_BUTTON_CLASSES` gives cancel `danger` and confirm-type actions `success`, two different class strings; a dedicated test asserts `cancelBtn.className !== shippedBtn.className`, explicitly designed to fail if the two ever converge again (blocking) |
| R2 | A statistics figure's value, source field, or presence changes while the spec calls this "emphasis only" | The seller makes a business decision (how much cash they've actually received) off a number that quietly stopped matching Phase 4's verified arithmetic — the worst possible regression for a page whose entire purpose is trustworthy numbers | **High** | Task 6: the emphasis restyle touches only className strings around the five existing `formatVnd(stats.*)` reads — no field name, computation, or `stats.*` access changes; a dedicated test asserts all five values still render with their pre-change VND-formatted text (blocking) |
| R3 | A component references a CSS custom property that doesn't exist in `index.css`, and it renders unstyled (invisible border, transparent text, no distinguishing colour) | This project has shipped this exact class of defect twice already; here it would silently defeat the entire point of the phase — a badge or button that's supposed to carry meaning renders as nothing | **High** | Task 1's `semanticTokens.test.js` asserts all 12 new tokens exist in both `:root` and `.dark` *before* any other task may reference them; Tasks 3, 5, 6, 7's component tests each assert the literal `var(--token-name)` substring appears in the rendered `className`, which fails immediately if a task typos or invents a name (blocking) |
| R4 | `variantForStatus`/`variantForAction`/`labelFor` throw, return `undefined`, or render blank for a status/enum value none of the maps recognize | An order in a future or unexpected status renders with no colour, no text, or a crash — worse than the raw-enum baseline this phase replaces, and it directly violates the spec's explicit error-handling rule ("an unknown status must fall back to the raw value, never render blank") | Medium | `variantForStatus`/`variantForAction` (Task 2) and `labelFor` (Task 4) all fall back to `"neutral"` / the raw key respectively, never `undefined`; `StatusBadge` (Task 3) additionally falls back to the neutral class set for any variant string it doesn't recognize — three independent layers of the same guarantee, each with its own unit test |
| R5 | `AdminOrders.jsx`'s actionable-first sort hides, drops, or duplicates an order while reordering | A seller loses visibility of an order entirely, or sees it twice, because a sort comparator has a bug — worse than the flat unsorted list it replaces | Medium | `byActionableFirst` is a plain stable-sort comparator over a shallow copy (`[...orders].sort(...)`, never mutating `orders` itself); a dedicated test asserts both orders are still present and in the expected relative order, not just that "an order with actions" appears somewhere |
| R6 | The admin panel gains a bilingual i18n key by mistake, or the shop starts reading `admin/orderLabels.js`'s hardcoded Vietnamese | Breaks the project's established language boundary — admin hardcoded Vietnamese, shop bilingual via `LanguageContext` — silently, in a way that would only surface when someone switches the shop to English and sees Vietnamese leak through | Medium | `admin/orderLabels.js` lives under `frontend/src/admin/` and is imported only by `AdminOrders.jsx` and `StatsDrop.jsx` (both admin components); `Order.jsx` (shop) uses only `variantForStatus` (colour, language-neutral, from `constants/statusVariant.js`) and its own existing `t()`/`STATUS_KEY` — never `orderLabels.js`. Verification item F1 greps for any shop-side import of the admin module |
| R7 | The new `StatusBadge` component or the restyled `PaymentInstructions` container breaks 375px layout (horizontal scroll, badge/text overlap) | Seller or buyer on a phone — the majority of this shop's traffic per Plans 1–4's precedent — hits a broken page at the admin's or shop's busiest moment | Medium | `StatusBadge` is `inline-block` with `whitespace-nowrap` sized to its own text, no fixed width; the new admin badge row uses `flex-wrap`; manual 375px check is verification item G1/G2 (blocking within its own section — NOT VERIFIABLE without a browser) |
| R8 | A task in this plan touches a backend file, a route, or a repo function, even incidentally (e.g. "just tightening a type" while in the area) | Violates the phase's stated scope boundary outright; the spec calls this out explicitly: "If a diff in this work touches a repo, a route, or a backend module, something has gone wrong" | High (but structurally prevented) | No task's file list includes any `backend/` path; Task 7 Step 7 runs the backend suite once specifically to prove the pre-existing pass count is unchanged; verification item A5 diffs the full file list against the plan's own list |

R1, R2, and R3 are called out as **blocking** — R1 and R2 because they are this phase's two named worst-case outcomes (a wrong-click and a misleading number), R3 because this project has already shipped it twice. Everything else gets coverage proportional to severity.

---

## 2. Test levels

### L1 — Unit

Pure logic and pure string/DOM assertions, no backend I/O.

**Scope:**
- `frontend/src/utils/semanticTokens.test.js` — all 12 tokens present in both `:root` and `.dark`; success/warning aliases do not reference `--brand`.
- `frontend/src/constants/statusVariant.test.js` — every status/action enum value maps to its documented variant; unknown input falls back to `"neutral"` for both functions; `null`/`undefined` input does not throw.
- `frontend/src/admin/orderLabels.test.js` — all four label maps match their documented Vietnamese values exactly; `labelFor` returns the mapped label for a known key and the raw key for an unknown one.

### L2 — Component

`react-dom`'s `createRoot`/`act` (this codebase's established pattern — no Testing Library, matching `AdminOrders.test.jsx`, `StatsDrop.test.jsx`, `Order.test.jsx`).

**Scope:**
- `StatusBadge.test.jsx` — renders the label verbatim; each of the four variants (plus an unrecognized one, plus the default) produces the class string containing exactly its three matching token names.
- `AdminOrders.test.jsx` — status/payment/fulfilment render as Vietnamese-labelled badges/text, not raw enums; cancel renders with danger styling and label "Hủy"; a confirm-type action renders with success styling; the two never share a class string; "Chi tiết" stays neutral; the existing `confirm()` guard before cancelling still fires; an order with a pending action sorts above one with none, with neither order dropped; an unknown status still renders its raw value.
- `StatsDrop.test.jsx` — all five money figures still render their pre-change values; the received figure's element carries a distinguishing size class (`text-3xl`) the other four do not.
- `Order.test.jsx` — the buyer's status renders as a badge with the variant matching its status (warning/success/danger); an unrecognized status still falls through to raw text via the pre-existing `STATUS_KEY`/`t()` fallback, now inside the badge.

### L3 — Non-functional

| Area | Method |
|---|---|
| **CSS-token integrity** | R3's layered defense (§1) — this is the phase's most structurally important non-functional property, since it's the one class of bug this project has shipped twice. Every component test that touches a new token asserts on the literal `var(--name)` substring, not just "has some border class." |
| **Language boundary (admin VN / shop i18n)** | Verification item F1 (manual grep, no runtime check exists for this — it's a static import-graph property). |
| **Layout at 375px** | Manual only — verification items G1/G2, explicitly marked NOT VERIFIABLE without a browser. |
| **No backend touched** | Task 7 Step 7's backend suite run (count must be unchanged) plus verification item A5 (file-list diff). |

There is no L4 (end-to-end/acceptance) beyond the manual verification checklist — this phase changes only rendering, not data flow, so there is no new round-trip journey to script beyond what the checklist's manual sections already cover.

---

## 3. What this plan must prove before shipping

- **The destructive-vs-confirm visual distinction is real, not cosmetic-by-coincidence.** The test explicitly compares the two class strings, not just "cancel has a red-ish word in its class somewhere" — a future edit that moves both back onto the same class string fails this test immediately.
- **Every statistics figure is present with its pre-change value.** Not "the received figure looks bigger" alone — all five values, read from the same `stats.*` fields as before.
- **Every semantic token a component references exists**, in both light and dark, before that component's own task is written. Task 1 is a hard prerequisite gate for Tasks 3, 5, 6, 7.
- **An unknown status/payment/fulfilment/action value never renders blank.** Three independent fallbacks (`variantForStatus`/`variantForAction` → `"neutral"`, `labelFor` → raw key, `StatusBadge` → neutral class set) each have their own test, and `AdminOrders.test.jsx`/`Order.test.jsx` each have one end-to-end-within-the-component test proving the fallback survives real rendering, not just the unit level.
- **The admin/shop language boundary holds.** No new i18n key was added for an admin string; `orderLabels.js` is imported only from `frontend/src/admin/`-adjacent admin components.
- **No backend file changed.** Proven by an actual backend suite run at the end of the phase, not by inspection alone.

---

## 4. The highest-value tests — blocking

### 4.1 The destructive-vs-confirm distinction (`AdminOrders.test.jsx`)

Two assertions carry this: one confirms cancel gets `var(--border-danger)`, one confirms a confirm-type action gets `var(--border-success)`, and a third directly compares `cancelBtn.className !== shippedBtn.className`. The third is the one that matters most — the first two would both still pass if some future edit accidentally gave both buttons `danger` styling; only the direct inequality check catches that regression, which is exactly the shape of defect the spec describes as already having happened once (`AdminOrders.jsx:254`'s single shared class string).

**Any failure here is a Blocker per §6.**

### 4.2 Statistics values unchanged (`StatsDrop.test.jsx`)

Asserts all five `formatVnd(...)` outputs are present in the rendered text after the emphasis restyle, using the same field names (`received_total`, `awaiting_payment`, `to_collect`, `lost`, `pending_cod`) the pre-existing test already reads. A future edit that (for example) folds "lost" into "to collect" for visual tidiness, or silently drops a card, fails this test immediately rather than being caught only by a human noticing a missing number days later.

**Any failure here is a Blocker per §6.**

### 4.3 Token existence (`semanticTokens.test.js`)

Runs first, gates everything else. If a task's own component test passes but references a token this test doesn't cover, that is itself a defect in the plan's ordering — the component test's `toContain("var(--border-success)")` assertion would pass in jsdom even if `--border-success` doesn't exist anywhere in `index.css`, because jsdom does not resolve CSS custom properties; only `semanticTokens.test.js`'s direct file read catches an invented name.

**Any failure here is a Blocker per §6.**

---

## 5. Test data

- Admin component tests reuse `AdminOrders.test.jsx`'s existing `order()` fixture and `renderAdminOrders()` helper, overriding only `status`, `allowed_transitions`, `payment_method`, `fulfillment_method` per test — no new fixture infrastructure.
- `StatsDrop.test.jsx` reuses its existing `dropStats()` fixture, overriding only the five money fields under test.
- `Order.test.jsx` reuses its existing `mockOrder()`/render helpers (and, if the buyer-onboarding phase has landed on this branch, its `futureIso`/`pastIso` helpers), overriding only `status`.
- `orderLabels.test.js` and `statusVariant.test.js` assert against literal expected objects (`toEqual({...})`) rather than partial matches, so a silently-added or silently-removed enum entry fails the test rather than passing by omission.

---

## 6. Entry and exit criteria

**A task is done when:** its own tests pass, the full frontend suite (`npm test && npm run build && npm run lint`) passes with no new lint problems beyond the 3 pre-existing ones, and it is committed.

**The plan is done when:**
- All seven tasks are done, in order (Task 1 is a hard prerequisite for Tasks 3, 5, 6, 7; Task 2 is a hard prerequisite for Tasks 3, 5, 7; Task 4 is a hard prerequisite for Task 5).
- §4.1, §4.2, and §4.3 all pass, with no accepted-failure exception for any.
- The acceptance checklist (`2026-08-09-admin-ui-verification.md`) is fully PASS, or every open item has a recorded accept/reject decision — including items that explicitly cannot be verified without a browser.
- No High-severity risk from §1 (R1, R2, R3) is unmitigated.
- Task 7's one-time backend suite run confirms the backend's pre-existing pass count is unchanged and no `backend/` file appears in the diff.

---

## 7. Defect handling

Same severity table as prior phases (`Blocker` / `Major` / `Minor`). For this phase specifically: any failure of §4.1, §4.2, or §4.3 is a **Blocker**. A missing fallback for an unknown status/enum value anywhere in the chain (R4), a broken admin/shop language boundary (R6), or a sort that drops/duplicates an order (R5) is **Major**. A 375px wrapping/spacing issue that doesn't cause horizontal scroll or hide information is **Minor**.

Every Blocker and Major gets a regression test before the fix is considered complete.

## Regression suite

```bash
cd frontend && npm test && npm run build && npm run lint
cd backend  && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test    # run once, Task 7 Step 7 — proves no backend file changed
```

`npm run lint` carries 3 known pre-existing problems (`Portfolio.jsx` x2, `AdminAlbumImages.jsx` x1) from earlier phases. No task in this plan may introduce a fourth without fixing it before its own commit.

Expected new frontend test counts by task: Task 1 (25), Task 2 (11), Task 3 (6), Task 4 (9), Task 5 (9), Task 6 (3), Task 7 (4) — 67 new tests, frontend total 134 → 201. Backend total unchanged at 586.
