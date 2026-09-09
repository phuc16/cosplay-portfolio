# Merch Shop - Plan 5: ViettelPost Export & Shipping Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seller's manual ViettelPost data entry with a "Vận chuyển" admin tab: select confirmed ship orders and download a ready-to-import VTP spreadsheet, paste or upload VTP's result file to bulk-apply tracking codes (with a mandatory preview step), and print a pickup roster for in-person collection events.

**Architecture:** Pure mapping logic (`vtpMapping.js`) - order code, address assembly, service selection, COD/payer resolution - is isolated from all I/O and exhaustively tested, mirroring Plan 4's `money.js` split: this is the file where a silently-wrong shipment or a silently-wrong COD amount would originate, so it is the single highest-value test target in the phase. `vtpWorkbook.js` is the only file that touches `exceljs`, loading a bundled copy of ViettelPost's own template and filling it from row 8. `trackingImport.js` parses and resolves tracking pairs against already-fetched order rows without doing any I/O itself - the route layer does the fetching and the `exceljs`/upload parsing, keeping the resolution logic (idempotency, unmatched codes, already-shipped skip) unit-testable in isolation. `roster.js` shapes already-fetched order+item rows into the printable pickup list. All writes to order status flow through the existing `transitionOrder()` - nothing in this phase bypasses the order state machine.

**Tech Stack:** As Plans 1–4, plus `exceljs` (new backend dependency) for reading/writing `.xlsx`. No PDF library - the pickup roster is browser-printed HTML.

