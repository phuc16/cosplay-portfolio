const db = require("../db")

const DEFAULTS = {
  enabled: false, name: "", image_url: null, min_total: 0, note: null, delivery_link: null,
}

const FIELDS = ["enabled", "name", "image_url", "min_total", "note", "delivery_link"]

async function getSettings() {
  const [[row]] = await db.query("SELECT * FROM gift_settings ORDER BY id LIMIT 1")
  if (!row) return { ...DEFAULTS }
  return { ...row, enabled: Boolean(row.enabled) }
}

/** Upsert the single settings row - mirrors payments/settingsRepo.js exactly. */
async function updateSettings(data) {
  const [[existing]] = await db.query("SELECT id FROM gift_settings ORDER BY id LIMIT 1")

  const values = FIELDS.map((f) => {
    if (f === "enabled") return Boolean(data.enabled)
    if (f === "min_total") return Number.isInteger(data.min_total) ? data.min_total : 0
    if (f === "name") return data.name || ""
    return data[f] === undefined || data[f] === "" ? null : data[f]
  })

  if (existing) {
    await db.query(
      `UPDATE gift_settings SET ${FIELDS.map((f) => `${f} = ?`).join(", ")}, updated_at = NOW() WHERE id = ?`,
      [...values, existing.id]
    )
  } else {
    await db.query(
      `INSERT INTO gift_settings (${FIELDS.join(", ")}) VALUES (${FIELDS.map(() => "?").join(", ")})`,
      values
    )
  }
}

/**
 * Buyer-facing shape: no delivery_link (irrelevant pre-order - it's only
 * ever exposed once, via the buyer's own confirmed/completed order, the
 * same rule every other digital delivery link already follows). Just
 * whether the gift IS digital, so the frontend can decide whether it needs
 * to force the shipping section for an otherwise-all-digital cart.
 */
function publicSettings(settings) {
  return {
    enabled: settings.enabled,
    min_total: settings.min_total,
    name: settings.name,
    image_url: settings.image_url,
    note: settings.note,
    is_digital: Boolean(settings.delivery_link),
  }
}

module.exports = { getSettings, updateSettings, publicSettings, DEFAULTS }
