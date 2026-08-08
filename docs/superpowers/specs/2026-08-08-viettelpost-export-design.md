# ViettelPost Export & Shipping Handoff (Phase 5) — Design

## Context

Phases 1–4 built the merch shop and its statistics dashboard. Shipping is still
entirely manual: the seller reads each confirmed order in the admin, retypes the
buyer's name, phone and address into ViettelPost, books the shipment, then
retypes the returned tracking code back into the admin one order at a time.

The seller already has a partial workaround outside this repo, at
`/Users/phucth/vibes/vtp`: a Python script (`fill_vtp_orders.py`) that reads
Google Form responses and fills ViettelPost's official Excel template
(`VTP_mau_excel_don_hang_o.xlsx`). That workaround predates the shop and reads a
data source the shop has now replaced.

This phase moves that capability into the shop, where the data is structured.

## Purpose

Two deliverables, in this order:

1. **Shipping export** — generate ViettelPost's import spreadsheet directly from
   confirmed ship orders, then import the resulting tracking codes back.
2. **Pickup roster** — a printable list of pickup orders to take to an event,
   the offline fallback for when venue wifi fails and the QR scanner cannot load
   an order (a gap the original merch-shop spec explicitly assigned to Phase 5).

**Not in this phase:** ViettelPost API booking automation. The seller has a VTP
business account but has not confirmed whether API access is enabled. The
spreadsheet path is independently valuable and strictly better than the current
manual process, so it does not wait on that answer. See Outstanding Questions.

## The ViettelPost Template — Verified Facts

Read directly from `VTP_mau_excel_don_hang_o.xlsx`, not assumed:

- Data sheet is **`Danh sách`**. Header row is **7**. Data begins at **row 8**.
- Four reference sheets carry the valid enumerations: `Dịch vụ` (36 services),
  `Loai hang hoa` (`Bưu kiện`, `Tài liệu`), `Thời gian hẹn lấy` (11 slots), and
  `Tinh chat hang hoa`.
- Columns marked `(*)` are mandatory: **C** Tên người nhận, **D** Số ĐT,
  **E** Địa chỉ nhận, **F** Tên hàng hóa, **H** Trọng lượng (gram),
  **I** Giá trị hàng (VND), **K** Loại hàng hóa, **M** Dịch vụ.
- VTP's own example row fills **J** (Tiền thu hộ COD) with the goods value.

**Data validation is stripped on save.** openpyxl already drops the dropdown
validations when the existing script writes its output (130KB out vs 240KB
template), and those files import successfully today. ViettelPost therefore
validates on their side, so the Node writer doing the same is safe and matches
proven behaviour.

## Order Code — a Security Decision

The template's column **B (Mã đơn hàng)** is the only field that can carry an
identifier back through the round trip, so it must hold something matchable.

The shop has no human-facing order code — only `orders.id` and
`orders.order_token`. **`order_token` must never be used here.** It is a
cryptographically random bearer credential; anyone holding it can open the
buyer's order page. Writing it into a spreadsheet uploaded to a third party
would leak it.

Column B therefore carries **`DH<id>`** (e.g. `DH482`), derived from the integer
primary key. It is already the admin-facing identifier, is stable and unique,
and discloses nothing sensitive to a courier who is receiving the buyer's name,
phone and address anyway.

This also replaces the existing script's `COD 1`, `COD 2` counter, which cannot
be matched back to anything and is what makes today's tracking-code entry manual.

## Shipping Export

### Selection

An admin action lists ship orders that are `confirmed` and have **no tracking
code yet** — precisely the orders awaiting booking. The seller ticks which to
include and downloads a ready-to-import `.xlsx`.

### Per-order field mapping

| VTP column | Source |
|---|---|
| B Mã đơn hàng | `DH<orders.id>` |
| C Tên người nhận | `buyer_name` |
| D Số ĐT người nhận | `phone`, whitespace stripped |
| E Địa chỉ nhận | structured address (street, ward, district, province), falling back to `address_raw` |
| I Giá trị hàng | order `total` (merch only) |
| J Tiền thu hộ COD | `cod_amount` for COD orders; **blank** for prepaid |
| M Dịch vụ | `PHS - Nội tỉnh tiết kiệm thỏa thuận` when `address_province` is Ho Chi Minh City, otherwise `VTK - CP tiết kiệm thỏa thuận` |
| S Người trả cước | `Người gửi trả` when the order is marked freeship, else `Người nhận trả` |

Service selection uses the **structured `address_province`** field rather than
keyword-matching the whole address string as the current script does.

### Batch-level fields

Entered once per export, mirroring the existing script's prompts: **Tên hàng
hóa** (F), **Trọng lượng** (H), **Loại hàng hóa** (K), and **Thời gian hẹn lấy**
(U). Photocard weights are near-identical, so per-product weights would be real
schema work for no practical gain.

These defaults are **deliberately not persisted** between exports — a settings
table for four fields that take seconds to retype is not yet justified.

## Tracking-Code Round Trip

The seller books the batch in ViettelPost, then returns with tracking codes.

The importer accepts VTP's result file or pasted rows, reads order-code /
tracking-code pairs, and **shows a preview before writing anything**: which
orders will be updated, which codes match no order, which orders already carry a
tracking code, and which are not in a state that can ship. Nothing changes until
the seller confirms.

Because a confirmed import moves many orders to `shipped` and each transition
emails a buyer, four properties are required:

- **Idempotent.** Re-importing the same file changes nothing and re-sends no
  email. Uploading twice after a timeout is the obvious accident.
- **Per-order isolation.** One bad row cannot abort the batch — the same
  principle as the existing admin bulk-cancel endpoint.
- **Reuses `transitionOrder`.** No bypassing the order state machine. Its
  guards, transition rules and shipped-email dispatch stay in force. Nothing in
  this phase writes order status directly.
- **Never guesses a match.** An unmatched tracking code is reported, never
  applied to a nearby order.

The result screen reports **per-order outcomes with reasons** — updated, skipped,
or failed — not a blanket success message. The failure this prevents: half the
rows silently failing to match while the seller believes every buyer was
notified.

## Pickup Roster

A printable page generated per collection before an event, taken to the booth on
paper.

One row per confirmed pickup order: order code, buyer name, phone, the items
ordered (product, variant, quantity — what is physically handed over), and
**whether the order is already paid or the money is collected at handover, with
the amount**. That last distinction is the point of the document: prepaid and COD
pickup orders are indistinguishable in a queue, and confusing them means either
giving merch away or charging a buyer twice. Includes a tick column for marking
handovers.

Sorted by **buyer name** — at a booth the seller is looking a person up by name,
not by order code.

Rendered as printable HTML the seller prints from the browser, not a
server-generated PDF: no new heavy dependency on a 2GB droplet, and the seller
can print or save as PDF themselves.

## Data Model

One migration: a per-order **shipping-payer** field backing the freeship toggle,
defaulting to buyer-pays.

This replaces the current convention of typing `freeship` into the *buyer's
name*, which the existing script parses out. That hack is fragile, pollutes the
name that gets printed on the shipping label, and lets a buyer trigger free
shipping by typing a word into their own name field.

No other schema change. Everything else the export needs — name, phone,
structured address, `total`, `cod_amount`, `note`, `tracking_code` — already
exists.

## Architecture

Following Phase 4's shape, with pure logic separated from I/O:

- **`backend/shop/shipping/vtpMapping.js`** — pure functions mapping an order to
  its VTP row values (service selection, COD, payer, address assembly). No Excel,
  no database. This is where the rules that can be silently wrong live, so it is
  exhaustively testable in isolation — the same reasoning that split `money.js`
  out in Phase 4.
- **`backend/shop/shipping/vtpWorkbook.js`** — loads the bundled template with
  `exceljs`, fills rows from row 8, returns a buffer. The template ships in the
  repo so exports do not depend on a file outside it.
- **`backend/shop/shipping/trackingImport.js`** — parses uploaded/pasted
  tracking pairs and resolves them to orders; pure given its input.
- **`backend/shop/shipping/roster.js`** — assembles pickup-roster data.
- **`backend/routes/adminShipping.js`** — routes behind the existing `auth`
  middleware, matching every other admin router.
- **Frontend** — an export view, a tracking-import view with its preview step,
  and a print-oriented roster view, under `frontend/src/components/shipping/`.

Admin UI is hardcoded Vietnamese, matching the established convention.

## Edge Cases

- **Missing address components.** A ship order may have only `address_raw`
  (autocomplete skipped). Column E falls back to it; an order with no usable
  address at all is excluded from the export and reported, never exported blank —
  a blank address column is a shipment that cannot be delivered.
- **Province not recognised.** If `address_province` is empty or unrecognised,
  service selection defaults to the inter-province service (`VTK`), the safe
  choice: a wrongly-inter-province shipment costs more, a wrongly-intra-province
  one fails.
- **COD with a null `cod_amount`.** Reported as an error rather than exported
  with a blank J — a COD shipment that collects nothing is money lost.
- **Duplicate tracking codes** in one import file are rejected.
- **An order already shipped** is skipped by the importer with a reason, not
  re-transitioned.
- **Empty selection / no eligible orders** renders an explicit empty state.
- **Vietnamese diacritics** must survive the round trip through xlsx unaltered.

## Testing

- **Mapping**: every branch of service selection, COD/prepaid J handling, payer
  selection, and address fallback, asserted against hand-computed expected rows.
- **Workbook**: generated file opens, has sheet `Danh sách`, data begins at row
  8, required columns are populated, and diacritics survive.
- **Tracking import**: idempotent re-import changes nothing and re-sends no
  email; unmatched codes reported not applied; per-order isolation on a bad row;
  already-shipped orders skipped; the preview matches what confirming actually
  does.
- **Roster**: paid vs collect-at-handover is correct per order, items listed
  accurately, sorted by name.
- **Security**: `order_token` appears in no exported artifact.

Backend tests use Vitest 3 ESM imports; implementation files stay CommonJS.

## Out of Scope

- ViettelPost API booking automation (see below)
- Label printing, rate quoting, pickup scheduling via API
- Multi-carrier support
- Phase 6 (buyer onboarding guide)

## Outstanding Questions

Both raised by the seller and deliberately deferred:

1. **Recheck the full VTP field mapping once the phase is complete**, against a
   real import into ViettelPost. The mapping here is derived from a verified
   template and a working script, but only a real import proves it.
2. **API integration remains open.** The seller has a VTP business account but
   has not confirmed API access. To check: attempt login at
   `partner.viettelpost.vn` (the v2 API authenticates with portal credentials),
   look for *Tích hợp / Kết nối API* in the business portal, or ask the account
   manager. If available, API booking would replace the manual
   export-book-import loop — the mapping module built here is the same logic an
   API integration would need, so this phase is not wasted work either way.