**Depends on:** Plans 1–4 complete, `feature/order` branch, HEAD includes commit `b5b5a57` (Plan 4's drop-view component, the last Plan 4 commit).

**Spec:** `docs/superpowers/specs/2026-08-08-viettelpost-export-design.md` - read it before touching this plan; the Template - Verified Facts, Order Code - a Security Decision, and Edge Cases sections are the source of truth for every branch below.

## Global Constraints

- **Backend implementation files are CommonJS** (`module.exports` / `require`). **Test files are Vitest 3 ESM** (`import { describe, it, expect } from "vitest"`, `import x from "../y.js"` with the `.js` extension even though `y.js` is CommonJS). Vitest 3 refuses `require("vitest")` inside a test file.
- **Queries use the raw `mysql2` pool via `backend/db.js`** (`db.query(sql, params)` resolving to `[rows]`/`[rows, fields]` for a plain query, `[result]` with `.insertId`/`.affectedRows` for a write). **Knex is used only for migrations.**
- **Admin routes live in `backend/routes/`, exported as a router-factory function** and mounted behind the existing `auth` middleware, matching the exact line used for every other admin router: `app.use(\`${API_PREFIX}/admin\`, auth, require("./routes/adminShipping")())`.
- **The admin panel is hardcoded Vietnamese.** It has never used `frontend/src/i18n/translations.js`; only buyer-facing UI is bilingual. This phase adds **zero** translation keys.
- **Never invent a CSS variable.** The real tokens used throughout the admin panel include `--border-brand`, `--surface-card`, `--bg-page`, `--bg-sunken`, `--text-muted`, `--text-strong`, `--text-body`, `--radius-lg`, `--radius-md`. Grep `frontend/src` yourself before adding a class that references one not listed here. Every custom-property class in this plan's JSX is `border-[var(--border-brand)]`, the one the existing admin components actually use.
- **Money is integer VND.** Use the existing `formatVnd` from `frontend/src/utils/money.js` on the frontend; never introduce a float.
- **Mobile:** usable at 375px; wide tables scroll inside their own `overflow-x-auto` container, never causing the page to scroll sideways.
- **Frontend fetches go through `frontend/src/api/shop.js`** client functions, which use the auth-interceptor-wired axios instance. A hand-rolled `fetch`/bare-axios call 401s at runtime.
- **State is cleared in the event handler that triggers a refetch, never inside the fetch effect itself** (lint rule `react-hooks/set-state-in-effect` plus a stale-data-flash bug this codebase has hit before). Guard out-of-order responses with a request-generation ref where a component's fetch can be re-triggered by user action while a previous request is still in flight.
- **`order_token` must never appear in any exported artifact** - spreadsheet, CSV, roster HTML, or any admin API response this phase adds. It is a bearer credential granting access to a buyer's order page; column B of the VTP template carries `DH<orders.id>` instead. This is the phase's single non-negotiable security property - see Task 3's Step 1.
- **Test commands:** backend `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test` (420 passing before this phase starts); frontend `cd frontend && npm test && npm run build && npm run lint` (88 passing before this phase starts). `npm run lint` has 3 known pre-existing problems in `Portfolio.jsx`/`AdminAlbumImages.jsx` (2 warnings, 1 error) from earlier phases - not this plan's problem; do not fix them here, and do not let a new task introduce a fourth.
- **Commits:** Conventional Commits, descriptive body, **no `Co-Authored-By` trailer**.
- **The bundled VTP template ships inside the repo** at `backend/shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx` so an export never depends on a path outside the repository (`/Users/phucth/vibes/vtp` is a local-machine-only workaround directory, not something a deployed container has access to).
- **Verified template facts** (read directly from the file, not assumed): data sheet is `Danh sách`, header row **7**, data begins **row 8**. Column letters: A=STT, B=Mã đơn hàng, C=Tên người nhận(\*), D=Số ĐT(\*), E=Địa chỉ nhận(\*), F=Tên hàng hóa(\*), G=Số lượng, H=Trọng lượng gram(\*), I=Giá trị hàng VND(\*), J=Tiền thu hộ COD, K=Loại hàng hóa(\*), L=Tính chất đặc biệt, M=Dịch vụ(\*), N=Dịch vụ cộng thêm, O=Thu tiền xem hàng, P/Q/R=Dài/Rộng/Cao, S=Người trả cước, T=Yêu cầu khác, U=Thời gian hẹn lấy, V=Thời gian giao. Exact service strings: `PHS - Nội tỉnh tiết kiệm thỏa thuận` (intra-HCM), `VTK - CP tiết kiệm thỏa thuận` (inter-province). Exact payer strings: `Người gửi trả` (seller pays), `Người nhận trả` (buyer pays). `Loai hang hoa` reference sheet has exactly two values: `Bưu kiện`, `Tài liệu`.
- **`Thời gian hẹn lấy` (column U) is a `<select>` over the exact 11 values transcribed verbatim from the template's own reference sheet:** `Hôm nay - Sáng (7h30 - 12h00)`, `Hôm nay - Chiều (13h30 - 18h00)`, `Hôm nay - Tối (18h30 - 21h00)`, `Ngày mai - Cả ngày`, `Ngày mai - Sáng (7h30 - 12h00)`, `Ngày mai - Chiều (13h30 - 18h00)`, `Ngày mai - Tối (18h30 - 21h00)`, `Ngày kia - Cả ngày`, `Ngày kia - Sáng (7h30 - 12h00)`, `Ngày kia - Chiều (13h30 - 18h00)`, `Ngày kia - Tối (18h30 - 21h00)`. VTP validates this field server-side on import, so free text would let a typo produce a file rejected only at upload time. Do not invent, reorder or "tidy" these strings - they must match byte-for-byte.
- **`Số lượng` (column G) is not a batch-level input.** The spec's Batch-level fields section lists only F, H, K, U. G is filled as a fixed `1` (one parcel per order row) - `orders.total`/`cod_amount` already reflect the whole order's merch value, and per-order-item quantity has no defensible single number to put in a column that describes package count, not merchandise count. See Task 5.

---

### Task 1: Bundle the VTP template and add `exceljs`

**Files:**
- Create: `backend/shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx` (binary copy)
- Modify: `backend/package.json`, `backend/package-lock.json` (via `npm install`)
- Test: `backend/tests/vtpTemplate.test.js`

**Interfaces:**
- Produces: the bundled template file at a stable repo path, and confirms `exceljs` is importable and can read it. No JS module is created by this task - Task 5 (`vtpWorkbook.js`) is the first to `require("exceljs")` in application code.

- [ ] **Step 1: Copy the template into the repo**

```bash
mkdir -p backend/shop/shipping/templates
cp "/Users/phucth/vibes/vtp/VTP_mau_excel_don_hang_o.xlsx" \
   backend/shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx
```

- [ ] **Step 2: Install `exceljs`**

```bash
cd backend && npm install exceljs
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/vtpTemplate.test.js`:

```js
import { describe, it, expect } from "vitest"
import path from "path"
import ExcelJS from "exceljs"

const TEMPLATE_PATH = path.join(
  process.cwd(), "shop", "shipping", "templates", "VTP_mau_excel_don_hang_o.xlsx"
)

describe("the bundled VTP template", () => {
  it("loads without error from its repo path", async () => {
    const wb = new ExcelJS.Workbook()
    await expect(wb.xlsx.readFile(TEMPLATE_PATH)).resolves.not.toThrow()
  })

  it("has the 'Danh sách' data sheet", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    expect(wb.getWorksheet("Danh sách")).toBeDefined()
  })

  it("has the expected header row 7 and mandatory-column headers", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    const sheet = wb.getWorksheet("Danh sách")
    const header = sheet.getRow(7)
    expect(String(header.getCell("C").value)).toContain("Tên người nhận")
    expect(String(header.getCell("D").value)).toContain("Số ĐT")
    expect(String(header.getCell("E").value)).toContain("Địa chỉ nhận")
    expect(String(header.getCell("M").value)).toContain("Dịch vụ")
  })

  it("has the four reference sheets the spec names", async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(TEMPLATE_PATH)
    for (const name of ["Dịch vụ", "Loai hang hoa", "Thời gian hẹn lấy", "Tinh chat hang hoa"]) {
      expect(wb.getWorksheet(name), `missing sheet "${name}"`).toBeDefined()
    }
  })
})
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- vtpTemplate`
Expected: PASS, 4 tests. (If it fails, the file did not copy correctly or `exceljs` did not install - fix before continuing; every later task depends on this file being present and loadable.)

- [ ] **Step 5: Commit**

```bash
git add backend/shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx \
        backend/package.json backend/package-lock.json backend/tests/vtpTemplate.test.js
git commit -F - <<'EOF'
feat(shipping): bundle the ViettelPost template and add exceljs

Copies VTP_mau_excel_don_hang_o.xlsx into the repo so a shipping export
never depends on a path outside it (the seller's existing workaround lives
at /Users/phucth/vibes/vtp, which a deployed container cannot see).

exceljs is added as the xlsx read/write dependency for the writer built in
Task 5. This task only proves the bundled copy loads and has the sheets and
header cells the rest of the phase assumes - no application code yet.
EOF
```

---

### Task 2: `vtpMapping.js` - order code, address assembly, service selection

**Files:**
- Create: `backend/shop/shipping/vtpMapping.js`
- Test: `backend/tests/vtpMappingAddress.test.js`

**Interfaces:**
- Produces `vtpMapping.js` exporting:
  - `ORDER_CODE_PREFIX = "DH"`
  - `orderCode(orderId: number): string` - `"DH" + orderId`
  - `SERVICE_INTRA_HCM = "PHS - Nội tỉnh tiết kiệm thỏa thuận"`
  - `SERVICE_INTER_PROVINCE = "VTK - CP tiết kiệm thỏa thuận"`
  - `isHoChiMinh(province: string | null | undefined): boolean`
  - `selectService(province: string | null | undefined): string` - returns `SERVICE_INTRA_HCM` or `SERVICE_INTER_PROVINCE`
  - `assembleAddress(order: {address_street, address_ward, address_district, address_province, address_raw}): string | null` - `null` means no usable address
- Task 3 extends this same file with COD/payer resolution and `mapOrderToRow`, and imports `orderCode`, `ORDER_CODE_PREFIX`, `selectService`, `assembleAddress` from it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/vtpMappingAddress.test.js`:

```js
import { describe, it, expect } from "vitest"
import {
  orderCode, ORDER_CODE_PREFIX, isHoChiMinh, selectService,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, assembleAddress,
} from "../shop/shipping/vtpMapping.js"

describe("orderCode", () => {
  it("prefixes the integer id with DH", () => {
    expect(orderCode(482)).toBe("DH482")
    expect(orderCode(1)).toBe("DH1")
  })

  it("uses the shared ORDER_CODE_PREFIX constant, not a hardcoded literal", () => {
    expect(orderCode(7)).toBe(`${ORDER_CODE_PREFIX}7`)
  })
})

describe("isHoChiMinh", () => {
  const hcmVariants = [
    "Hồ Chí Minh", "TP. Hồ Chí Minh", "Thành phố Hồ Chí Minh",
    "Ho Chi Minh", "HCM", "TPHCM", "Sài Gòn",
  ]
  for (const variant of hcmVariants) {
    it(`recognises "${variant}" as Ho Chi Minh City`, () => {
      expect(isHoChiMinh(variant)).toBe(true)
    })
  }

  it("is case-insensitive", () => {
    expect(isHoChiMinh("hồ chí minh")).toBe(true)
    expect(isHoChiMinh("hcm")).toBe(true)
  })

  it("is false for another province", () => {
    expect(isHoChiMinh("Hà Nội")).toBe(false)
    expect(isHoChiMinh("Bình Dương")).toBe(false)
  })

  it("is false for null, undefined, and empty string", () => {
    expect(isHoChiMinh(null)).toBe(false)
    expect(isHoChiMinh(undefined)).toBe(false)
    expect(isHoChiMinh("")).toBe(false)
    expect(isHoChiMinh("   ")).toBe(false)
  })
})

describe("selectService", () => {
  it("returns the intra-HCM service for a Ho Chi Minh address", () => {
    expect(selectService("Hồ Chí Minh")).toBe(SERVICE_INTRA_HCM)
  })

  it("returns the inter-province service for a recognised non-HCM province", () => {
    expect(selectService("Hà Nội")).toBe(SERVICE_INTER_PROVINCE)
  })

  it("defaults to the inter-province service for an unrecognised or empty province (the safe default)", () => {
    expect(selectService("")).toBe(SERVICE_INTER_PROVINCE)
    expect(selectService(null)).toBe(SERVICE_INTER_PROVINCE)
    expect(selectService("Some Unknown Place")).toBe(SERVICE_INTER_PROVINCE)
  })
})

describe("assembleAddress", () => {
  it("joins structured address parts with a comma when all are present", () => {
    const addr = assembleAddress({
      address_street: "123 Nguyễn Huệ", address_ward: "Bến Nghé",
      address_district: "Quận 1", address_province: "Hồ Chí Minh", address_raw: "ignored",
    })
    expect(addr).toBe("123 Nguyễn Huệ, Bến Nghé, Quận 1, Hồ Chí Minh")
  })

  it("skips missing structured parts without leaving empty commas", () => {
    const addr = assembleAddress({
      address_street: "123 Nguyễn Huệ", address_ward: null,
      address_district: null, address_province: "Hồ Chí Minh", address_raw: "ignored",
    })
    expect(addr).toBe("123 Nguyễn Huệ, Hồ Chí Minh")
  })

  it("falls back to address_raw when no structured part is present", () => {
    const addr = assembleAddress({
      address_street: null, address_ward: null, address_district: null,
      address_province: null, address_raw: "123 Some Street, freeform",
    })
    expect(addr).toBe("123 Some Street, freeform")
  })

  it("returns null when neither structured fields nor address_raw are usable", () => {
    expect(assembleAddress({
      address_street: null, address_ward: null, address_district: null,
      address_province: null, address_raw: null,
    })).toBeNull()
    expect(assembleAddress({
      address_street: "  ", address_ward: "", address_district: null,
      address_province: null, address_raw: "   ",
    })).toBeNull()
  })

  it("prefers structured fields over address_raw when both exist", () => {
    const addr = assembleAddress({
      address_street: "123 Nguyễn Huệ", address_ward: null,
      address_district: null, address_province: null,
      address_raw: "A completely different freeform address",
    })
    expect(addr).toBe("123 Nguyễn Huệ")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- vtpMappingAddress`
Expected: FAIL - `backend/shop/shipping/vtpMapping.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/shop/shipping/vtpMapping.js`:

```js
const ORDER_CODE_PREFIX = "DH"

/** Column B (Mã đơn hàng). Never order_token - see this plan's Global
 * Constraints and Task 3's security test. orders.id is already the
 * admin-facing identifier, stable, unique, and discloses nothing sensitive
 * to a courier who already receives the buyer's name, phone, and address. */
function orderCode(orderId) {
  return `${ORDER_CODE_PREFIX}${orderId}`
}

const SERVICE_INTRA_HCM = "PHS - Nội tỉnh tiết kiệm thỏa thuận"
const SERVICE_INTER_PROVINCE = "VTK - CP tiết kiệm thỏa thuận"

const HCM_KEYWORDS = [
  "ho chi minh", "hcm", "tphcm", "tp hcm", "sai gon",
]

/** Strips diacritics and lowercases so "Hồ Chí Minh", "HCM", and "Sài Gòn"
 * all match the same keyword list the seller's existing script used -
 * applied only to the structured address_province field, never the whole
 * address string (the spec's stated departure from the old script). */
function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
}

function isHoChiMinh(province) {
  const n = normalize(province)
  if (!n) return false
  return HCM_KEYWORDS.some((kw) => n.includes(kw))
}

/** Unknown/empty province defaults to the inter-province service - the
 * safe direction: a wrongly-inter-province shipment costs more, a
 * wrongly-intra-province one fails outright. */
function selectService(province) {
  return isHoChiMinh(province) ? SERVICE_INTRA_HCM : SERVICE_INTER_PROVINCE
}

/** Column E (Địa chỉ nhận). Structured fields take priority (they came
 * through address autocomplete and are more reliable); address_raw is the
 * fallback for a buyer who skipped autocomplete. Returns null when neither
 * source has anything usable - the caller must treat that as an export
 * error, never a blank column E (a shipment that cannot be delivered). */
function assembleAddress(order) {
  const parts = [order.address_street, order.address_ward, order.address_district, order.address_province]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
  if (parts.length > 0) return parts.join(", ")

  const raw = String(order.address_raw || "").trim()
  return raw.length > 0 ? raw : null
}

module.exports = {
  ORDER_CODE_PREFIX, orderCode,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, isHoChiMinh, selectService,
  assembleAddress,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- vtpMappingAddress`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/shop/shipping/vtpMapping.js backend/tests/vtpMappingAddress.test.js
git commit -F - <<'EOF'
feat(shipping): add order code, address assembly, and service selection

orderCode() derives the VTP order-code column from orders.id (never
order_token - see the plan's Global Constraints). assembleAddress() prefers
the structured address fields over address_raw and returns null when
neither is usable, so a caller can reject the order rather than export a
blank, undeliverable address column.

selectService() reads the structured address_province field (not the whole
address string, unlike the seller's existing script) and defaults to the
inter-province service for an unrecognised or empty province - the safer of
the two possible wrong guesses.
EOF
```

---

### Task 3: `vtpMapping.js` - COD, payer, and per-order row composition

**Files:**
- Modify: `backend/shop/shipping/vtpMapping.js`
- Test: `backend/tests/vtpMapping.test.js`

**Interfaces:**
- Consumes: `orderCode`, `selectService`, `assembleAddress` (Task 2, same file).
- Produces, added to `vtpMapping.js`'s exports:
  - `PAYER_BUYER = "Người nhận trả"`
  - `PAYER_SELLER = "Người gửi trả"`
  - `LOAI_HANG_HOA_VALUES = ["Bưu kiện", "Tài liệu"]`
  - `resolveCod(order: {payment_method, cod_amount}): {ok: true, value: number | null} | {ok: false, reason: "cod_missing_amount", message: string}`
  - `selectPayer(order: {shipping_payer}): string`
  - `mapOrderToRow(order): {ok: true, order_id: number, row: {B, C, D, E, I, J, M, S}} | {ok: false, order_id: number, reason: "no_address" | "cod_missing_amount", message: string}`
- Consumed by: `vtpWorkbook.js` (Task 5) imports `mapOrderToRow`; `backend/routes/adminShipping.js` (Task 8) imports `LOAI_HANG_HOA_VALUES` for request validation.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/vtpMapping.test.js`:

```js
import { describe, it, expect } from "vitest"
import {
  resolveCod, selectPayer, mapOrderToRow, PAYER_BUYER, PAYER_SELLER,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, LOAI_HANG_HOA_VALUES,
} from "../shop/shipping/vtpMapping.js"

function baseOrder(over = {}) {
  return {
    id: 42,
    buyer_name: "Nguyễn Văn A",
    phone: "0901 234 567",
    address_street: "123 Lê Lợi", address_ward: "Bến Thành",
    address_district: "Quận 1", address_province: "Hồ Chí Minh", address_raw: null,
    total: 350000,
    payment_method: "bank",
    cod_amount: null,
    shipping_payer: "buyer",
    order_token: "supersecret-bearer-token-abcdef1234567890",
    ...over,
  }
}

describe("LOAI_HANG_HOA_VALUES", () => {
  it("has exactly the two values verified from the template's reference sheet", () => {
    expect(LOAI_HANG_HOA_VALUES).toEqual(["Bưu kiện", "Tài liệu"])
  })
})

describe("resolveCod", () => {
  it("is blank (null) for a prepaid order regardless of cod_amount", () => {
    expect(resolveCod({ payment_method: "bank", cod_amount: null })).toEqual({ ok: true, value: null })
    expect(resolveCod({ payment_method: "momo", cod_amount: 50000 })).toEqual({ ok: true, value: null })
    expect(resolveCod({ payment_method: "paypal", cod_amount: 0 })).toEqual({ ok: true, value: null })
  })

  it("is the cod_amount for a COD order with a value set", () => {
    expect(resolveCod({ payment_method: "cod", cod_amount: 350000 })).toEqual({ ok: true, value: 350000 })
  })

  it("is an error, not a blank, for a COD order with a null cod_amount", () => {
    const result = resolveCod({ payment_method: "cod", cod_amount: null })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("cod_missing_amount")
  })

  it("is an error for a COD order with cod_amount undefined", () => {
    expect(resolveCod({ payment_method: "cod", cod_amount: undefined }).ok).toBe(false)
  })
})

describe("selectPayer", () => {
  it("is 'Người nhận trả' (buyer pays) by default", () => {
    expect(selectPayer({ shipping_payer: "buyer" })).toBe(PAYER_BUYER)
  })

  it("is 'Người gửi trả' (seller pays) when the order is marked freeship", () => {
    expect(selectPayer({ shipping_payer: "seller" })).toBe(PAYER_SELLER)
  })

  it("defaults to buyer-pays for a missing/null shipping_payer (matches the migration's column default)", () => {
    expect(selectPayer({ shipping_payer: null })).toBe(PAYER_BUYER)
    expect(selectPayer({})).toBe(PAYER_BUYER)
  })
})

describe("mapOrderToRow - success paths", () => {
  it("maps a prepaid intra-HCM freeship order to the exact expected row", () => {
    const result = mapOrderToRow(baseOrder({ shipping_payer: "seller" }))
    expect(result.ok).toBe(true)
    expect(result.order_id).toBe(42)
    expect(result.row).toEqual({
      B: "DH42",
      C: "Nguyễn Văn A",
      D: "0901234567",
      E: "123 Lê Lợi, Bến Thành, Quận 1, Hồ Chí Minh",
      I: 350000,
      J: null,
      M: SERVICE_INTRA_HCM,
      S: PAYER_SELLER,
    })
  })

  it("maps a COD inter-province buyer-pays order to the exact expected row", () => {
    const result = mapOrderToRow(baseOrder({
      address_province: "Hà Nội", payment_method: "cod", cod_amount: 350000, shipping_payer: "buyer",
    }))
    expect(result.ok).toBe(true)
    expect(result.row).toEqual({
      B: "DH42",
      C: "Nguyễn Văn A",
      D: "0901234567",
      E: "123 Lê Lợi, Bến Thành, Quận 1, Hà Nội",
      I: 350000,
      J: 350000,
      M: SERVICE_INTER_PROVINCE,
      S: PAYER_BUYER,
    })
  })

  it("strips all whitespace from the phone number, not just leading/trailing", () => {
    const result = mapOrderToRow(baseOrder({ phone: "090 123 4 567" }))
    expect(result.row.D).toBe("0901234567")
  })
})

describe("mapOrderToRow - error paths", () => {
  it("rejects an order with no usable address, never exporting a blank column E", () => {
    const result = mapOrderToRow(baseOrder({
      address_street: null, address_ward: null, address_district: null,
      address_province: null, address_raw: null,
    }))
    expect(result.ok).toBe(false)
    expect(result.order_id).toBe(42)
    expect(result.reason).toBe("no_address")
    expect(result.row).toBeUndefined()
  })

  it("rejects a COD order with a null cod_amount, never exporting a blank column J", () => {
    const result = mapOrderToRow(baseOrder({ payment_method: "cod", cod_amount: null }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("cod_missing_amount")
  })
})

describe("mapOrderToRow - security: order_token never appears in the mapped row", () => {
  it("does not include order_token as a key or leak its value into any field", () => {
    const order = baseOrder()
    const result = mapOrderToRow(order)
    expect(result.ok).toBe(true)
    expect(result.row).not.toHaveProperty("order_token")
    const serialized = JSON.stringify(result.row)
    expect(serialized).not.toContain(order.order_token)
  })

  it("still omits order_token from the row even when the order object carries other unexpected extra fields", () => {
    const order = baseOrder({ some_other_secret: "should-never-appear-anywhere" })
    const result = mapOrderToRow(order)
    const serialized = JSON.stringify(result.row)
    expect(serialized).not.toContain(order.order_token)
    expect(serialized).not.toContain("should-never-appear-anywhere")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- tests/vtpMapping.test.js`
Expected: FAIL - `resolveCod`, `selectPayer`, `mapOrderToRow`, `PAYER_BUYER`, `PAYER_SELLER`, `LOAI_HANG_HOA_VALUES` are not exported.

- [ ] **Step 3: Implement**

In `backend/shop/shipping/vtpMapping.js`, add after `assembleAddress`:

```js
const PAYER_BUYER = "Người nhận trả"
const PAYER_SELLER = "Người gửi trả"

// Verified from the template's "Loai hang hoa" reference sheet - exactly two values.
const LOAI_HANG_HOA_VALUES = ["Bưu kiện", "Tài liệu"]

/** Column J (Tiền thu hộ COD). Blank (null) for any prepaid order - VTP
 * should never be told to collect money that was already paid. A COD order
 * with no recorded cod_amount is an export ERROR, not a blank cell: a COD
 * shipment that collects nothing is money lost, and must be caught before
 * the parcel leaves, not discovered afterward. */
function resolveCod(order) {
  if (order.payment_method !== "cod") return { ok: true, value: null }
  if (order.cod_amount === null || order.cod_amount === undefined) {
    return {
      ok: false,
      reason: "cod_missing_amount",
      message: "Đơn COD nhưng chưa có số tiền thu hộ (cod_amount)",
    }
  }
  return { ok: true, value: order.cod_amount }
}

/** Column S (Người trả cước). Defaults to buyer-pays, matching migration
 * 017's column default - an order that predates the shipping_payer column
 * being set explicitly is never silently treated as freeship. */
function selectPayer(order) {
  return order.shipping_payer === "seller" ? PAYER_SELLER : PAYER_BUYER
}

/**
 * Map one order to its per-order VTP row values (columns B, C, D, E, I, J,
 * M, S - the batch-level columns F, G, H, K, U are filled by the caller,
 * see vtpWorkbook.js). Returns an explicit ok:false with a reason rather
 * than throwing, so a caller can skip one bad order without aborting a
 * whole export - the same per-row-isolation principle as the admin
 * bulk-cancel endpoint.
 *
 * Deliberately reads only the specific fields it needs off `order` - never
 * `order.order_token` - so a caller accidentally passing the full order row
 * (including order_token) can never leak it into the mapped row. See this
 * plan's Global Constraints.
 */
function mapOrderToRow(order) {
  const address = assembleAddress(order)
  if (!address) {
    return {
      ok: false,
      order_id: order.id,
      reason: "no_address",
      message: `${orderCode(order.id)}: không có địa chỉ nhận hàng hợp lệ`,
    }
  }

  const cod = resolveCod(order)
  if (!cod.ok) {
    return { ok: false, order_id: order.id, reason: cod.reason, message: `${orderCode(order.id)}: ${cod.message}` }
  }

  return {
    ok: true,
    order_id: order.id,
    row: {
      B: orderCode(order.id),
      C: order.buyer_name,
      D: String(order.phone || "").replace(/\s+/g, ""),
      E: address,
      I: order.total,
      J: cod.value,
      M: selectService(order.address_province),
      S: selectPayer(order),
    },
  }
}

module.exports = {
  ORDER_CODE_PREFIX, orderCode,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, isHoChiMinh, selectService,
  assembleAddress,
  PAYER_BUYER, PAYER_SELLER, LOAI_HANG_HOA_VALUES,
  resolveCod, selectPayer, mapOrderToRow,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- tests/vtpMapping.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/shipping/vtpMapping.js backend/tests/vtpMapping.test.js
git commit -F - <<'EOF'
feat(shipping): add COD/payer resolution and per-order row mapping

resolveCod() blanks column J for any prepaid order and treats a COD order
with a null cod_amount as an export error, never a blank cell - a COD
shipment that collects nothing is money lost. selectPayer() reads the new
shipping_payer column (migration 017, Task 4), defaulting to buyer-pays.

mapOrderToRow() composes address assembly, service selection, COD, and
payer resolution into one order's B/C/D/E/I/J/M/S values, returning an
explicit {ok:false, reason} for a bad order rather than throwing, so a
caller can skip it without aborting the whole export.

A dedicated test asserts order_token never appears as a key or a
substring anywhere in a mapped row's serialized output - the phase's single
non-negotiable security property, since order_token is a bearer credential
and column B must never carry it.
EOF
```

---

### Task 4: Migration 017 - per-order shipping payer

**Files:**
- Create: `backend/migrations/017_add_order_shipping_payer.js`
- Test: `backend/tests/migrationShippingPayer.test.js`

**Interfaces:**
- Produces: `orders.shipping_payer` column, `enum('buyer', 'seller')`, `NOT NULL DEFAULT 'buyer'`.
- Consumed by: `vtpMapping.selectPayer` (Task 3, already written against this column name/values); `backend/routes/adminShipping.js` (Task 8) reads and writes it directly via `db.query`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/migrationShippingPayer.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("orders.shipping_payer", () => {
  it("defaults to 'buyer' on a freshly created order", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])

    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [o.id])
    expect(row.shipping_payer).toBe("buyer")
  })

  it("can be updated to 'seller'", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await db.query("UPDATE orders SET shipping_payer = 'seller' WHERE id = ?", [o.id])
    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [o.id])
    expect(row.shipping_payer).toBe("seller")
  })

  it("rejects a value outside the enum", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }],
      buyer, fulfillment_method: "ship", payment_method: "bank",
    })

    await expect(
      db.query("UPDATE orders SET shipping_payer = 'nobody' WHERE id = ?", [o.id])
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- migrationShippingPayer`
Expected: FAIL - `Unknown column 'shipping_payer' in 'field list'`.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/017_add_order_shipping_payer.js`:

```js
exports.up = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    // Replaces the old convention of typing "freeship" into the buyer's
    // name (parsed out by the seller's pre-shop script) - that hack
    // pollutes the printed shipping label and lets a buyer trigger free
    // shipping by typing a word into their own name field.
    table.enu("shipping_payer", ["buyer", "seller"]).notNullable().defaultTo("buyer")
  })
}

exports.down = function (knex) {
  return knex.schema.alterTable("orders", (table) => {
    table.dropColumn("shipping_payer")
  })
}
```

- [ ] **Step 4: Run the migration and verify the test passes**

Run:
```bash
cd backend && DB_PORT=3307 DB_PASS=root npm run migrate
DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- migrationShippingPayer
```
Expected: migration applies with no error; test PASS, 3 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions - `orderRepo.createOrder` does not set `shipping_payer` explicitly, so every existing order-creation test continues to get the column's default.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/017_add_order_shipping_payer.js backend/tests/migrationShippingPayer.test.js
git commit -F - <<'EOF'
feat(shipping): add orders.shipping_payer for the freeship toggle

New enum('buyer','seller') column, default 'buyer', backing column S
(Người trả cước) of the ViettelPost export. Replaces the previous
convention of typing "freeship" into the buyer's name field - a hack that
polluted the printed shipping label and let a buyer self-grant free
shipping by editing their own name.

No data migration needed: every existing order gets the safe default
(buyer pays), matching current behavior for orders that predate this
column.
EOF
```

---

### Task 5: `vtpWorkbook.js` - the xlsx writer

**Files:**
- Create: `backend/shop/shipping/vtpWorkbook.js`
- Test: `backend/tests/vtpWorkbook.test.js`

**Interfaces:**
- Consumes: `mapOrderToRow` (Task 3); the bundled template at `backend/shop/shipping/templates/VTP_mau_excel_don_hang_o.xlsx` (Task 1).
- Produces `vtpWorkbook.js` exporting:
  - `TEMPLATE_PATH: string`
  - `DATA_SHEET_NAME = "Danh sách"`
  - `DATA_START_ROW = 8`
  - `loadTemplateWorkbook(): Promise<ExcelJS.Workbook>`
  - `buildExportWorkbook(orders: OrderRow[], batch: {ten_hang_hoa, trong_luong, loai_hang_hoa, thoi_gian_hen_lay}): Promise<{buffer: Buffer, exported: {order_id, row_index}[], excluded: {order_id, reason, message}[]}>`
- Consumed by: `backend/routes/adminShipping.js` (Task 8) calls `buildExportWorkbook`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/vtpWorkbook.test.js`:

```js
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { buildExportWorkbook, DATA_SHEET_NAME, DATA_START_ROW } from "../shop/shipping/vtpWorkbook.js"

function order(over = {}) {
  return {
    id: 1, buyer_name: "Nguyễn Thị Bích", phone: "0901234567",
    address_street: "12 Lý Tự Trọng", address_ward: "Bến Nghé",
    address_district: "Quận 1", address_province: "Hồ Chí Minh", address_raw: null,
    total: 120000, payment_method: "bank", cod_amount: null,
    shipping_payer: "buyer", order_token: "bearer-token-must-never-leak",
    ...over,
  }
}

const batch = {
  ten_hang_hoa: "Photocard", trong_luong: 50, loai_hang_hoa: "Bưu kiện", thoi_gian_hen_lay: "Cả ngày",
}

describe("buildExportWorkbook", () => {
  it("produces a buffer that reopens as a valid workbook with the Danh sách sheet", async () => {
    const { buffer } = await buildExportWorkbook([order()], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.getWorksheet(DATA_SHEET_NAME)).toBeDefined()
  })

  it("writes the first order starting at row 8, with STT 1", async () => {
    const { buffer, exported } = await buildExportWorkbook([order()], batch)
    expect(exported).toEqual([{ order_id: 1, row_index: DATA_START_ROW }])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    const row = sheet.getRow(DATA_START_ROW)
    expect(row.getCell("A").value).toBe(1)
    expect(row.getCell("B").value).toBe("DH1")
    expect(row.getCell("C").value).toBe("Nguyễn Thị Bích")
  })

  it("fills every mandatory column: C, D, E, F, H, I, K, M for each row", async () => {
    const { buffer } = await buildExportWorkbook([order()], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    for (const col of ["C", "D", "E", "F", "H", "I", "K", "M"]) {
      expect(row.getCell(col).value, `column ${col} is empty`).not.toBeNull()
      expect(row.getCell(col).value, `column ${col} is empty`).not.toBe("")
    }
  })

  it("fills batch-level columns F, H, K, U identically for every row, and G as 1 per row", async () => {
    const { buffer } = await buildExportWorkbook([order({ id: 1 }), order({ id: 2 })], batch)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    for (const rowIdx of [DATA_START_ROW, DATA_START_ROW + 1]) {
      const row = sheet.getRow(rowIdx)
      expect(row.getCell("F").value).toBe("Photocard")
      expect(row.getCell("H").value).toBe(50)
      expect(row.getCell("K").value).toBe("Bưu kiện")
      expect(row.getCell("U").value).toBe("Cả ngày")
      expect(row.getCell("G").value).toBe(1)
    }
  })

  it("leaves column J blank for a prepaid order and fills it for a COD order", async () => {
    const { buffer } = await buildExportWorkbook(
      [order({ id: 1, payment_method: "bank" }), order({ id: 2, payment_method: "cod", cod_amount: 99000 })],
      batch
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.getWorksheet(DATA_SHEET_NAME)
    expect(sheet.getRow(DATA_START_ROW).getCell("J").value).toBeNull()
    expect(sheet.getRow(DATA_START_ROW + 1).getCell("J").value).toBe(99000)
  })

  it("excludes an order with no address and reports it, writing nothing for it", async () => {
    const bad = order({
      id: 9, address_street: null, address_ward: null, address_district: null,
      address_province: null, address_raw: null,
    })
    const { buffer, exported, excluded } = await buildExportWorkbook([bad], batch)
    expect(exported).toEqual([])
    expect(excluded).toEqual([{ order_id: 9, reason: "no_address", message: expect.stringContaining("DH9") }])

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    expect(row.getCell("B").value).toBeNull()
  })

  it("continues past an excluded order to write the next good one starting at row 8", async () => {
    const bad = order({ id: 9, address_street: null, address_ward: null, address_district: null, address_province: null, address_raw: null })
    const good = order({ id: 10 })
    const { exported, excluded } = await buildExportWorkbook([bad, good], batch)
    expect(excluded).toHaveLength(1)
    expect(exported).toEqual([{ order_id: 10, row_index: DATA_START_ROW }])
  })

  it("survives Vietnamese diacritics in buyer name and address round-tripping through xlsx", async () => {
    const { buffer } = await buildExportWorkbook(
      [order({ buyer_name: "Đặng Thị Ngọc Ánh", address_street: "45 Đường Điện Biên Phủ" })],
      batch
    )
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet(DATA_SHEET_NAME).getRow(DATA_START_ROW)
    expect(row.getCell("C").value).toBe("Đặng Thị Ngọc Ánh")
    expect(String(row.getCell("E").value)).toContain("Đường Điện Biên Phủ")
  })

  it("SECURITY: order_token never appears anywhere in the generated buffer", async () => {
    const secretToken = "extremely-unique-bearer-token-xyz987"
    const { buffer } = await buildExportWorkbook([order({ order_token: secretToken })], batch)
    // The xlsx is a zip of XML parts; a raw substring scan of the buffer
    // catches the token whether it landed in a cell, shared string, or
    // anywhere else exceljs might have serialized it.
    expect(buffer.toString("latin1")).not.toContain(secretToken)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- vtpWorkbook`
Expected: FAIL - `backend/shop/shipping/vtpWorkbook.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/shop/shipping/vtpWorkbook.js`:

```js
const path = require("path")
const ExcelJS = require("exceljs")
const { mapOrderToRow } = require("./vtpMapping")

const TEMPLATE_PATH = path.join(__dirname, "templates", "VTP_mau_excel_don_hang_o.xlsx")
const DATA_SHEET_NAME = "Danh sách"
const DATA_START_ROW = 8

async function loadTemplateWorkbook() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(TEMPLATE_PATH)
  return wb
}

/**
 * Fill the bundled VTP template from row 8 with one row per exportable
 * order. Column G (Số lượng) is fixed at 1 - one parcel per order row, not
 * a batch-level input (see this plan's Global Constraints); F, H, K, U are
 * entered once and repeated for every row, matching the seller's existing
 * script's interactive prompts. Data validation on the template's dropdown
 * columns is not preserved by this write path - openpyxl already drops it
 * in the seller's current script and that output imports successfully
 * today, so ViettelPost validates server-side regardless.
 */
async function buildExportWorkbook(orders, batch) {
  const wb = await loadTemplateWorkbook()
  const sheet = wb.getWorksheet(DATA_SHEET_NAME)
  if (!sheet) throw new Error(`Template thiếu sheet "${DATA_SHEET_NAME}"`)

  const exported = []
  const excluded = []
  let stt = 1
  let rowIdx = DATA_START_ROW

  for (const order of orders) {
    const mapped = mapOrderToRow(order)
    if (!mapped.ok) {
      excluded.push({ order_id: mapped.order_id, reason: mapped.reason, message: mapped.message })
      continue
    }

    const row = sheet.getRow(rowIdx)
    row.getCell("A").value = stt
    row.getCell("B").value = mapped.row.B
    row.getCell("C").value = mapped.row.C
    row.getCell("D").value = mapped.row.D
    row.getCell("E").value = mapped.row.E
    row.getCell("F").value = batch.ten_hang_hoa
    row.getCell("G").value = 1
    row.getCell("H").value = batch.trong_luong
    row.getCell("I").value = mapped.row.I
    row.getCell("J").value = mapped.row.J
    row.getCell("K").value = batch.loai_hang_hoa
    row.getCell("M").value = mapped.row.M
    row.getCell("S").value = mapped.row.S
    row.getCell("U").value = batch.thoi_gian_hen_lay
    row.commit()

    exported.push({ order_id: mapped.order_id, row_index: rowIdx })
    stt += 1
    rowIdx += 1
  }

  const buffer = await wb.xlsx.writeBuffer()
  return { buffer, exported, excluded }
}

module.exports = { TEMPLATE_PATH, DATA_SHEET_NAME, DATA_START_ROW, loadTemplateWorkbook, buildExportWorkbook }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- vtpWorkbook`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/shipping/vtpWorkbook.js backend/tests/vtpWorkbook.test.js
git commit -F - <<'EOF'
feat(shipping): add the xlsx writer for the ViettelPost export

buildExportWorkbook() loads the bundled template, fills batch-level columns
(F, H, K, U) once and per-order columns from mapOrderToRow() starting at row
8, and returns a buffer plus which orders were exported vs excluded (with a
reason) - an excluded order (bad address, missing COD amount) is skipped,
not silently written blank.

A dedicated security test scans the raw generated buffer (the xlsx zip's
decompressed bytes) for a planted order_token substring and asserts it never
appears anywhere in the output, not just absent from the mapped row object.
EOF
```

---

### Task 6: `trackingImport.js` - parsing and resolution

**Files:**
- Create: `backend/shop/shipping/trackingImport.js`
- Test: `backend/tests/trackingImport.test.js`

**Interfaces:**
- Consumes: `ORDER_CODE_PREFIX` (Task 2, `vtpMapping.js`).
- Produces `trackingImport.js` exporting:
  - `MAX_IMPORT_ROWS = 200`
  - `parseOrderCode(raw: string): number | null`
  - `parsePastedText(text: string): {order_code: string, tracking_code: string}[]`
  - `extractPairsFromSheetRows(rows2D: any[][]): {order_code: string, tracking_code: string}[]` - `rows2D[0]` is a header row; finds the order-code and tracking-code columns by header text so it survives VTP re-ordering or renaming columns in its own result export.
  - `resolvePreview(rows: {order_code, tracking_code}[], ordersById: Map<number, {id, status}>): {toApply: {order_id, order_code, tracking_code}[], skipped: {order_code, tracking_code, reason, message}[]}` - pure; does not touch the database. `reason` is one of `"invalid_code" | "missing_tracking_code" | "duplicate_tracking_code" | "not_found" | "already_shipped" | "not_confirmed"`.
- Consumed by: `backend/routes/adminShipping.js` (Task 9), which fetches `ordersById` from the database and does any `.xlsx` parsing (via `exceljs`) before calling into this pure module.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/trackingImport.test.js`:

```js
import { describe, it, expect } from "vitest"
import {
  parseOrderCode, parsePastedText, extractPairsFromSheetRows, resolvePreview, MAX_IMPORT_ROWS,
} from "../shop/shipping/trackingImport.js"

describe("parseOrderCode", () => {
  it("parses a well-formed DH-prefixed code", () => {
    expect(parseOrderCode("DH482")).toBe(482)
  })

  it("is case-insensitive on the prefix", () => {
    expect(parseOrderCode("dh482")).toBe(482)
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseOrderCode("  DH482  ")).toBe(482)
  })

  it("returns null for a code with no DH prefix, extra text, or non-numeric id", () => {
    expect(parseOrderCode("482")).toBeNull()
    expect(parseOrderCode("DH482x")).toBeNull()
    expect(parseOrderCode("COD 1")).toBeNull()
    expect(parseOrderCode("")).toBeNull()
    expect(parseOrderCode(null)).toBeNull()
  })
})

describe("parsePastedText", () => {
  it("splits tab-separated lines into order_code/tracking_code pairs", () => {
    const rows = parsePastedText("DH1\tVTP123\nDH2\tVTP456")
    expect(rows).toEqual([
      { order_code: "DH1", tracking_code: "VTP123" },
      { order_code: "DH2", tracking_code: "VTP456" },
    ])
  })

  it("also accepts comma-separated lines", () => {
    expect(parsePastedText("DH1,VTP123")).toEqual([{ order_code: "DH1", tracking_code: "VTP123" }])
  })

  it("skips blank lines", () => {
    expect(parsePastedText("DH1\tVTP123\n\n\nDH2\tVTP456\n")).toHaveLength(2)
  })

  it("returns an empty array for empty or non-string input", () => {
    expect(parsePastedText("")).toEqual([])
    expect(parsePastedText(null)).toEqual([])
    expect(parsePastedText(undefined)).toEqual([])
  })
})

describe("extractPairsFromSheetRows", () => {
  it("finds the order-code and tracking-code columns by header text, regardless of position", () => {
    const rows2D = [
      ["STT", "Mã vận đơn", "Ghi chú", "Mã đơn hàng"],
      [1, "VTP001", "", "DH5"],
      [2, "VTP002", "", "DH6"],
    ]
    expect(extractPairsFromSheetRows(rows2D)).toEqual([
      { order_code: "DH5", tracking_code: "VTP001" },
      { order_code: "DH6", tracking_code: "VTP002" },
    ])
  })

  it("returns an empty array when it cannot find both expected header columns", () => {
    expect(extractPairsFromSheetRows([["A", "B"], [1, 2]])).toEqual([])
  })

  it("returns an empty array for fewer than 2 rows (header only, or empty sheet)", () => {
    expect(extractPairsFromSheetRows([["Mã đơn hàng", "Mã vận đơn"]])).toEqual([])
    expect(extractPairsFromSheetRows([])).toEqual([])
  })

  it("skips a fully blank data row", () => {
    const rows2D = [["Mã đơn hàng", "Mã vận đơn"], [null, null], ["DH1", "VTP1"]]
    expect(extractPairsFromSheetRows(rows2D)).toEqual([{ order_code: "DH1", tracking_code: "VTP1" }])
  })
})

describe("resolvePreview", () => {
  const confirmedOrder = { id: 1, status: "confirmed" }
  const shippedOrder = { id: 2, status: "shipped" }
  const completedOrder = { id: 3, status: "completed" }
  const pendingOrder = { id: 4, status: "pending" }
  const cancelledOrder = { id: 5, status: "cancelled" }

  function byId(...orders) {
    return new Map(orders.map((o) => [o.id, o]))
  }

  it("applies a well-formed row for a confirmed order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "DH1", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }])
    expect(skipped).toEqual([])
  })

  it("skips an unparsable order code, never guessing a nearby order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "not-a-code", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([])
    expect(skipped).toEqual([{ order_code: "not-a-code", tracking_code: "VTP001", reason: "invalid_code", message: expect.any(String) }])
  })

  it("skips a row with no tracking code", () => {
    const { skipped } = resolvePreview([{ order_code: "DH1", tracking_code: "" }], byId(confirmedOrder))
    expect(skipped[0].reason).toBe("missing_tracking_code")
  })

  it("skips an order code matching no order, never applying it to a nearby order", () => {
    const { toApply, skipped } = resolvePreview(
      [{ order_code: "DH999", tracking_code: "VTP001" }], byId(confirmedOrder)
    )
    expect(toApply).toEqual([])
    expect(skipped[0].reason).toBe("not_found")
  })

  it("skips an already-shipped order distinctly from other non-confirmed statuses", () => {
    const { skipped } = resolvePreview(
      [
        { order_code: "DH2", tracking_code: "VTP001" },
        { order_code: "DH3", tracking_code: "VTP002" },
      ],
      byId(shippedOrder, completedOrder)
    )
    expect(skipped[0].reason).toBe("already_shipped")
    expect(skipped[1].reason).toBe("already_shipped")
  })

  it("skips a pending or cancelled order as not_confirmed", () => {
    const { skipped } = resolvePreview(
      [
        { order_code: "DH4", tracking_code: "VTP001" },
        { order_code: "DH5", tracking_code: "VTP002" },
      ],
      byId(pendingOrder, cancelledOrder)
    )
    expect(skipped[0].reason).toBe("not_confirmed")
    expect(skipped[1].reason).toBe("not_confirmed")
  })

  it("rejects duplicate tracking codes within the same file - neither row is applied", () => {
    const { toApply, skipped } = resolvePreview(
      [
        { order_code: "DH1", tracking_code: "SAME" },
        { order_code: "DH2", tracking_code: "SAME" },
      ],
      byId(confirmedOrder, { id: 2, status: "confirmed" })
    )
    expect(toApply).toEqual([])
    expect(skipped).toHaveLength(2)
    expect(skipped.every((s) => s.reason === "duplicate_tracking_code")).toBe(true)
  })

  it("idempotency: re-running preview against orders already moved to shipped changes nothing", () => {
    // Simulates re-uploading the same file after a successful import: every
    // order is now 'shipped', so every row is skipped as already_shipped,
    // and toApply is empty - a second confirm would send no new emails.
    const rows = [{ order_code: "DH2", tracking_code: "VTP001" }]
    const { toApply, skipped } = resolvePreview(rows, byId(shippedOrder))
    expect(toApply).toEqual([])
    expect(skipped[0].reason).toBe("already_shipped")
  })

  it("processes multiple valid rows independently - one bad row does not affect a good one", () => {
    const { toApply, skipped } = resolvePreview(
      [
        { order_code: "DH1", tracking_code: "VTP001" },
        { order_code: "DHnope", tracking_code: "VTP002" },
      ],
      byId(confirmedOrder)
    )
    expect(toApply).toEqual([{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }])
    expect(skipped).toHaveLength(1)
  })
})

describe("MAX_IMPORT_ROWS", () => {
  it("is a sane positive bound the route layer enforces", () => {
    expect(MAX_IMPORT_ROWS).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- trackingImport`
Expected: FAIL - `backend/shop/shipping/trackingImport.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/shop/shipping/trackingImport.js`:

```js
const { ORDER_CODE_PREFIX } = require("./vtpMapping")

const MAX_IMPORT_ROWS = 200

const ORDER_CODE_RE = new RegExp(`^${ORDER_CODE_PREFIX}(\\d+)$`, "i")

function parseOrderCode(raw) {
  if (typeof raw !== "string") return null
  const m = raw.trim().match(ORDER_CODE_RE)
  return m ? Number(m[1]) : null
}

function parsePastedText(text) {
  if (typeof text !== "string") return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [orderCode = "", trackingCode = ""] = line.split(/\t|,/).map((p) => p.trim())
      return { order_code: orderCode, tracking_code: trackingCode }
    })
}

/**
 * `rows2D` is a raw 2D array read from an uploaded VTP result sheet - the
 * route layer does the exceljs reading, this function stays pure. Finds the
 * order-code and tracking-code columns by matching header text rather than
 * a fixed position, so a result file with reordered or renamed-but-similar
 * columns still resolves correctly.
 */
function extractPairsFromSheetRows(rows2D) {
  if (!Array.isArray(rows2D) || rows2D.length < 2) return []
  const header = rows2D[0].map((h) => String(h || "").toLowerCase())
  const orderCodeCol = header.findIndex((h) => h.includes("đơn hàng") || h.includes("don hang"))
  const trackingCol = header.findIndex((h) => h.includes("vận đơn") || h.includes("van don"))
  if (orderCodeCol === -1 || trackingCol === -1) return []

  return rows2D
    .slice(1)
    .filter((row) => (row[orderCodeCol] ?? "") !== "" || (row[trackingCol] ?? "") !== "")
    .map((row) => ({
      order_code: String(row[orderCodeCol] ?? "").trim(),
      tracking_code: String(row[trackingCol] ?? "").trim(),
    }))
}

/**
 * Resolve a batch of {order_code, tracking_code} pairs against already-
 * fetched order rows, WITHOUT writing anything - this is the preview step
 * the spec requires before any order is touched.
 *
 * Four properties this function guarantees, per the spec's Tracking-Code
 * Round Trip section:
 *  - Idempotent: an order already 'shipped'/'completed' is reported
 *    already_shipped and excluded from toApply, so re-running preview after
 *    a successful import (e.g. after a timeout-induced re-upload) yields an
 *    empty toApply and changes nothing.
 *  - Per-row isolation: one bad row (unparsable code, unmatched code,
 *    wrong status) never removes a good row from toApply.
 *  - Never guesses a match: an order code that resolves to no known order
 *    (not_found) or fails to parse (invalid_code) is reported, never
 *    applied to the nearest order.
 *  - Duplicate tracking codes within one file are rejected outright - ALL
 *    rows sharing a duplicated tracking code are skipped, since which one
 *    is correct cannot be determined.
 */
function resolvePreview(rows, ordersById) {
  const trackingCodeCounts = new Map()
  for (const r of rows) {
    if (!r.tracking_code) continue
    trackingCodeCounts.set(r.tracking_code, (trackingCodeCounts.get(r.tracking_code) || 0) + 1)
  }

  const toApply = []
  const skipped = []

  for (const r of rows) {
    const orderId = parseOrderCode(r.order_code)
    if (orderId === null) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "invalid_code", message: `Mã đơn "${r.order_code}" không hợp lệ`,
      })
      continue
    }
    if (!r.tracking_code) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "missing_tracking_code", message: `${ORDER_CODE_PREFIX}${orderId}: thiếu mã vận đơn`,
      })
      continue
    }
    if (trackingCodeCounts.get(r.tracking_code) > 1) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "duplicate_tracking_code",
        message: `Mã vận đơn "${r.tracking_code}" xuất hiện nhiều lần trong file, không rõ áp dụng cho đơn nào`,
      })
      continue
    }

    const order = ordersById.get(orderId)
    if (!order) {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "not_found", message: `Không tìm thấy đơn ${ORDER_CODE_PREFIX}${orderId}`,
      })
      continue
    }
    if (order.status === "shipped" || order.status === "completed") {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "already_shipped",
        message: `Đơn ${ORDER_CODE_PREFIX}${orderId} đã ở trạng thái "${order.status}", bỏ qua`,
      })
      continue
    }
    if (order.status !== "confirmed") {
      skipped.push({
        order_code: r.order_code, tracking_code: r.tracking_code,
        reason: "not_confirmed",
        message: `Đơn ${ORDER_CODE_PREFIX}${orderId} đang ở trạng thái "${order.status}", không thể nhập mã vận đơn`,
      })
      continue
    }

    toApply.push({ order_id: orderId, order_code: r.order_code, tracking_code: r.tracking_code })
  }

  return { toApply, skipped }
}

