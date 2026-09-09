/** Format an integer VND amount, e.g. 35000 -> "35.000₫". */
export function formatVnd(n) {
  const value = Number(n) || 0
  return `${value.toLocaleString("vi-VN")}₫`
}
