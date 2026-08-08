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

  // Finding 1: "Đường Hồ Chí Minh" is a real highway running through many
  // non-HCM provinces (Nghệ An, Kon Tum, Đắk Lắk, Hòa Bình, Thanh Hóa,
  // Bình Phước…). Substring matching would false-positive on it and route
  // an undeliverable parcel to the intra-city service.
  it("is false for a highway name containing the HCM substring", () => {
    expect(isHoChiMinh("Đường Hồ Chí Minh")).toBe(false)
    expect(isHoChiMinh("duong Ho Chi Minh")).toBe(false)
  })

  it("routes the highway name to the inter-province service, not intra-HCM", () => {
    expect(selectService("Đường Hồ Chí Minh")).toBe(SERVICE_INTER_PROVINCE)
  })

  const hcmFullSpellings = [
    "Thành phố Hồ Chí Minh", "TP.HCM", "TP HCM", "Hồ Chí Minh", "HCM",
    "Sài Gòn", "Thành phố Hồ Chí Minh ",
  ]
  for (const variant of hcmFullSpellings) {
    it(`still recognises "${variant}" as Ho Chi Minh City after the equality fix`, () => {
      expect(isHoChiMinh(variant)).toBe(true)
    })
  }

  // Regression fix: accept HCMC as English abbreviation and handle trailing punctuation
  const regressionFixedCases = [
    "HCMC",
    "hcmc",
    "Hồ Chí Minh.",
    "Hồ Chí Minh ,",
    "TP.HCMC",
  ]
  for (const variant of regressionFixedCases) {
    it(`recognises "${variant}" as Ho Chi Minh City (regression fix)`, () => {
      expect(isHoChiMinh(variant)).toBe(true)
    })
  }

  // Verify that trailing punctuation trimming does not rescue a non-match into a match
  it("is false for highway name with trailing punctuation", () => {
    expect(isHoChiMinh("Đường Hồ Chí Minh.")).toBe(false)
  })
})

describe("service string constants", () => {
  // Finding 2: pin the constants against hardcoded literals, byte-exact,
  // so a typo introduced into the definition itself (not just a call site)
  // still fails a test. These strings must match ViettelPost's import
  // template exactly or the upload is rejected.
  it("SERVICE_INTRA_HCM matches the ViettelPost template byte-exact", () => {
    expect(SERVICE_INTRA_HCM).toBe("PHS - Nội tỉnh tiết kiệm thỏa thuận")
  })

  it("SERVICE_INTER_PROVINCE matches the ViettelPost template byte-exact", () => {
    expect(SERVICE_INTER_PROVINCE).toBe("VTK - CP tiết kiệm thỏa thuận")
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