module.exports = { MAX_IMPORT_ROWS, parseOrderCode, parsePastedText, extractPairsFromSheetRows, resolvePreview }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- trackingImport`
Expected: PASS, 24 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/shipping/trackingImport.js backend/tests/trackingImport.test.js
git commit -F - <<'EOF'
feat(shipping): add tracking-code import parsing and resolution

Pure parsing (pasted rows, or a 2D array already extracted from an uploaded
VTP result sheet by header-text column matching) and resolution against
already-fetched order rows. No I/O and no writes - this is the preview step
the spec requires before anything changes.

resolvePreview() guarantees the four properties the spec calls out: an
already-shipped order is reported and excluded (idempotent re-import), one
bad row never drops a good one (per-order isolation), an unmatched or
unparsable code is reported rather than guessed onto a nearby order, and
duplicate tracking codes within one file are rejected outright since which
row is correct cannot be determined.
EOF
```

---

### Task 7: `roster.js` - pickup roster assembly

**Files:**
- Create: `backend/shop/shipping/roster.js`
- Test: `backend/tests/roster.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks - takes already-fetched order+item data as plain objects.
- Produces `roster.js` exporting:
  - `buildRoster(orders: {id, buyer_name, phone, payment_method, cod_amount, items: {product_name_snapshot, variant_label_snapshot, qty}[]}[]): {rows: RosterRow[], excluded: {order_id, reason, message}[]}`

  `RosterRow` shape:
  ```
  {
    order_id, order_code, buyer_name, phone,
    items: [{ product_name, variant_label, qty }],
    paid,        // boolean: true if prepaid, false if collect-at-handover
    amount_due,  // integer VND: 0 if paid, cod_amount if collect-at-handover
  }
  ```
  Sorted by `buyer_name` ascending (Vietnamese locale). An order whose `payment_method` is `"cod"` and whose `cod_amount` is `null`/`undefined` is excluded and reported, never shown as "collect ₫0".
- Consumed by: `backend/routes/adminShipping.js` (Task 10), which fetches confirmed pickup orders for one collection plus their `order_items`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/roster.test.js`:

