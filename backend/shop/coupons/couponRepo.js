const db = require("./../../db")

class InvalidCouponInputError extends Error {
  constructor(message) {
    super(message)
    this.name = "InvalidCouponInputError"
  }
}

class DuplicateCouponCodeError extends Error {
  constructor(code) {
    super(`Mã "${code}" đã tồn tại`)
    this.name = "DuplicateCouponCodeError"
  }
}

const normalizeCode = (code) => String(code || "").trim().toUpperCase()

function validateShape(data) {
  if (!normalizeCode(data.code)) return "Cần nhập mã giảm giá"
  if (!["percent", "fixed"].includes(data.type)) return "Loại giảm giá không hợp lệ"
  const value = Number(data.value)
  if (!Number.isInteger(value) || value <= 0) return "Giá trị giảm giá không hợp lệ"
  if (data.type === "percent" && value > 100) return "Giảm theo % không được vượt quá 100"
  if (data.min_total !== undefined && (!Number.isInteger(Number(data.min_total)) || Number(data.min_total) < 0)) {
    return "Mức đơn tối thiểu phải là số nguyên không âm"
  }
  if (data.max_uses !== undefined && data.max_uses !== null && (!Number.isInteger(Number(data.max_uses)) || Number(data.max_uses) <= 0)) {
    return "Số lượt dùng tối đa phải là số nguyên dương"
  }
  return null
}

async function listCoupons() {
  const [rows] = await db.query("SELECT * FROM coupons ORDER BY id DESC")
  return rows
}

async function getCouponByCode(code) {
  const [[row]] = await db.query("SELECT * FROM coupons WHERE code = ? LIMIT 1", [normalizeCode(code)])
  return row || null
}

async function createCoupon(data) {
  const invalid = validateShape(data)
  if (invalid) throw new InvalidCouponInputError(invalid)

  const code = normalizeCode(data.code)
  try {
    const [res] = await db.query(
      `INSERT INTO coupons (code, type, value, active, min_total, max_uses, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        data.type,
        Number(data.value),
        data.active === undefined ? true : Boolean(data.active),
        Number(data.min_total) || 0,
        data.max_uses === undefined || data.max_uses === null || data.max_uses === "" ? null : Number(data.max_uses),
        data.expires_at || null,
      ]
    )
    return res.insertId
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new DuplicateCouponCodeError(code)
    throw err
  }
}

async function updateCoupon(id, data) {
  // A partial update - only fields actually present in data are validated/
  // changed, so flipping just `active` doesn't require re-sending the whole
  // shape. code/type/value are only re-validated when present.
  const merged = { ...data }
  if (merged.type !== undefined || merged.value !== undefined || merged.code !== undefined) {
    const [[existing]] = await db.query("SELECT * FROM coupons WHERE id = ?", [id])
    if (!existing) throw new InvalidCouponInputError("Không tìm thấy mã giảm giá")
    const invalid = validateShape({ ...existing, ...merged })
    if (invalid) throw new InvalidCouponInputError(invalid)
  }

  const fields = []
  const values = []
  for (const key of ["code", "type", "value", "active", "min_total", "max_uses", "expires_at"]) {
    if (data[key] === undefined) continue
    fields.push(`${key} = ?`)
    if (key === "code") values.push(normalizeCode(data.code))
    else if (key === "active") values.push(Boolean(data.active))
    else if (key === "max_uses") values.push(data.max_uses === null || data.max_uses === "" ? null : Number(data.max_uses))
    else if (key === "expires_at") values.push(data.expires_at || null)
    else values.push(Number(data[key]))
  }
  if (fields.length === 0) return

  values.push(id)
  try {
    await db.query(`UPDATE coupons SET ${fields.join(", ")} WHERE id = ?`, values)
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new DuplicateCouponCodeError(normalizeCode(data.code))
    throw err
  }
}

/**
 * Pure eligibility check - shared by createOrder (Task 3, under a row lock)
 * and the public preview route (an unlocked read), so the two can never
 * drift out of sync on what counts as valid. `coupon` may be null/undefined
 * (caller's lookup found nothing) - reported as "not_found" here rather than
 * requiring every caller to special-case it separately.
 */
function checkEligibility(coupon, subtotal, now = new Date()) {
  if (!coupon) return { ok: false, reason: "not_found" }
  if (!coupon.active) return { ok: false, reason: "inactive" }
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) return { ok: false, reason: "expired" }
  if (coupon.max_uses !== null && coupon.times_used >= coupon.max_uses) return { ok: false, reason: "limit_reached" }
  if (subtotal < coupon.min_total) return { ok: false, reason: "min_total_not_met" }
  return { ok: true }
}

/** Clamped to [0, subtotal] - a coupon can never make an order's paid total negative. */
function computeDiscount(coupon, subtotal) {
  const raw = coupon.type === "percent"
    ? Math.floor((subtotal * coupon.value) / 100)
    : coupon.value
  return Math.max(0, Math.min(raw, subtotal))
}

module.exports = {
  listCoupons,
  getCouponByCode,
  createCoupon,
  updateCoupon,
  checkEligibility,
  computeDiscount,
  normalizeCode,
  InvalidCouponInputError,
  DuplicateCouponCodeError,
}
