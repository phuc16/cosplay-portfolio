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