```js
import { describe, it, expect } from "vitest"
import { buildRoster } from "../shop/shipping/roster.js"

function order(over = {}) {
  return {
    id: 1, buyer_name: "Nguyễn An", phone: "0901111111",
    payment_method: "bank", cod_amount: null,
    items: [{ product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2 }],
    ...over,
  }
}

describe("buildRoster - paid vs collect-at-handover", () => {
  it("marks a prepaid order as paid with amount_due 0", () => {
    const { rows } = buildRoster([order({ payment_method: "momo" })])
    expect(rows[0].paid).toBe(true)
    expect(rows[0].amount_due).toBe(0)
  })

  it("marks a COD order as not paid with amount_due equal to cod_amount", () => {
    const { rows } = buildRoster([order({ payment_method: "cod", cod_amount: 75000 })])
    expect(rows[0].paid).toBe(false)
    expect(rows[0].amount_due).toBe(75000)
  })

  it("excludes a COD order with a null cod_amount, never showing 'collect ₫0'", () => {
    const { rows, excluded } = buildRoster([order({ id: 7, payment_method: "cod", cod_amount: null })])
    expect(rows).toEqual([])
    expect(excluded).toEqual([{ order_id: 7, reason: "cod_missing_amount", message: expect.stringContaining("DH7") }])
  })
})

describe("buildRoster - items", () => {
  it("maps each order's item snapshots to product_name/variant_label/qty", () => {
    const { rows } = buildRoster([order({
      items: [
        { product_name_snapshot: "Photocard", variant_label_snapshot: "A1", qty: 2 },
        { product_name_snapshot: "Poster", variant_label_snapshot: "Std", qty: 1 },
      ],
    })])
    expect(rows[0].items).toEqual([
      { product_name: "Photocard", variant_label: "A1", qty: 2 },
      { product_name: "Poster", variant_label: "Std", qty: 1 },
    ])
  })

  it("gives every row an order_code derived the same way the shipping export does", () => {
    const { rows } = buildRoster([order({ id: 42 })])
    expect(rows[0].order_code).toBe("DH42")
  })
})

describe("buildRoster - sorting", () => {
  it("sorts rows by buyer_name ascending, Vietnamese-locale aware", () => {
    const { rows } = buildRoster([
      order({ id: 1, buyer_name: "Trần Văn B" }),
      order({ id: 2, buyer_name: "Ánh Dương" }),
      order({ id: 3, buyer_name: "Bùi Thị C" }),
    ])
    expect(rows.map((r) => r.buyer_name)).toEqual(["Ánh Dương", "Bùi Thị C", "Trần Văn B"])
  })
})

describe("buildRoster - empty input", () => {
  it("returns empty rows and excluded for no orders", () => {
    expect(buildRoster([])).toEqual({ rows: [], excluded: [] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- tests/roster.test.js`
