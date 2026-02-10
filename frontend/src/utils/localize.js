/**
 * Lấy giá trị đã localize từ config.
 * Hỗ trợ backward: nếu là string thì dùng luôn, nếu là { vi, en } thì chọn theo lang.
 */
export function getLocalized(obj, lang) {
  if (obj == null) return ""
  if (typeof obj === "string") return obj
  if (typeof obj === "object" && (obj.vi != null || obj.en != null)) {
    return obj[lang] || obj.vi || obj.en || ""
  }
  return ""
}

/** Chuẩn hóa giá trị để hiển thị trong form (string → { vi, en }) */
export function toLocalizedObj(val) {
  if (val == null) return { vi: "", en: "" }
  if (typeof val === "string") return { vi: val, en: val }
  if (typeof val === "object") return { vi: val.vi ?? "", en: val.en ?? "" }
  return { vi: "", en: "" }
}

