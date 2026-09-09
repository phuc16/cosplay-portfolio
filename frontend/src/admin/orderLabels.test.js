import { describe, it, expect } from "vitest"
import {
  STATUS_LABELS, PAYMENT_METHOD_LABELS, FULFILLMENT_METHOD_LABELS, ACTION_LABELS, labelFor,
} from "./orderLabels"

describe("STATUS_LABELS", () => {
  it("has the correct Vietnamese label for every status in the enum", () => {
    expect(STATUS_LABELS).toEqual({
      pending: "Chờ xử lý",
      confirmed: "Đã xác nhận",
      shipped: "Đã gửi",
      completed: "Hoàn tất",
      cancelled: "Đã hủy",
    })
  })
})

describe("PAYMENT_METHOD_LABELS", () => {
  it("labels every payment method the shop offers", () => {
    expect(PAYMENT_METHOD_LABELS).toEqual({
      bank: "Chuyển khoản", momo: "Momo", paypal: "PayPal", cod: "COD",
    })
  })
})

describe("FULFILLMENT_METHOD_LABELS", () => {
  it("labels ship, pickup, and digital", () => {
    expect(FULFILLMENT_METHOD_LABELS).toEqual({ ship: "Giao hàng", pickup: "Nhận tại chỗ", digital: "Sản phẩm số" })
  })
})

describe("ACTION_LABELS", () => {
  it("labels every transition target an action button can render", () => {
    expect(ACTION_LABELS).toEqual({
      confirmed: "Xác nhận", shipped: "Đã gửi", completed: "Hoàn tất", cancelled: "Hủy",
    })
  })
})

describe("labelFor", () => {
  it("returns the mapped label for a known key", () => {
    expect(labelFor(STATUS_LABELS, "pending")).toBe("Chờ xử lý")
  })

  it("falls back to the raw key for an unknown one, never returning blank", () => {
    expect(labelFor(STATUS_LABELS, "some_future_status")).toBe("some_future_status")
  })

  it("falls back to the raw key for payment methods too", () => {
    expect(labelFor(PAYMENT_METHOD_LABELS, "zalopay")).toBe("zalopay")
  })
})