Expected: FAIL - `backend/shop/shipping/roster.js` does not exist.

- [ ] **Step 3: Implement**

Create `backend/shop/shipping/roster.js`:

```js
const { orderCode } = require("./vtpMapping")

const PREPAID_METHODS = new Set(["bank", "momo", "paypal"])

/**
 * Shape already-fetched confirmed pickup orders (plus their order_items)
 * into the printable pickup roster. The whole point of this document is the
 * paid-vs-collect-at-handover distinction - a COD order with no recorded
 * cod_amount cannot be shown as "collect ₫0" (that would let a buyer walk
 * away having paid nothing, when the seller intended to charge them), so it
 * is excluded and reported instead, mirroring the export's same guard.
 */
function buildRoster(orders) {
  const rows = []
  const excluded = []

  for (const order of orders) {
    const paid = PREPAID_METHODS.has(order.payment_method)
    let amountDue = 0
    if (!paid) {
      if (order.cod_amount === null || order.cod_amount === undefined) {
        excluded.push({
          order_id: order.id, reason: "cod_missing_amount",
          message: `${orderCode(order.id)}: đơn COD nhưng chưa có số tiền thu hộ`,
        })
        continue
      }
      amountDue = order.cod_amount
    }

    rows.push({
      order_id: order.id,
      order_code: orderCode(order.id),
      buyer_name: order.buyer_name,
      phone: order.phone,
      items: (order.items || []).map((i) => ({
        product_name: i.product_name_snapshot,
        variant_label: i.variant_label_snapshot,
        qty: i.qty,
      })),
      paid,
      amount_due: amountDue,
    })
  }

  rows.sort((a, b) => a.buyer_name.localeCompare(b.buyer_name, "vi"))
  return { rows, excluded }
}

module.exports = { buildRoster }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- tests/roster.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/shop/shipping/roster.js backend/tests/roster.test.js
git commit -F - <<'EOF'
feat(shipping): add pickup-roster assembly

buildRoster() shapes confirmed pickup orders into the printable roster:
order code, buyer, phone, items handed over, and the paid-vs-collect-at-
handover distinction with the amount - the reason the document exists,
since prepaid and COD pickup orders are otherwise indistinguishable in a
queue. Sorted by buyer name, since at a booth the seller looks a person up
by name, not order code.

A COD order with no recorded cod_amount is excluded and reported rather
than shown as "collect ₫0", mirroring the same guard used in the shipping
export.
EOF
```

---

### Task 8: Admin shipping routes - export listing, payer toggle, and export generation

**Files:**
- Create: `backend/routes/adminShipping.js`
- Modify: `backend/server.js`
- Test: `backend/tests/adminShippingExport.test.js`

**Interfaces:**
- Consumes: `orderRepo.listOrders`, `orderRepo.getOrderById` (existing); `vtpMapping.LOAI_HANG_HOA_VALUES` (Task 3); `vtpWorkbook.buildExportWorkbook` (Task 5).
- Produces:
  - `GET /api/admin/shipping/export/orders` → `200 ExportOrderRow[]` - confirmed ship orders with no tracking code yet.

    `ExportOrderRow` shape: `{ id, order_code, buyer_name, phone, address_province, total, cod_amount, payment_method, shipping_payer }`
  - `PATCH /api/admin/shipping/export/orders/:id/payer` → body `{shipping_payer: "buyer" | "seller"}` → `200 {ok: true}` or `400`/`404`.
  - `POST /api/admin/shipping/export` → body `{order_ids: number[], batch: {ten_hang_hoa, trong_luong, loai_hang_hoa, thoi_gian_hen_lay}}` → `200 {file_base64, filename, exported_count, excluded}` or `400`.
  - All three behind the same `auth` middleware as every other admin route.
- Tasks 9 and 10 extend this same router file with the tracking-import and roster routes respectively.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminShippingExport.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import ExcelJS from "exceljs"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)

const buyer = {
  buyer_name: "Lê Thị Hoa", phone: "0909 888 777", email: "hoa@example.com",
  address_street: "10 Điện Biên Phủ", address_ward: "Đa Kao", address_district: "Quận 1",
  address_province: "Hồ Chí Minh", address_raw: null,
}

async function seed() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 120000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }],
    buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on all three export routes", async () => {
    expect((await request(app).get("/api/admin/shipping/export/orders")).status).toBe(401)
    expect((await request(app).patch("/api/admin/shipping/export/orders/1/payer").send({ shipping_payer: "seller" })).status).toBe(401)
    expect((await request(app).post("/api/admin/shipping/export").send({ order_ids: [1], batch: {} })).status).toBe(401)
  })
})

describe("GET /api/admin/shipping/export/orders", () => {
  it("lists a confirmed ship order with no tracking code", async () => {
    const id = await seed()
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.status).toBe(200)
    expect(res.body.find((o) => o.id === id)).toBeDefined()
    expect(res.body.find((o) => o.id === id).order_code).toBe(`DH${id}`)
  })

  it("excludes an order that already has a tracking code", async () => {
    const id = await seed()
    await orders.transitionOrder(id, "shipped", { tracking_code: "VTP-ALREADY" })
    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.body.find((o) => o.id === id)).toBeUndefined()
  })

  it("excludes a pickup order even if confirmed", async () => {
    const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 50000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const o = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank",
    })
    await orders.transitionOrder(o.id, "confirmed")

    const res = await authed(request(app).get("/api/admin/shipping/export/orders"))
    expect(res.body.find((x) => x.id === o.id)).toBeUndefined()
  })
})

describe("PATCH /api/admin/shipping/export/orders/:id/payer", () => {
  it("updates shipping_payer to seller (freeship)", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "seller" }))
    expect(res.status).toBe(200)
    const [[row]] = await db.query("SELECT shipping_payer FROM orders WHERE id = ?", [id])
    expect(row.shipping_payer).toBe("seller")
  })

  it("400s on an invalid shipping_payer value", async () => {
    const id = await seed()
    const res = await authed(request(app).patch(`/api/admin/shipping/export/orders/${id}/payer`).send({ shipping_payer: "nobody" }))
    expect(res.status).toBe(400)
  })

  it("404s for an unknown order id", async () => {
    const res = await authed(request(app).patch("/api/admin/shipping/export/orders/999999/payer").send({ shipping_payer: "seller" }))
    expect(res.status).toBe(404)
  })
})

describe("POST /api/admin/shipping/export", () => {
  const batch = { ten_hang_hoa: "Photocard", trong_luong: 50, loai_hang_hoa: "Bưu kiện", thoi_gian_hen_lay: "Cả ngày" }

  it("generates a base64 xlsx containing the requested order", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(1)
    expect(res.body.excluded).toEqual([])

    const buffer = Buffer.from(res.body.file_base64, "base64")
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const row = wb.getWorksheet("Danh sách").getRow(8)
    expect(row.getCell("B").value).toBe(`DH${id}`)
  })

  it("400s on missing order_ids", async () => {
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ batch }))
    expect(res.status).toBe(400)
  })

  it("400s on missing batch fields", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch: { ten_hang_hoa: "Photocard" } }))
    expect(res.status).toBe(400)
  })

  it("400s on an invalid loai_hang_hoa value", async () => {
    const id = await seed()
    const res = await authed(request(app).post("/api/admin/shipping/export").send({
      order_ids: [id], batch: { ...batch, loai_hang_hoa: "Không hợp lệ" },
    }))
    expect(res.status).toBe(400)
  })

  it("silently omits an order_id that is no longer eligible (raced by another admin action)", async () => {
    const id = await seed()
    await orders.transitionOrder(id, "cancelled")
    const res = await authed(request(app).post("/api/admin/shipping/export").send({ order_ids: [id], batch }))
    expect(res.status).toBe(200)
    expect(res.body.exported_count).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingExport`
Expected: FAIL - `backend/routes/adminShipping.js` does not exist, routes 404.

- [ ] **Step 3: Create the router with the export endpoints**

Create `backend/routes/adminShipping.js`:

```js
const express = require("express")
const db = require("../db")
const orders = require("../shop/orders/orderRepo")
const { LOAI_HANG_HOA_VALUES } = require("../shop/shipping/vtpMapping")
const { buildExportWorkbook } = require("../shop/shipping/vtpWorkbook")

module.exports = function adminShippingRoutes() {
  const router = express.Router()

  const oops = (res, err, where) => {
    console.error(`[ADMIN/SHIPPING] ${where}:`, err)
    res.status(500).json({ error: "server_error", message: "Lỗi server. Thử lại sau." })
  }

  // Ship orders ready to book: confirmed, ship fulfillment, no tracking code yet.
  router.get("/shipping/export/orders", async (req, res) => {
    try {
      const rows = await orders.listOrders({ status: "confirmed" })
      const eligible = rows.filter((o) => o.fulfillment_method === "ship" && !o.tracking_code)
      res.json(eligible.map((o) => ({
        id: o.id,
        order_code: `DH${o.id}`,
        buyer_name: o.buyer_name,
        phone: o.phone,
        address_province: o.address_province,
        total: o.total,
        cod_amount: o.cod_amount,
        payment_method: o.payment_method,
        shipping_payer: o.shipping_payer,
      })))
    } catch (err) { oops(res, err, "Lỗi liệt kê đơn cần xuất") }
  })

  router.patch("/shipping/export/orders/:id/payer", async (req, res) => {
    try {
      const { shipping_payer: shippingPayer } = req.body
      if (!["buyer", "seller"].includes(shippingPayer)) {
        return res.status(400).json({ error: "invalid_input", message: "shipping_payer phải là 'buyer' hoặc 'seller'" })
      }
      const [result] = await db.query(
        "UPDATE orders SET shipping_payer = ? WHERE id = ?", [shippingPayer, req.params.id]
      )
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "not_found", message: "Không tìm thấy đơn hàng" })
      }
      res.json({ ok: true })
    } catch (err) { oops(res, err, "Lỗi cập nhật người trả cước") }
  })

  router.post("/shipping/export", async (req, res) => {
    try {
      const { order_ids: orderIds, batch } = req.body
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "order_ids phải là mảng khác rỗng" })
      }
      if (!batch || !batch.ten_hang_hoa || !batch.trong_luong || !batch.loai_hang_hoa || !batch.thoi_gian_hen_lay) {
        return res.status(400).json({
          error: "invalid_input",
          message: "Thiếu thông tin lô hàng (tên hàng hóa, trọng lượng, loại hàng hóa, thời gian hẹn lấy)",
        })
      }
      if (!LOAI_HANG_HOA_VALUES.includes(batch.loai_hang_hoa)) {
        return res.status(400).json({ error: "invalid_input", message: "Loại hàng hóa không hợp lệ" })
      }

      // Re-fetch and re-check eligibility server-side rather than trusting
      // the client's snapshot - an order may have been cancelled or already
      // exported by another admin action between listing and generating.
      const ids = orderIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      const eligible = []
      for (const id of ids) {
        const order = await orders.getOrderById(id)
        if (order && order.status === "confirmed" && order.fulfillment_method === "ship" && !order.tracking_code) {
          eligible.push(order)
        }
      }

      const { buffer, exported, excluded } = await buildExportWorkbook(eligible, batch)
      res.json({
        file_base64: buffer.toString("base64"),
        filename: `vtp-xuat-don-${new Date().toISOString().slice(0, 10)}.xlsx`,
        exported_count: exported.length,
        excluded,
      })
    } catch (err) { oops(res, err, "Lỗi xuất file ViettelPost") }
  })

  return router
}
```

- [ ] **Step 4: Mount the router**

In `backend/server.js`, beside the other admin mounts (near line 238):

```js
app.use(`${API_PREFIX}/admin`, auth, require("./routes/adminShipping")())
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingExport`
Expected: PASS, 12 tests.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/adminShipping.js backend/server.js backend/tests/adminShippingExport.test.js
git commit -F - <<'EOF'
feat(shipping): expose the export listing, payer toggle, and export routes

GET /shipping/export/orders lists confirmed ship orders with no tracking
code yet. PATCH .../payer flips one order's freeship flag. POST
/shipping/export re-validates every requested order's eligibility
server-side (never trusts the client's snapshot - another admin action may
have raced it) before generating the xlsx, and returns it base64-encoded
alongside which orders were excluded and why, matching the codebase's
existing base64-transfer convention for binary payloads.

All three routes are mounted behind the existing auth middleware, matching
every other admin router.
EOF
```

---

### Task 9: Admin shipping routes - tracking-code import preview and confirm

**Files:**
- Modify: `backend/routes/adminShipping.js`
- Test: `backend/tests/adminShippingTrackingImport.test.js`

**Interfaces:**
- Consumes: `trackingImport.parsePastedText`, `trackingImport.extractPairsFromSheetRows`, `trackingImport.resolvePreview`, `trackingImport.MAX_IMPORT_ROWS` (Task 6); `orderRepo.getOrderById`, `orderRepo.transitionOrder` (existing).
- Produces:
  - `POST /api/admin/shipping/tracking-import/preview` → body `{rows_text?: string, file_base64?: string}` (exactly one provided) → `200 {toApply, skipped}` or `400`.
  - `POST /api/admin/shipping/tracking-import/confirm` → body `{rows: {order_id, order_code, tracking_code}[]}` (the `toApply` array from a prior preview call) → `200 {results: {order_id, ok, reason?, message}[]}` or `400`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminShippingTrackingImport.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const buyer = { buyer_name: "A", phone: "0900000000", email: "a@example.com", address_raw: "x" }

async function seedConfirmedOrder() {
  const cid = await catalog.createCollection({ title: "Drop", status: "active" })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 35000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "ship", payment_method: "bank",
  })
  await orders.transitionOrder(o.id, "confirmed")
  return o.id
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token on both tracking-import routes", async () => {
    expect((await request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: "DH1\tVTP1" })).status).toBe(401)
    expect((await request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [] })).status).toBe(401)
  })
})

