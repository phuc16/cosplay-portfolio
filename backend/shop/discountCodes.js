const db = require("../db")

const TYPES = ["percent", "fixed"]

/**
 * Shared buyer-facing wording for every reason a code can fail, so the
 * locking createOrder path and the non-locking public preview endpoint
 * never drift apart on what they tell the buyer.
 */
const REASON_MESSAGES = {
  not_found: "Mã giảm giá không tồn tại",
  disabled: "Mã giảm giá đã bị vô hiệu hóa",
  expired: "Mã giảm giá đã hết hạn",
  exhausted: "Mã giảm giá đã hết lượt sử dụng",
  below_minimum: "Đơn hàng chưa đạt mức tối thiểu để áp dụng mã này",
}

/** Codes are matched case-insensitively - normalize to uppercase on both write and lookup. */
function normalizeCode(code) {
  return String(code ?? "").trim().toUpperCase()
}

function computeRawAmount(row, subtotal) {
  if (row.type === "percent") return Math.floor((subtotal * row.value) / 100)
  return row.value
}

/**
 * Pure evaluation against an already-fetched row - no DB access, so this can
 * be shared by both the locking createOrder path and the non-locking public
 * preview endpoint without the two ever disagreeing about what's valid.
 * `now` is injectable for tests.
 *
 * Returns { ok: true, amount } or { ok: false, reason }.
 */
function evaluateCode(row, subtotal, now = new Date()) {
  if (!row) return { ok: false, reason: "not_found" }
  if (!row.enabled) return { ok: false, reason: "disabled" }
  if (row.expires_at && new Date(row.expires_at) <= now) return { ok: false, reason: "expired" }
  if (row.max_uses !== null && row.max_uses !== undefined && row.used_count >= row.max_uses) {
    return { ok: false, reason: "exhausted" }
  }
  if (subtotal < row.min_total) return { ok: false, reason: "below_minimum" }
  // Clamped so the final total can never go negative - a 100%-off or large
  // fixed-amount code can legitimately bring the order to exactly 0đ. This
  // is an accepted edge case (see the discount-codes design doc), not
  // specially guarded against beyond this clamp.
  const amount = Math.max(0, Math.min(computeRawAmount(row, subtotal), subtotal))
  return { ok: true, amount }
}

/** Validates an admin-submitted create/update payload. Returns an error message, or null when valid. */
function validate(data) {
  const code = normalizeCode(data.code)
  if (!code) return "Cần mã giảm giá"
  if (code.length > 64) return "Mã giảm giá tối đa 64 ký tự"
  if (!TYPES.includes(data.type)) return "Loại giảm giá không hợp lệ"
  if (!Number.isInteger(data.value) || data.value <= 0) return "Giá trị giảm giá phải là số nguyên dương"
  if (data.type === "percent" && data.value > 100) return "Phần trăm giảm giá tối đa 100"
  if (
    data.max_uses !== null && data.max_uses !== undefined && data.max_uses !== "" &&
    (!Number.isInteger(data.max_uses) || data.max_uses <= 0)
  ) {
    return "Số lượt sử dụng tối đa phải là số nguyên dương"
  }
  if (data.min_total !== undefined && data.min_total !== null && (!Number.isInteger(data.min_total) || data.min_total < 0)) {
    return "Mức đơn tối thiểu phải là số nguyên không âm"
  }
  if (data.expires_at) {
    const d = new Date(data.expires_at)
    if (Number.isNaN(d.getTime())) return "Ngày hết hạn không hợp lệ"
  }
  return null
}

function normalizeRow(row) {
  return { ...row, enabled: Boolean(row.enabled) }
}

async function listCodes() {
  const [rows] = await db.query("SELECT * FROM discount_codes ORDER BY created_at DESC, id DESC")
  return rows.map(normalizeRow)
}

async function getCodeById(id) {
  const [[row]] = await db.query("SELECT * FROM discount_codes WHERE id = ? LIMIT 1", [id])
  return row ? normalizeRow(row) : null
}

/** Distinct from a generic validation failure - the unique index rejected a code that (case-insensitively) already exists. */
class DuplicateCodeError extends Error {
  constructor() {
    super("Mã giảm giá này đã tồn tại")
    this.name = "DuplicateCodeError"
  }
}

async function createCode(data) {
  const code = normalizeCode(data.code)
  try {
    const [res] = await db.query(
      `INSERT INTO discount_codes (code, type, value, enabled, max_uses, min_total, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code, data.type, data.value, data.enabled !== false,
        data.max_uses === "" || data.max_uses === undefined ? null : data.max_uses,
        data.min_total || 0,
        data.expires_at || null,
      ]
    )
    return getCodeById(res.insertId)
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new DuplicateCodeError()
    throw err
  }
}

async function updateCode(id, data) {
  const code = normalizeCode(data.code)
  try {
    const [res] = await db.query(
      `UPDATE discount_codes
          SET code = ?, type = ?, value = ?, enabled = ?, max_uses = ?, min_total = ?, expires_at = ?, updated_at = NOW()
        WHERE id = ?`,
      [
        code, data.type, data.value, data.enabled !== false,
        data.max_uses === "" || data.max_uses === undefined ? null : data.max_uses,
        data.min_total || 0,
        data.expires_at || null,
        id,
      ]
    )
    if (res.affectedRows === 0) return null
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new DuplicateCodeError()
    throw err
  }
  return getCodeById(id)
}

async function deleteCode(id) {
  // Deliberately no guard of any kind - discount_codes has no relationship
  // to orders (snapshot-based, see the design doc's scope decisions), so
  // there is nothing that could be left orphaned by deleting one.
  const [res] = await db.query("DELETE FROM discount_codes WHERE id = ?", [id])
  return res.affectedRows > 0
}

/**
 * Non-locking read for the public preview endpoint - never increments
 * used_count, never holds a row lock. createOrder does its own locked
 * lookup directly against the table; this is not reused there.
 */
async function previewCode(code, subtotal, now = new Date()) {
  const normalized = normalizeCode(code)
  if (!normalized) return { ok: false, reason: "not_found" }
  const [[row]] = await db.query("SELECT * FROM discount_codes WHERE code = ? LIMIT 1", [normalized])
  return { ...evaluateCode(row, subtotal, now), row: row || null }
}

module.exports = {
  normalizeCode,
  evaluateCode,
  REASON_MESSAGES,
  validate,
  listCodes,
  getCodeById,
  createCode,
  updateCode,
  deleteCode,
  previewCode,
  DuplicateCodeError,
}
