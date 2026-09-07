# Merch Shop - Test Strategy

Covers all three implementation plans (catalog → checkout/orders → payments/email/QR). Defines what is tested at each level, with what tooling, and what must pass before shipping.

This is an e-commerce feature handling real money, real stock, and real personal data for a solo seller with no operations team to catch mistakes. Testing is weighted by consequence, not spread evenly: a broken layout is embarrassing, a double-sold limited photocard or a falsely-confirmed payment costs money and trust.

---

## 1. Risk register

Test effort is allocated against these. Anything rated High gets coverage at multiple levels.

| # | Risk | Consequence | Severity | Primary defense |
|---|---|---|---|---|
| R1 | Overselling a limited variant | Two buyers paid for one item; refund + apology | **High** | Unit + integration + concurrency tests on reservation |
| R2 | Stock lost or corrupted on a failed write | Seller's inventory silently wrong | **High** | Transaction tests, partial-failure injection |
| R3 | Wrong price shown or charged | Financial loss or buyer dispute | **High** | Unit (money) + cache invalidation + acceptance |
| R4 | Duplicate order from double-submit | Double reservation, double payment | **High** | Idempotency tests (Plan 2) |
| R5 | Payment falsely marked confirmed | Merch shipped unpaid | **High** | Webhook signature + state-machine tests (Plan 3) |
| R6 | Order lost after buyer paid | Buyer paid, no record | **High** | Transaction + backup restore drill |
| R7 | Buyer PII exposed | Privacy breach, legal exposure | **High** | Token entropy, authz tests, noindex check |
| R8 | Reservation griefing exhausts a drop | Launch ruined | Medium | Rate-limit tests |
| R9 | Email not delivered | Buyer never gets confirmation | Medium | Async/retry tests, deliverability check |
| R10 | XSS via seller markdown | Session/credential theft | Medium | Sanitizer unit tests with attack vectors |
| R11 | Stale cache serves wrong catalog | Buyer acts on wrong data | Medium | Invalidation tests per mutation |
| R12 | Layout broken on mobile | Lost sales | Low | Acceptance checks |

---

## 2. Test levels

### L1 - Unit

Pure logic, no I/O, no database. Fast enough to run on every save.

**Tooling:** Vitest (backend, `backend/tests/*.test.js`); Vitest + jsdom (frontend, `frontend/src/**/*.test.js`).

**Scope:**
- `slugify` / `uniqueSlug` - diacritics, `đ`, punctuation, collisions, empty fallback
- `formatVnd` - grouping, zero, large values, non-numeric input
- `renderMarkdown` - formatting **and** XSS vectors (see §5)
- Validators - price, stock, labels, status, fulfillment, email, phone, address
- Order total computation (Plan 2) - sum of `unit_price_snapshot × qty`, integer-only
- Stock state derivation - `null`/`0`/`n` → available/sold-out/remaining
- Order state machine (Plan 2) - legal and illegal transitions
- QR payload construction (Plan 3)
- Webhook signature verification (Plan 3) - valid, tampered, replayed, missing

**Rule:** every branch of money and stock logic has a test. These functions are small and cheap to cover exhaustively; there is no excuse for a gap.

### L2 - Integration

A module against its real dependency. Slower, still automated.

**Tooling:** Vitest against a dedicated `cosplay_test` MySQL schema and Redis DB 15, both isolated from dev data by `DB_NAME` / `REDIS_DB` pinned in the `npm test` script.

**Scope:**
- `catalogRepo` ↔ MySQL - CRUD, cascade deletes, `NULL` stock preservation, slug collision retry, `replaceVariants` transaction and rollback
- `catalogCache` ↔ Redis - hit/miss, TTL, invalidation, no caching of misses
- `orderRepo` ↔ MySQL (Plan 2) - reservation under `SELECT ... FOR UPDATE`, release on cancel/expiry
- `storage` ↔ MinIO - upload, retrieve, proxy URL shape
- Email dispatch ↔ SMTP (Plan 3) - against a local capture server, never a real inbox
- Migrations - `up` produces the expected schema; `down` rolls back cleanly