describe("POST /api/admin/shipping/tracking-import/preview", () => {
  it("previews a pasted row for a confirmed order as ready to apply", async () => {
    const id = await seedConfirmedOrder()
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(res.status).toBe(200)
    expect(res.body.toApply).toEqual([{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-XYZ" }])
    expect(res.body.skipped).toEqual([])
  })

  it("reports an unmatched order code as skipped, not applied", async () => {
    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: "DH999999\tVTP-XYZ" })
    )
    expect(res.body.toApply).toEqual([])
    expect(res.body.skipped[0].reason).toBe("not_found")
  })

  it("400s when neither rows_text nor file_base64 is provided, or the result is empty", async () => {
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({}))
    expect(res.status).toBe(400)
  })

  it("400s when the row count exceeds MAX_IMPORT_ROWS", async () => {
    const text = Array.from({ length: 201 }, (_, i) => `DH${i}\tVTP${i}`).join("\n")
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: text }))
    expect(res.status).toBe(400)
  })

  it("idempotency: previewing the same rows again after a successful import shows nothing to apply", async () => {
    const id = await seedConfirmedOrder()
    await authed(request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` }))
    await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-XYZ" }],
    }))

    const res = await authed(
      request(app).post("/api/admin/shipping/tracking-import/preview").send({ rows_text: `DH${id}\tVTP-XYZ` })
    )
    expect(res.body.toApply).toEqual([])
    expect(res.body.skipped[0].reason).toBe("already_shipped")
  })
})

describe("POST /api/admin/shipping/tracking-import/confirm", () => {
  it("moves a confirmed order to shipped with the tracking code, via transitionOrder's state machine", async () => {
    const id = await seedConfirmedOrder()
    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [{ order_id: id, order_code: `DH${id}`, tracking_code: "VTP-ABC" }],
    }))
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([{ order_id: id, ok: true, message: expect.any(String) }])

    const [[row]] = await db.query("SELECT status, tracking_code FROM orders WHERE id = ?", [id])
    expect(row.status).toBe("shipped")
    expect(row.tracking_code).toBe("VTP-ABC")
  })

  it("per-order isolation: one order that changed status since preview does not block the rest", async () => {
    const good = await seedConfirmedOrder()
    const raced = await seedConfirmedOrder()
    await orders.transitionOrder(raced, "cancelled") // races the import between preview and confirm

    const res = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({
      rows: [
        { order_id: good, order_code: `DH${good}`, tracking_code: "VTP-GOOD" },
        { order_id: raced, order_code: `DH${raced}`, tracking_code: "VTP-RACED" },
      ],
    }))
    expect(res.status).toBe(200)
    const goodResult = res.body.results.find((r) => r.order_id === good)
    const racedResult = res.body.results.find((r) => r.order_id === raced)
    expect(goodResult.ok).toBe(true)
    expect(racedResult.ok).toBe(false)

    const [[goodRow]] = await db.query("SELECT status FROM orders WHERE id = ?", [good])
    expect(goodRow.status).toBe("shipped")
  })

  it("idempotency: confirming the same already-applied row again is a no-op that reports failure, not a duplicate email", async () => {
    const id = await seedConfirmedOrder()
    const row = { order_id: id, order_code: `DH${id}`, tracking_code: "VTP-ABC" }
    await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [row] }))

    const secondRes = await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [row] }))
    expect(secondRes.body.results[0].ok).toBe(false)

    const [[after]] = await db.query("SELECT tracking_code FROM orders WHERE id = ?", [id])
    expect(after.tracking_code).toBe("VTP-ABC") // unchanged, not overwritten a second time
  })

  it("400s on an empty or oversized rows array", async () => {
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: [] }))).status).toBe(400)
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ order_id: i, order_code: `DH${i}`, tracking_code: `V${i}` }))
    expect((await authed(request(app).post("/api/admin/shipping/tracking-import/confirm").send({ rows: tooMany }))).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingTrackingImport`
Expected: FAIL - the two routes 404.

- [ ] **Step 3: Add the tracking-import routes**

In `backend/routes/adminShipping.js`, add the require at the top:

```js
const trackingImport = require("../shop/shipping/trackingImport")
```

Then add, above `return router`:

```js
  router.post("/shipping/tracking-import/preview", async (req, res) => {
    try {
      const { rows_text: rowsText } = req.body
      const rows = typeof rowsText === "string" ? trackingImport.parsePastedText(rowsText) : []
      if (rows.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "Không có dòng dữ liệu nào để xử lý" })
      }
      if (rows.length > trackingImport.MAX_IMPORT_ROWS) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể nhập tối đa ${trackingImport.MAX_IMPORT_ROWS} dòng mỗi lần`,
        })
      }

      const orderIds = [...new Set(
        rows.map((r) => trackingImport.parseOrderCode(r.order_code)).filter((id) => id !== null)
      )]
      const ordersById = new Map()
      for (const id of orderIds) {
        const order = await orders.getOrderById(id)
        if (order) ordersById.set(id, order)
      }

      res.json(trackingImport.resolvePreview(rows, ordersById))
    } catch (err) { oops(res, err, "Lỗi xem trước nhập mã vận đơn") }
  })

  router.post("/shipping/tracking-import/confirm", async (req, res) => {
    try {
      const { rows } = req.body
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "invalid_input", message: "rows phải là mảng khác rỗng" })
      }
      if (rows.length > trackingImport.MAX_IMPORT_ROWS) {
        return res.status(400).json({
          error: "invalid_input",
          message: `Chỉ có thể nhập tối đa ${trackingImport.MAX_IMPORT_ROWS} dòng mỗi lần`,
        })
      }

      // Each row goes through transitionOrder() individually - the order
      // state machine's guards (confirmed -> shipped only), the shipped-
      // email dispatch, and the confirmed status check (expectedFromStatus)
      // all stay in force. One order's failure never stops the rest.
      const results = []
      for (const r of rows) {
        const orderId = Number(r.order_id)
        try {
          const ok = await orders.transitionOrder(orderId, "shipped", {
            tracking_code: r.tracking_code,
            expectedFromStatus: "confirmed",
          })
          results.push(ok
            ? { order_id: orderId, ok: true, message: `Đã cập nhật mã vận đơn cho DH${orderId}` }
            : {
                order_id: orderId, ok: false, reason: "not_confirmed",
                message: `DH${orderId} không còn ở trạng thái "confirmed" (đã xử lý trước đó hoặc bị thay đổi)`,
              })
        } catch (err) {
          console.error(`[ADMIN/SHIPPING] Lỗi cập nhật mã vận đơn cho đơn ${orderId}:`, err)
          results.push({ order_id: orderId, ok: false, reason: "server_error", message: "Lỗi server. Thử lại sau." })
        }
      }
      res.json({ results })
    } catch (err) { oops(res, err, "Lỗi xác nhận nhập mã vận đơn") }
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingTrackingImport`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/adminShipping.js backend/tests/adminShippingTrackingImport.test.js
git commit -F - <<'EOF'
feat(shipping): expose the tracking-code import preview/confirm routes

Preview resolves pasted rows against fetched order rows and returns
toApply/skipped without writing anything. Confirm applies exactly the rows
the preview approved (re-validated per-row against transitionOrder's own
state-machine guard via expectedFromStatus: "confirmed"), one order at a
time, so a single order that changed status between preview and confirm
never blocks the rest of the batch - the same per-order-isolation principle
as the existing admin bulk-cancel endpoint.

Nothing in this task bypasses transitionOrder: the shipped-email dispatch,
the confirmed-only guard, and the double-tracking-code-write guard all stay
in force, which is what makes a second confirm of the same row a safe no-op
rather than a duplicate email.
EOF
```

---

### Task 10: Admin shipping routes - pickup roster

**Files:**
- Modify: `backend/routes/adminShipping.js`
- Test: `backend/tests/adminShippingRoster.test.js`

**Interfaces:**
- Consumes: `roster.buildRoster` (Task 7).
- Produces:
  - `GET /api/admin/shipping/roster/:collectionId` → `200 {rows: RosterRow[], excluded}` or `400`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/adminShippingRoster.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"
import app from "../server.js"
import db from "../db.js"
import catalog from "../shop/catalogRepo.js"
import orders from "../shop/orders/orderRepo.js"
import { resetTables } from "./helpers/db.js"

const token = jwt.sign({ user: "admin" }, process.env.JWT_SECRET)
const authed = (req) => req.set("Authorization", `Bearer ${token}`)
const buyer = { buyer_name: "Phạm Thu Trang", phone: "0912345678", email: "trang@example.com", address_raw: "x" }

async function seedPickupOrder(over = {}) {
  const cid = await catalog.createCollection({ title: "Drop", status: "active", allow_pickup: true })
  const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000 })
  await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
  const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
  const o = await orders.createOrder({
    items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank", ...over,
  })
  await orders.transitionOrder(o.id, "confirmed")
  return { collectionId: cid, orderId: o.id }
}

beforeEach(async () => {
  await resetTables("order_items", "orders", "product_variants", "products", "collections")
})

describe("auth", () => {
  it("requires a token", async () => {
    expect((await request(app).get("/api/admin/shipping/roster/1")).status).toBe(401)
  })
})

describe("GET /api/admin/shipping/roster/:collectionId", () => {
  it("returns the confirmed pickup order with its items", async () => {
    const { collectionId, orderId } = await seedPickupOrder()
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(res.status).toBe(200)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].order_id).toBe(orderId)
    expect(res.body.rows[0].items[0].product_name).toBe("Card")
  })

  it("excludes a shipped-fulfillment order from a pickup roster", async () => {
    const cid = await catalog.createCollection({ title: "Drop2", status: "active" })
    const pid = await catalog.createProduct({ collection_id: cid, name: "Card", price: 40000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    const shipOrder = await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "ship", payment_method: "bank",
    })
    await orders.transitionOrder(shipOrder.id, "confirmed")

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    expect(res.body.rows).toEqual([])
  })

  it("excludes a non-confirmed pickup order", async () => {
    const { collectionId } = await seedPickupOrder()
    const cid2 = await catalog.createCollection({ title: "Drop3", status: "active", allow_pickup: true })
    const pid = await catalog.createProduct({ collection_id: cid2, name: "Card2", price: 40000 })
    await catalog.replaceVariants(pid, [{ label: "A1", stock_qty: 5 }])
    const [[v]] = await db.query("SELECT id FROM product_variants WHERE product_id = ?", [pid])
    await orders.createOrder({
      items: [{ variant_id: v.id, qty: 1 }], buyer, fulfillment_method: "pickup", payment_method: "bank",
    }) // stays pending

    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid2}`))
    expect(res.body.rows).toEqual([])
    expect(collectionId).toBeDefined() // sanity: earlier collection unaffected
  })

  it("reports a COD pickup order with a missing cod_amount as excluded, not a ₫0 row", async () => {
    const { collectionId } = await seedPickupOrder({ payment_method: "cod" })
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${collectionId}`))
    expect(res.body.rows).toEqual([])
    expect(res.body.excluded[0].reason).toBe("cod_missing_amount")
  })

  it("400s on a non-numeric collectionId", async () => {
    const res = await authed(request(app).get("/api/admin/shipping/roster/abc"))
    expect(res.status).toBe(400)
  })

  it("returns an empty roster (not an error) for a collection with no pickup orders", async () => {
    const cid = await catalog.createCollection({ title: "Empty", status: "active" })
    const res = await authed(request(app).get(`/api/admin/shipping/roster/${cid}`))
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingRoster`
Expected: FAIL - the route 404s.

- [ ] **Step 3: Add the roster route**

In `backend/routes/adminShipping.js`, add the require at the top:

```js
const { buildRoster } = require("../shop/shipping/roster")
```

Then add, above `return router`:

```js
  router.get("/shipping/roster/:collectionId", async (req, res) => {
    try {
      const collectionId = Number(req.params.collectionId)
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return res.status(400).json({ error: "invalid_input", message: "collectionId không hợp lệ" })
      }

      const [orderRows] = await db.query(
        `SELECT id, buyer_name, phone, payment_method, cod_amount
           FROM orders
          WHERE collection_id = ? AND status = 'confirmed' AND fulfillment_method = 'pickup'`,
        [collectionId]
      )

      let itemRows = []
      if (orderRows.length > 0) {
        [itemRows] = await db.query(
          `SELECT order_id, product_name_snapshot, variant_label_snapshot, qty
             FROM order_items WHERE order_id IN (?)`,
          [orderRows.map((o) => o.id)]
        )
      }

      const itemsByOrder = new Map()
      for (const item of itemRows) {
        if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, [])
        itemsByOrder.get(item.order_id).push(item)
      }
      const withItems = orderRows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] }))

      res.json(buildRoster(withItems))
    } catch (err) { oops(res, err, "Lỗi tạo danh sách nhận hàng") }
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test -- adminShippingRoster`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions. This is the last backend task in the phase - confirm the total test count grew as expected (see the test strategy's regression-suite section for the running total).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/adminShipping.js backend/tests/adminShippingRoster.test.js
git commit -F - <<'EOF'
feat(shipping): expose the pickup-roster route

GET /shipping/roster/:collectionId fetches confirmed pickup orders for one
collection plus their order_items and hands them to buildRoster() for
shaping and sorting. Non-numeric collectionId 400s; an empty result is a
normal 200 with empty rows, not an error - a collection can legitimately
have no pickup orders yet.

This is the last backend route in Plan 5 - the full shipping API surface
(export, tracking import, roster) is now complete pending the frontend
(Tasks 11-14).
EOF
```

---

### Task 11: Frontend API calls and the Vận chuyển tab shell

**Files:**
- Modify: `frontend/src/api/shop.js`
- Create: `frontend/src/components/AdminShipping.jsx`
- Modify: `frontend/src/pages/Admin.jsx`
- Test: `frontend/src/components/AdminShipping.test.jsx`

**Interfaces:**
- Produces, appended to `frontend/src/api/shop.js`:
  - `adminListShippingExportOrders()` → `GET /api/admin/shipping/export/orders`
  - `adminSetShippingPayer(id, shippingPayer)` → `PATCH /api/admin/shipping/export/orders/:id/payer`
  - `adminGenerateShippingExport(orderIds, batch)` → `POST /api/admin/shipping/export`
  - `adminPreviewTrackingImport(payload)` → `POST /api/admin/shipping/tracking-import/preview`
  - `adminConfirmTrackingImport(rows)` → `POST /api/admin/shipping/tracking-import/confirm`
  - `adminGetPickupRoster(collectionId)` → `GET /api/admin/shipping/roster/:collectionId`
- Produces `AdminShipping.jsx` default export: a tab shell switching between `ShippingExport` / `ShippingTrackingImport` / `ShippingRoster` (Tasks 12–14) via internal `view` state, defaulting to `"export"`.
- Consumed by: `Admin.jsx`, which gains a `"shipping"` tab entry ("Vận chuyển") alongside the existing seven.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/AdminShipping.test.jsx`:

```jsx
import { describe, it, expect } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("./shipping/ShippingExport", () => ({ default: () => <div data-testid="shipping-export" /> }))
vi.mock("./shipping/ShippingTrackingImport", () => ({ default: () => <div data-testid="shipping-tracking-import" /> }))
vi.mock("./shipping/ShippingRoster", () => ({ default: () => <div data-testid="shipping-roster" /> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: AdminShipping } = await import("./AdminShipping")

async function renderAdminShipping() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<AdminShipping />) })
  return container
}

