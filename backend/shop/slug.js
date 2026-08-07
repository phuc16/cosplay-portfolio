/**
 * Turn a title into a URL-safe slug. Vietnamese diacritics are stripped via
 * NFD normalisation; đ/Đ needs an explicit pass because it is a distinct
 * letter rather than a base letter plus a combining mark.
 */
function slugify(input) {
  const slug = String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "collection"
}

/** Append -2, -3, ... until the slug is not present in `existing`. */
function uniqueSlug(base, existing) {
  const taken = new Set(existing)
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

module.exports = { slugify, uniqueSlug }