### L3 - Module / component

A unit's public interface with its collaborators stubbed.

**Tooling:** Vitest + jsdom + Testing Library (frontend); Vitest with `vi.mock` (backend).

**Scope:**
- `ProductCard` - renders price, struck-through sold-out variants, no stock number for unlimited
- Cart state module (Plan 2) - add/remove/quantity, localStorage persistence, corrupt-data recovery
- Checkout form (Plan 2) - validation, conditional address for ship vs pickup
- Admin variant editor - bulk paste expansion, blank → `null`
- Upload route with `storage` mocked - no real MinIO needed

### L4 - API contract

The HTTP surface as consumers see it.

**Tooling:** Supertest against the exported Express `app`.

**Scope:** status codes; the `{error, message}` shape on every failure path; auth required on every admin route and absent on public ones; public endpoints never leak draft/archived data or PII; rate limiting returns `429`; large bodies accepted on upload paths only.

### L5 - End-to-end

Full stack through a browser, exercising real user journeys.

**Tooling:** manual, scripted by the per-plan verification checklists. Automated browser E2E (Playwright) is **deliberately out of scope** - it is a heavy dependency for a solo-maintained project, and the critical paths are already covered at L1–L4 plus scripted manual acceptance. Revisit if regressions start slipping through.

**Journeys:**
1. Browse → cart → checkout → order page → email received (Plan 2–3)
2. Admin confirms payment → buyer notified → shipped with tracking (Plan 3)
3. COD order → admin approves → completed at handover (Plan 2–3)
4. Pickup order → QR scanned at booth → completed (Plan 3)
5. Reservation expires → stock returns → buyer notified (Plan 2)

### L6 - Acceptance

Human verification against the built feature. One checklist per plan:
- `2026-08-07-merch-shop-1-verification.md` (catalog) - written
- Plan 2 verification - to be written with Plan 2
- Plan 3 verification - to be written with Plan 3

Exit criterion: every item PASS, or a recorded decision to accept a specific failure.

### L7 - Non-functional

| Area | Method |
|---|---|
| **Concurrency** | Scripted parallel requests for the last unit of stock (§4) |
| **Security** | Authz probes, XSS vectors, SQL-injection probes, token entropy, signature tampering |
| **Resilience** | Kill MySQL / Redis / MinIO mid-operation; verify clean errors and no data loss |
| **Data integrity** | Orphan-row queries after cascades; backup restore drill |
| **Performance** | Catalog page load with 50 products × 40 variants; confirm no N+1 |
| **Resource fit** | Container memory under load stays within the 2GB budget |

---

## 3. What each plan must prove

| Plan | Must be proven before moving on |
|---|---|
| **1 - Catalog** | Price is integer VND end to end; the three stock states never conflate; status visibility matrix holds; cache invalidates on every mutation; variant saves are atomic; markdown cannot inject script |
| **2 - Orders** | Stock cannot oversell under concurrency; reservation releases exactly once on cancel and on expiry; double-submit creates one order; order totals match cart totals exactly; order tokens are unguessable; COD orders never expire |
| **3 - Payments** | A payment cannot be confirmed without valid proof or a verified webhook; a replayed or tampered webhook is rejected; email failure never rolls back a committed order; QR resolves to the correct order; backups restore to a working state |

---

## 4. Concurrency testing (R1, R4)

The single most important test in the whole feature. Reservation correctness cannot be established by reading code.

**Setup:** one variant with `stock_qty = 1`.

**Test A - last unit race.** Fire 20 concurrent checkout requests for that variant.
Expected: exactly **1** order created, 19 rejected with an out-of-stock error; final `stock_qty = 0`. Any result where two orders exist, or stock goes negative, is a **blocking** failure.

**Test B - idempotent double-submit.** Fire the same request key twice concurrently.
Expected: one order; the second returns the same order rather than creating another.

**Test C - release correctness.** Cancel a reserved order twice concurrently.
Expected: stock increases by exactly the reserved quantity, once - never twice.

