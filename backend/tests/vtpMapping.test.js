import { describe, it, expect } from "vitest"
import {
  resolveCod, selectPayer, mapOrderToRow, PAYER_BUYER, PAYER_SELLER,
  SERVICE_INTRA_HCM, SERVICE_INTER_PROVINCE, LOAI_HANG_HOA_VALUES,
} from "../shop/shipping/vtpMapping.js"
import { formatOrderCode } from "../shop/orders/domain.js"

const CREATED_AT = "2026-08-14T00:00:00Z"

function baseOrder(over = {}) {
  return {
    id: 42,
    created_at: CREATED_AT,
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

  it("returns 0 (not an error) for a COD order collecting zero - a legitimate zero-collection instruction, distinct from null (export error)", () => {
    // Zero is intentionally collected money (perhaps a return or reversal).
    // Null/undefined is a missing field (export error). If this were a falsy check
    // instead of strict null/undefined, zero would wrongly be treated as missing data.
    const result = resolveCod({ payment_method: "cod", cod_amount: 0 })
    expect(result).toEqual({ ok: true, value: 0 })
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
      B: formatOrderCode(42, CREATED_AT),
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
      B: formatOrderCode(42, CREATED_AT),
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
