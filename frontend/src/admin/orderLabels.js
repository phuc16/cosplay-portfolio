/**
 * The single source of Vietnamese labels for order status, payment method,
 * fulfilment method, and admin action buttons. The admin panel is
 * hardcoded Vietnamese (unlike the bilingual shop, which uses
 * frontend/src/i18n/translations.js) — this module is that hardcoding's
 * one place, so the orders list and the statistics page cannot drift
 * apart on wording. STATUS_LABELS previously lived only in StatsDrop.jsx.
 */
export const STATUS_LABELS = {
  pending: "Chờ xử lý",
  confirmed: "Đã xác nhận",
  shipped: "Đã gửi",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
}

export const PAYMENT_METHOD_LABELS = {
  bank: "Chuyển khoản",
  momo: "Momo",
  paypal: "PayPal",
  cod: "COD",
}

export const FULFILLMENT_METHOD_LABELS = {
  ship: "Giao hàng",
  pickup: "Nhận tại chỗ",
}

export const ACTION_LABELS = {
  confirmed: "Xác nhận",
  shipped: "Đã gửi",
  completed: "Hoàn tất",
  cancelled: "Hủy",
}

/**
 * Looks up `key` in `map`, falling back to the raw `key` itself when
 * absent. Required so an order in a status this module doesn't yet know
 * about renders that raw value rather than "undefined" or nothing —
 * an unknown status must look wrong, never invisible.
 */
export function labelFor(map, key) {
  return map[key] || key
}