describe("AdminShipping", () => {
  it("defaults to the export view", async () => {
    const container = await renderAdminShipping()
    expect(container.querySelector('[data-testid="shipping-export"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="shipping-tracking-import"]')).toBeNull()
  })

  it("switches to the tracking-import view on click", async () => {
    const container = await renderAdminShipping()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Nhập mã vận đơn")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="shipping-tracking-import"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="shipping-export"]')).toBeNull()
  })

  it("switches to the roster view on click", async () => {
    const container = await renderAdminShipping()
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Danh sách nhận hàng")
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })) })
    expect(container.querySelector('[data-testid="shipping-roster"]')).not.toBeNull()
  })
})
```

Add `import { vi } from "vitest"` alongside the other Vitest imports at the top of the file (needed by `vi.mock`):

```jsx
import { describe, it, expect, vi } from "vitest"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- AdminShipping`
Expected: FAIL - `./AdminShipping` and `./shipping/*` do not exist.

- [ ] **Step 3: Append the API calls**

In `frontend/src/api/shop.js`, append at the end of the file:

```js
// ── Shipping ──
export const adminListShippingExportOrders = () =>
  api.get("/api/admin/shipping/export/orders").then((r) => r.data)

export const adminSetShippingPayer = (id, shippingPayer) =>
  api.patch(`/api/admin/shipping/export/orders/${id}/payer`, { shipping_payer: shippingPayer }).then((r) => r.data)

export const adminGenerateShippingExport = (orderIds, batch) =>
  api.post("/api/admin/shipping/export", { order_ids: orderIds, batch }).then((r) => r.data)

export const adminPreviewTrackingImport = (payload) =>
  api.post("/api/admin/shipping/tracking-import/preview", payload).then((r) => r.data)

export const adminConfirmTrackingImport = (rows) =>
  api.post("/api/admin/shipping/tracking-import/confirm", { rows }).then((r) => r.data)

export const adminGetPickupRoster = (collectionId) =>
  api.get(`/api/admin/shipping/roster/${collectionId}`).then((r) => r.data)
```

- [ ] **Step 4: Create the tab shell and view placeholders**

Create `frontend/src/components/AdminShipping.jsx`:

```jsx
import { useState } from "react"
import ShippingExport from "./shipping/ShippingExport"
import ShippingTrackingImport from "./shipping/ShippingTrackingImport"
import ShippingRoster from "./shipping/ShippingRoster"

const VIEWS = [
  { key: "export", label: "Xuất đơn ViettelPost" },
  { key: "tracking", label: "Nhập mã vận đơn" },
  { key: "roster", label: "Danh sách nhận hàng" },
]

export default function AdminShipping() {
  const [view, setView] = useState("export")

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] ${
              view === v.key ? "bg-pink-500 text-white" : ""
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "export" && <ShippingExport />}
      {view === "tracking" && <ShippingTrackingImport />}
      {view === "roster" && <ShippingRoster />}
    </div>
  )
}
```

Create placeholder files that Tasks 12–14 replace:

`frontend/src/components/shipping/ShippingExport.jsx`:
```jsx
export default function ShippingExport() {
  return <p className="opacity-60">Đang tải…</p>
}
```

`frontend/src/components/shipping/ShippingTrackingImport.jsx`:
```jsx
export default function ShippingTrackingImport() {
  return <p className="opacity-60">Đang tải…</p>
}
```

`frontend/src/components/shipping/ShippingRoster.jsx`:
```jsx
export default function ShippingRoster() {
  return <p className="opacity-60">Đang tải…</p>
}
```

- [ ] **Step 5: Wire the tab into Admin.jsx**

In `frontend/src/pages/Admin.jsx`, add the import alongside `AdminStats`:

```js
import AdminShipping from "../components/AdminShipping"
```

Add a tab button after the "stats" button (mirroring Plan 4's Task 7, Step 5):

```jsx
            <button
              onClick={() => setTab("shipping")}
              className={`text-sm ${tab === "shipping" ? "text-pink-500 dark:text-pink-400" : "text-gray-600 dark:text-slate-500 hover:text-gray-900 dark:hover:text-slate-300"}`}
            >
              Vận chuyển
            </button>
```

Add the tab body after `{tab === "stats" && <AdminStats />}`:

```jsx
        {tab === "shipping" && <AdminShipping />}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd frontend && npm test -- AdminShipping`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/shop.js frontend/src/components/AdminShipping.jsx \
        frontend/src/components/AdminShipping.test.jsx frontend/src/components/shipping \
        frontend/src/pages/Admin.jsx
git commit -F - <<'EOF'
feat(shipping): add the Vận chuyển admin tab shell

AdminShipping.jsx switches between three placeholder views - export,
tracking-code import, pickup roster - matching the existing admin tab
pattern (Plan 4's AdminStats.jsx) exactly. The three view components are
stubs here; Tasks 12-14 replace each with its real implementation
independently.

No new i18n keys: the admin panel is hardcoded Vietnamese throughout.
EOF
```

---

### Task 12: `ShippingExport` component

**Files:**
- Modify: `frontend/src/components/shipping/ShippingExport.jsx`
- Test: `frontend/src/components/shipping/ShippingExport.test.jsx`

**Interfaces:**
- Consumes: `adminListShippingExportOrders`, `adminSetShippingPayer`, `adminGenerateShippingExport` (Task 11); `formatVnd` (existing).
- No new exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shipping/ShippingExport.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListShippingExportOrders = vi.fn()
const adminSetShippingPayer = vi.fn()
const adminGenerateShippingExport = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListShippingExportOrders: (...args) => adminListShippingExportOrders(...args),
  adminSetShippingPayer: (...args) => adminSetShippingPayer(...args),
  adminGenerateShippingExport: (...args) => adminGenerateShippingExport(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.URL.createObjectURL = vi.fn(() => "blob:mock")
globalThis.URL.revokeObjectURL = vi.fn()

const { default: ShippingExport } = await import("./ShippingExport")

function order(over = {}) {
  return {
    id: 1, order_code: "DH1", buyer_name: "Nguyễn Văn A", phone: "0901234567",
    address_province: "Hồ Chí Minh", total: 120000, cod_amount: null,
    payment_method: "bank", shipping_payer: "buyer", ...over,
  }
}

async function renderShippingExport() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingExport />) })
  return container
}

async function flush() { await act(async () => {}) }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) }) }

beforeEach(() => {
  adminListShippingExportOrders.mockReset()
  adminSetShippingPayer.mockReset()
  adminGenerateShippingExport.mockReset()
})

describe("ShippingExport", () => {
  it("shows an empty state when no orders are eligible", async () => {
    adminListShippingExportOrders.mockResolvedValue([])
    const container = await renderShippingExport()
    await flush()
    expect(container.textContent).toContain("Không có đơn nào cần xuất")
  })

  it("lists eligible orders with a checkbox each", async () => {
    adminListShippingExportOrders.mockResolvedValue([order(), order({ id: 2, order_code: "DH2" })])
    const container = await renderShippingExport()
    await flush()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(container.textContent).toContain("DH1")
    expect(container.textContent).toContain("DH2")
  })

  it("toggles freeship via adminSetShippingPayer when the freeship checkbox is clicked", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminSetShippingPayer.mockResolvedValue({ ok: true })
    const container = await renderShippingExport()
    await flush()

    const freeshipToggle = container.querySelector('[data-testid="freeship-1"]')
    await click(freeshipToggle)

    expect(adminSetShippingPayer).toHaveBeenCalledWith(1, "seller")
  })

  it("generates and triggers download of the export with the selected order and batch fields", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("fake-xlsx-bytes"), filename: "vtp-xuat-don-2026-08-08.xlsx",
      exported_count: 1, excluded: [],
    })
    const container = await renderShippingExport()
    await flush()

    const checkbox = container.querySelector('input[type="checkbox"]')
    await act(async () => {
      checkbox.checked = true
      checkbox.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const tenHangHoa = container.querySelector('[data-testid="ten-hang-hoa"]')
    await act(async () => {
      tenHangHoa.value = "Photocard"
      tenHangHoa.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const trongLuong = container.querySelector('[data-testid="trong-luong"]')
    await act(async () => {
      trongLuong.value = "50"
      trongLuong.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const thoiGian = container.querySelector('[data-testid="thoi-gian-hen-lay"]')
    await act(async () => {
      thoiGian.value = "Cả ngày"
      thoiGian.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)

    expect(adminGenerateShippingExport).toHaveBeenCalledWith(
      [1],
      expect.objectContaining({ ten_hang_hoa: "Photocard", trong_luong: 50, thoi_gian_hen_lay: "Cả ngày" })
    )
  })

  it("shows excluded orders with their reasons after generating", async () => {
    adminListShippingExportOrders.mockResolvedValue([order()])
    adminGenerateShippingExport.mockResolvedValue({
      file_base64: btoa("x"), filename: "f.xlsx", exported_count: 0,
      excluded: [{ order_id: 1, reason: "no_address", message: "DH1: không có địa chỉ nhận hàng hợp lệ" }],
    })
    const container = await renderShippingExport()
    await flush()

    const checkbox = container.querySelector('input[type="checkbox"]')
    await act(async () => {
      checkbox.checked = true
      checkbox.dispatchEvent(new Event("change", { bubbles: true }))
    })
    container.querySelector('[data-testid="ten-hang-hoa"]').value = "Photocard"
    container.querySelector('[data-testid="ten-hang-hoa"]').dispatchEvent(new Event("change", { bubbles: true }))
    container.querySelector('[data-testid="trong-luong"]').value = "50"
    container.querySelector('[data-testid="trong-luong"]').dispatchEvent(new Event("change", { bubbles: true }))
    container.querySelector('[data-testid="thoi-gian-hen-lay"]').value = "Cả ngày"
    container.querySelector('[data-testid="thoi-gian-hen-lay"]').dispatchEvent(new Event("change", { bubbles: true }))

    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xuất file")
    await click(exportButton)
    await flush()

    expect(container.textContent).toContain("không có địa chỉ nhận hàng hợp lệ")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- shipping/ShippingExport`
Expected: FAIL - the placeholder component has none of the expected markup.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/shipping/ShippingExport.jsx`:

```jsx
import { useEffect, useState } from "react"
import {
  adminListShippingExportOrders, adminSetShippingPayer, adminGenerateShippingExport,
} from "../../api/shop"
import { formatVnd } from "../../utils/money"

const LOAI_HANG_HOA_OPTIONS = ["Bưu kiện", "Tài liệu"]

// The exact 11 values from the VTP template's own "Thời gian hẹn lấy"
// reference sheet, transcribed verbatim. VTP validates this server-side on
// import, so a free-text field would let a typo produce a file that is only
// rejected at upload time, after the seller has already booked their day
// around it.
const THOI_GIAN_HEN_LAY_OPTIONS = [
  "Hôm nay - Sáng (7h30 - 12h00)",
  "Hôm nay - Chiều (13h30 - 18h00)",
  "Hôm nay - Tối (18h30 - 21h00)",
  "Ngày mai - Cả ngày",
  "Ngày mai - Sáng (7h30 - 12h00)",
  "Ngày mai - Chiều (13h30 - 18h00)",
  "Ngày mai - Tối (18h30 - 21h00)",
  "Ngày kia - Cả ngày",
  "Ngày kia - Sáng (7h30 - 12h00)",
  "Ngày kia - Chiều (13h30 - 18h00)",
  "Ngày kia - Tối (18h30 - 21h00)",
]

function downloadBase64(base64, filename) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) arr[i] = bytes.charCodeAt(i)
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ShippingExport() {
  const [orders, setOrders] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [tenHangHoa, setTenHangHoa] = useState("")
  const [trongLuong, setTrongLuong] = useState("")
  const [loaiHangHoa, setLoaiHangHoa] = useState(LOAI_HANG_HOA_OPTIONS[0])
  const [thoiGianHenLay, setThoiGianHenLay] = useState("")
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adminListShippingExportOrders().then(setOrders).catch(() => setOrders([]))
  }, [])

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleFreeship = async (order) => {
    const next = order.shipping_payer === "seller" ? "buyer" : "seller"
    try {
      await adminSetShippingPayer(order.id, next)
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, shipping_payer: next } : o)))
    } catch {
      setError("Không cập nhật được người trả cước")
    }
  }

  const generate = async () => {
    setError("")
    setResult(null)
    setBusy(true)
    try {
      const batch = {
        ten_hang_hoa: tenHangHoa,
        trong_luong: Number(trongLuong),
        loai_hang_hoa: loaiHangHoa,
        thoi_gian_hen_lay: thoiGianHenLay,
      }
      const res = await adminGenerateShippingExport([...selected], batch)
      setResult(res)
      if (res.exported_count > 0) downloadBase64(res.file_base64, res.filename)
    } catch (e) {
      setError(e.response?.data?.message || "Không xuất được file")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {orders.length === 0 && <p className="opacity-60">Không có đơn nào cần xuất.</p>}

      {orders.length > 0 && (
        <>
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="text-left opacity-70">
                <th></th>
                <th className="pr-2">Mã đơn</th>
                <th className="pr-2">Người nhận</th>
                <th className="pr-2">Tỉnh/Thành</th>
                <th className="pr-2">Giá trị</th>
                <th>Miễn phí ship</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-[var(--border-brand)]">
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggleSelected(o.id)}
                    />
                  </td>
                  <td className="pr-2 py-1">{o.order_code}</td>
                  <td className="pr-2 py-1">{o.buyer_name}</td>
                  <td className="pr-2 py-1">{o.address_province || "-"}</td>
                  <td className="pr-2 py-1">{formatVnd(o.total)}</td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      data-testid={`freeship-${o.id}`}
                      checked={o.shipping_payer === "seller"}
                      onChange={() => toggleFreeship(o)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <label className="flex flex-col text-xs gap-1">
              Tên hàng hóa
              <input data-testid="ten-hang-hoa" value={tenHangHoa} onChange={(e) => setTenHangHoa(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
            </label>
            <label className="flex flex-col text-xs gap-1">
              Trọng lượng (gram)
              <input data-testid="trong-luong" type="number" value={trongLuong} onChange={(e) => setTrongLuong(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent" />
            </label>
            <label className="flex flex-col text-xs gap-1">
              Loại hàng hóa
              <select data-testid="loai-hang-hoa" value={loaiHangHoa} onChange={(e) => setLoaiHangHoa(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {LOAI_HANG_HOA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col text-xs gap-1">
              Thời gian hẹn lấy
              <select data-testid="thoi-gian-hen-lay" value={thoiGianHenLay} onChange={(e) => setThoiGianHenLay(e.target.value)}
                className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent">
                {THOI_GIAN_HEN_LAY_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>

          <button type="button" onClick={generate} disabled={busy || selected.size === 0}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50">
            {busy ? "Đang xuất..." : "Xuất file"}
          </button>
        </>
      )}

      {error && <p className="text-red-500 mt-3">{error}</p>}

      {result && (
        <div className="mt-4 text-sm">
          <p>Đã xuất {result.exported_count} đơn.</p>
          {result.excluded.length > 0 && (
            <div className="mt-2">
              <p className="text-red-500">Bỏ qua {result.excluded.length} đơn:</p>
              <ul className="list-disc pl-5">
                {result.excluded.map((x) => (
                  <li key={x.order_id}>{x.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- shipping/ShippingExport`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipping/ShippingExport.jsx frontend/src/components/shipping/ShippingExport.test.jsx
git commit -F - <<'EOF'
feat(shipping): implement the export view component

Order picker with a per-order freeship toggle (writes shipping_payer
immediately, matching the pattern of other admin flip-a-flag actions), a
batch-fields form (tên hàng hóa, trọng lượng, loại hàng hóa, thời gian hẹn
lấy), and a generate action that decodes the base64 xlsx response into a
Blob download and shows which orders were excluded and why.

Thời gian hẹn lấy is a <select> over the 11 values transcribed verbatim
from the template's own reference sheet, not free text: VTP validates the
field server-side, so a typo would produce a file rejected only at upload
time - after the seller has planned their day around that pickup slot.
EOF
```

---

### Task 13: `ShippingTrackingImport` component

**Files:**
- Modify: `frontend/src/components/shipping/ShippingTrackingImport.jsx`
- Test: `frontend/src/components/shipping/ShippingTrackingImport.test.jsx`

**Interfaces:**
- Consumes: `adminPreviewTrackingImport`, `adminConfirmTrackingImport` (Task 11).
- No new exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shipping/ShippingTrackingImport.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminPreviewTrackingImport = vi.fn()
const adminConfirmTrackingImport = vi.fn()

vi.mock("../../api/shop", () => ({
  adminPreviewTrackingImport: (...args) => adminPreviewTrackingImport(...args),
  adminConfirmTrackingImport: (...args) => adminConfirmTrackingImport(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ShippingTrackingImport } = await import("./ShippingTrackingImport")

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingTrackingImport />) })
  return container
}
async function flush() { await act(async () => {}) }
async function click(el) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })) }) }

beforeEach(() => {
  adminPreviewTrackingImport.mockReset()
  adminConfirmTrackingImport.mockReset()
})

describe("ShippingTrackingImport", () => {
  it("shows a preview of toApply and skipped rows after pasting text and clicking 'Xem trước'", async () => {
    adminPreviewTrackingImport.mockResolvedValue({
      toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }],
      skipped: [{ order_code: "DH999", tracking_code: "VTP002", reason: "not_found", message: "Không tìm thấy đơn DH999" }],
    })
    const container = await renderComponent()

    const textarea = container.querySelector("textarea")
    await act(async () => {
      textarea.value = "DH1\tVTP001\nDH999\tVTP002"
      textarea.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const previewButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước")
    await click(previewButton)
    await flush()

    expect(container.textContent).toContain("DH1")
    expect(container.textContent).toContain("VTP001")
    expect(container.textContent).toContain("Không tìm thấy đơn DH999")
  })

  it("does not write anything until 'Xác nhận' is clicked (no confirm call on preview alone)", async () => {
    adminPreviewTrackingImport.mockResolvedValue({ toApply: [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }], skipped: [] })
    const container = await renderComponent()
    container.querySelector("textarea").value = "DH1\tVTP001"
    container.querySelector("textarea").dispatchEvent(new Event("change", { bubbles: true }))
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước"))
    await flush()

    expect(adminConfirmTrackingImport).not.toHaveBeenCalled()
  })

  it("calls confirm with exactly the previewed toApply rows and shows per-order results", async () => {
    const toApply = [{ order_id: 1, order_code: "DH1", tracking_code: "VTP001" }]
    adminPreviewTrackingImport.mockResolvedValue({ toApply, skipped: [] })
    adminConfirmTrackingImport.mockResolvedValue({ results: [{ order_id: 1, ok: true, message: "Đã cập nhật mã vận đơn cho DH1" }] })

    const container = await renderComponent()
    container.querySelector("textarea").value = "DH1\tVTP001"
    container.querySelector("textarea").dispatchEvent(new Event("change", { bubbles: true }))
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước"))
    await flush()

    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Xác nhận")
    await click(confirmButton)
    await flush()

    expect(adminConfirmTrackingImport).toHaveBeenCalledWith(toApply)
    expect(container.textContent).toContain("Đã cập nhật mã vận đơn cho DH1")
  })

  it("shows an empty-preview state when toApply is empty", async () => {
    adminPreviewTrackingImport.mockResolvedValue({ toApply: [], skipped: [] })
    const container = await renderComponent()
    container.querySelector("textarea").value = "garbage"
    container.querySelector("textarea").dispatchEvent(new Event("change", { bubbles: true }))
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Xem trước"))
    await flush()

    expect(container.textContent).toContain("Không có đơn nào để áp dụng")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- shipping/ShippingTrackingImport`
Expected: FAIL - the placeholder component has no textarea or buttons.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/shipping/ShippingTrackingImport.jsx`:

```jsx
import { useState } from "react"
import { adminPreviewTrackingImport, adminConfirmTrackingImport } from "../../api/shop"

export default function ShippingTrackingImport() {
  const [rowsText, setRowsText] = useState("")
  const [preview, setPreview] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const loadPreview = async () => {
    setError("")
    setResults(null)
    setBusy(true)
    try {
      setPreview(await adminPreviewTrackingImport({ rows_text: rowsText }))
    } catch (e) {
      setPreview(null)
      setError(e.response?.data?.message || "Không xem trước được")
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview || preview.toApply.length === 0) return
    setError("")
    setBusy(true)
    try {
      const res = await adminConfirmTrackingImport(preview.toApply)
      setResults(res.results)
    } catch (e) {
      setError(e.response?.data?.message || "Không xác nhận được")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm opacity-70 mb-2">
        Dán các dòng "Mã đơn hàng &lt;tab hoặc phẩy&gt; Mã vận đơn" từ file kết quả ViettelPost.
      </p>
      <textarea
        rows={6}
        value={rowsText}
        onChange={(e) => setRowsText(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent mb-3"
      />
      <button type="button" onClick={loadPreview} disabled={busy || !rowsText.trim()}
        className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50 mr-2">
        {busy ? "Đang xử lý..." : "Xem trước"}
      </button>

      {error && <p className="text-red-500 mt-3">{error}</p>}

      {preview && (
        <div className="mt-4 text-sm">
          {preview.toApply.length === 0
            ? <p className="opacity-60">Không có đơn nào để áp dụng.</p>
            : (
              <>
                <p className="mb-2">Sẽ cập nhật {preview.toApply.length} đơn:</p>
                <table className="w-full mb-3">
                  <thead>
                    <tr className="text-left opacity-70"><th className="pr-2">Mã đơn</th><th>Mã vận đơn</th></tr>
                  </thead>
                  <tbody>
                    {preview.toApply.map((r) => (
                      <tr key={r.order_id}><td className="pr-2">{r.order_code}</td><td>{r.tracking_code}</td></tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" onClick={confirm} disabled={busy}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)] disabled:opacity-50">
                  {busy ? "Đang xác nhận..." : "Xác nhận"}
                </button>
              </>
            )}

          {preview.skipped.length > 0 && (
            <div className="mt-3">
              <p className="text-red-500">Bỏ qua {preview.skipped.length} dòng:</p>
              <ul className="list-disc pl-5">
                {preview.skipped.map((s, i) => <li key={`${s.order_code}-${i}`}>{s.message}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {results && (
        <div className="mt-4 text-sm">
          <p className="mb-2">Kết quả:</p>
          <ul className="list-disc pl-5">
            {results.map((r) => (
              <li key={r.order_id} className={r.ok ? "" : "text-red-500"}>{r.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- shipping/ShippingTrackingImport`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shipping/ShippingTrackingImport.jsx frontend/src/components/shipping/ShippingTrackingImport.test.jsx
git commit -F - <<'EOF'
feat(shipping): implement the tracking-code import view with preview

Paste rows -> "Xem trước" calls the preview endpoint and renders toApply
(what will change) and skipped (with a reason each) without writing
anything. "Xác nhận" sends exactly the previewed toApply rows to the
confirm endpoint and shows per-order results, never a blanket success
message - the failure this prevents is half the rows silently failing to
match while the seller believes every buyer was notified.
EOF
```

---

### Task 14: `ShippingRoster` component

**Files:**
- Modify: `frontend/src/components/shipping/ShippingRoster.jsx`
- Test: `frontend/src/components/shipping/ShippingRoster.test.jsx`

**Interfaces:**
- Consumes: `adminListCollections` (existing), `adminGetPickupRoster` (Task 11); `formatVnd` (existing).
- No new exports consumed by later tasks - last task in the plan.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shipping/ShippingRoster.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"

const adminListCollections = vi.fn()
const adminGetPickupRoster = vi.fn()

vi.mock("../../api/shop", () => ({
  adminListCollections: (...args) => adminListCollections(...args),
  adminGetPickupRoster: (...args) => adminGetPickupRoster(...args),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { default: ShippingRoster } = await import("./ShippingRoster")

function setSelectValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set
  setter.call(el, value)
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

async function renderComponent() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<ShippingRoster />) })
  return container
}
async function flush() { await act(async () => {}) }

beforeEach(() => {
  adminListCollections.mockReset()
  adminGetPickupRoster.mockReset()
  adminListCollections.mockResolvedValue([{ id: 1, title: "Drop" }])
})

describe("ShippingRoster", () => {
  it("prompts to choose a collection before any is selected", async () => {
    const container = await renderComponent()
    await flush()
    expect(container.textContent).toContain("Chọn một bộ sưu tập")
    expect(adminGetPickupRoster).not.toHaveBeenCalled()
  })

  it("renders one row per pickup order with items and paid/collect amount, sorted as returned", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [
        {
          order_id: 1, order_code: "DH1", buyer_name: "Ánh Dương", phone: "0900000001",
          items: [{ product_name: "Photocard", variant_label: "A1", qty: 2 }], paid: true, amount_due: 0,
        },
        {
          order_id: 2, order_code: "DH2", buyer_name: "Trần Văn B", phone: "0900000002",
          items: [{ product_name: "Poster", variant_label: "Std", qty: 1 }], paid: false, amount_due: 75000,
        },
      ],
      excluded: [],
    })
    const container = await renderComponent()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const rows = container.querySelectorAll("tbody tr")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("Ánh Dương")
    expect(rows[0].textContent).toContain("Đã thanh toán")
    expect(rows[1].textContent).toContain("75.000₫")
  })

  it("shows excluded orders with their reason", async () => {
    adminGetPickupRoster.mockResolvedValue({
      rows: [],
      excluded: [{ order_id: 5, reason: "cod_missing_amount", message: "DH5: đơn COD nhưng chưa có số tiền thu hộ" }],
    })
    const container = await renderComponent()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    expect(container.textContent).toContain("đơn COD nhưng chưa có số tiền thu hộ")
  })

  it("has a print button", async () => {
    adminGetPickupRoster.mockResolvedValue({ rows: [], excluded: [] })
    const container = await renderComponent()
    await flush()
    setSelectValue(container.querySelector("select"), "1")
    await flush()

    const printButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "In")
    expect(printButton).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- shipping/ShippingRoster`
Expected: FAIL - the placeholder component has no select, no table.

- [ ] **Step 3: Implement the component**

Replace `frontend/src/components/shipping/ShippingRoster.jsx`:

```jsx
import { useEffect, useState } from "react"
import { adminListCollections, adminGetPickupRoster } from "../../api/shop"
import { formatVnd } from "../../utils/money"

export default function ShippingRoster() {
  const [collections, setCollections] = useState([])
  const [collectionId, setCollectionId] = useState("")
  const [roster, setRoster] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    adminListCollections().then(setCollections).catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    if (!collectionId) { setRoster(null); return }
    setError("")
    adminGetPickupRoster(collectionId).then(setRoster).catch(() => {
      setRoster(null)
      setError("Không tải được danh sách nhận hàng")
    })
  }, [collectionId])

  return (
    <div>
      <div className="flex items-end gap-3 mb-4 flex-wrap print:hidden">
        <label className="flex flex-col text-xs gap-1 max-w-xs">
          Bộ sưu tập
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="px-2 py-1 rounded-lg border border-[var(--border-brand)] bg-transparent"
          >
            <option value="">- Chọn một bộ sưu tập -</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        {roster && (
          <button type="button" onClick={() => window.print()}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)]">
            In
          </button>
        )}
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {!collectionId && <p className="opacity-60">Chọn một bộ sưu tập để xem danh sách nhận hàng.</p>}

      {roster && (
        <>
          {roster.excluded.length > 0 && (
            <div className="mb-4 print:hidden">
              <p className="text-red-500">Bỏ qua {roster.excluded.length} đơn:</p>
              <ul className="list-disc pl-5 text-sm">
                {roster.excluded.map((x) => <li key={x.order_id}>{x.message}</li>)}
              </ul>
            </div>
          )}

          {roster.rows.length === 0
            ? <p className="opacity-60">Không có đơn nhận tại chỗ nào đã xác nhận trong bộ sưu tập này.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left opacity-70">
                      <th className="pr-2">✓</th>
                      <th className="pr-2">Mã đơn</th>
                      <th className="pr-2">Người nhận</th>
                      <th className="pr-2">SĐT</th>
                      <th className="pr-2">Sản phẩm</th>
                      <th className="pr-2">Thanh toán</th>
                      <th>Số tiền cần thu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.rows.map((r) => (
                      <tr key={r.order_id} className="border-t border-[var(--border-brand)]">
                        <td className="pr-2 py-1">☐</td>
                        <td className="pr-2 py-1">{r.order_code}</td>
                        <td className="pr-2 py-1">{r.buyer_name}</td>
                        <td className="pr-2 py-1">{r.phone}</td>
                        <td className="pr-2 py-1">
                          {r.items.map((i) => `${i.product_name} (${i.variant_label}) x${i.qty}`).join(", ")}
                        </td>
                        <td className="pr-2 py-1">{r.paid ? "Đã thanh toán" : "Thu khi giao"}</td>
                        <td className="py-1">{r.paid ? "-" : formatVnd(r.amount_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm test -- shipping/ShippingRoster`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full frontend suite, build, and lint**

Run:
```bash
cd frontend && npm test && npm run build && npm run lint
```
Expected: `npm test` PASS with no regressions. `npm run build` succeeds. `npm run lint` shows exactly the 3 pre-existing problems noted in Global Constraints - no new errors from any file this plan touched.

- [ ] **Step 6: Run the full backend suite one final time**

Run: `cd backend && DB_PORT=3307 DB_PASS=root REDIS_PORT=6380 npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/shipping/ShippingRoster.jsx frontend/src/components/shipping/ShippingRoster.test.jsx
git commit -F - <<'EOF'
feat(shipping): implement the printable pickup-roster view

Collection picker driving getPickupRoster, sorted by buyer name (the seller
looks a person up by name at a booth, not by order code). Each row shows
what to hand over and, distinctly, "Đã thanh toán" vs "Thu khi giao" with
the amount - the reason this document exists, since prepaid and COD pickup
orders are otherwise indistinguishable in a queue. "In" triggers the
browser's own print dialog; the picker and buttons are hidden via
print:hidden so only the roster table prints.

This is the last task in Plan 5 - the full Vận chuyển tab (export, tracking
import, roster) is now feature-complete pending manual acceptance per
2026-08-08-merch-shop-5-verification.md.
EOF
```