**Test D - expiry vs manual cancel.** Trigger the expiry sweep at the same moment an admin cancels the same order.
Expected: stock returns exactly once; the order ends in a single terminal state.

These run as automated integration tests (`Promise.all` against the real test DB), not manual checks - a race that reproduces once in twenty runs must be run hundreds of times.

---

## 5. Security test vectors

**XSS** - every one must render inert, in collection descriptions, product descriptions, and any admin-authored field:
```
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
[click](javascript:alert(1))
<iframe src="https://evil.example"></iframe>
<a href="data:text/html,<script>alert(1)</script>">x</a>
```

**SQL injection** - into every text input, confirming literal storage and intact schema:
```
'; DROP TABLE products; --
' OR '1'='1
\'; UPDATE products SET price=0; --
```

**Authorization** - for every admin endpoint: no token → `401`; malformed token → `403`; expired token → `403`; token signed with the wrong secret → `403`.

**Order token (Plan 2–3)** - generated with `crypto.randomBytes`, at least 128 bits of entropy, no sequential component; 1000 generated tokens contain no duplicates and no visible pattern; order pages carry `noindex`.

**Webhook (Plan 3)** - valid signature accepted; tampered body rejected; wrong secret rejected; missing signature rejected; replayed payload does not double-confirm.

---

## 6. Test data

- **Automated tests** truncate `product_variants`, `products`, `collections` (and later order tables) before **every** test, and flush Redis DB 15. No test depends on another's leftovers.
- **Factories** (`backend/tests/helpers/factories.js`) build valid entities with overridable fields, so tests state only what they care about.
- **Realistic fixtures** mirror the actual Google Form data: a 40-variant photocard sheet, A4/A5 posters, a t-shirt with S/M/L, prices in the 35.000₫–350.000₫ range, Vietnamese names and addresses with full diacritics.
- **Never** use production data in tests, and never point the suite at the production database - the global setup refuses to run against any schema other than `cosplay_test`.

---

## 7. Environments

| Environment | Purpose | Data |
|---|---|---|
| Local dev | Development, L1–L4 | Disposable |
| Local test | Automated suite | `cosplay_test`, Redis DB 15, wiped constantly |
| Production | Live | Real; nightly `mysqldump`, 14-day retention |

There is deliberately no staging environment - a second full stack does not fit the 2GB box. Acceptance testing therefore runs locally against a production-like Docker stack before deploy, and the backup restore drill (§8) substitutes for the confidence a staging rehearsal would give.

---

## 8. Backup restore drill (R6)

Backups that have never been restored are not backups. After Plan 3 implements the nightly dump, and quarterly thereafter:

1. Take a dump.
2. Restore it into a scratch database.
3. Confirm order counts, totals, and stock match the source.
4. Record the wall-clock restore time.

---

## 9. Regression suite

Everything at L1–L4 runs on every change:

```bash
cd backend  && npm test
cd frontend && npm test && npm run build && npm run lint
```

The full acceptance checklist for a plan re-runs when that plan's code is touched. Every production bug gets a failing regression test written **before** it is fixed, so it cannot silently return.

---

## 10. Entry and exit criteria

**A task is done when:** its tests pass, the full suite passes, and it is committed.

**A plan is done when:** all tasks are done, the full suite passes, its acceptance checklist is fully PASS, and no High-severity risk from §1 is unmitigated.

**The feature ships when:** all three plans are done; the concurrency suite (§4) has run repeatedly without a single oversell; the security vectors (§5) all render inert; the restore drill (§8) has succeeded; and the resource fit has been confirmed on the real 2GB droplet.

---

## 11. Defect handling

| Severity | Definition | Action |
|---|---|---|
| **Blocker** | Money wrong, stock oversold, order lost, PII exposed, payment falsely confirmed | Stop. Fix before any further work. |
| **Major** | Feature broken with no workaround | Fix before the plan is marked done |
| **Minor** | Cosmetic, or a workaround exists | Record; fix when convenient |

Every Blocker and Major gets a regression test. A fix without one is incomplete.
