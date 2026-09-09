/**
 * Single source of Vietnamese labels for order status/payment/fulfilment/
 * action buttons - the admin panel is hardcoded Vietnamese (unlike the
 * bilingual shop's i18n/translations.js), so this keeps the orders list and
 * stats page from drifting apart on wording.
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
  digital: "Sản phẩm số",
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
 * about renders that raw value rather than "undefined" or nothing -
 * an unknown status must look wrong, never invisible.
 */
export function labelFor(map, key) {
  return map[key] || key
}
