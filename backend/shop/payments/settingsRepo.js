const db = require("./../../db")

const DEFAULTS = {
  bank_enabled: false, bank_name: null, bank_bin: null,
  bank_account_number: null, bank_account_holder: null,
  momo_enabled: false, momo_phone: null, momo_qr_image: null, momo_account_holder: null,
  paypal_enabled: false, paypal_link: null,
  cod_enabled: false,
  payment_note: null,
  auto_confirm_enabled: false,
}

const BOOLEANS = ["bank_enabled", "momo_enabled", "paypal_enabled", "cod_enabled", "auto_confirm_enabled"]

const FIELDS = [
  "bank_enabled", "bank_name", "bank_bin", "bank_account_number", "bank_account_holder",
  "momo_enabled", "momo_phone", "momo_qr_image", "momo_account_holder",
  "paypal_enabled", "paypal_link", "cod_enabled", "payment_note",
  "sepay_api_key", "sepay_webhook_secret", "auto_confirm_enabled",
]

/** Secrets that must never reach a browser. */
const SECRET_FIELDS = ["sepay_api_key", "sepay_webhook_secret"]

async function getSettings() {
  const [[row]] = await db.query("SELECT * FROM payment_settings ORDER BY id LIMIT 1")
  if (!row) return { ...DEFAULTS }

  const out = { ...row }
  for (const key of BOOLEANS) out[key] = Boolean(out[key])
  return out
}

/** Upsert the single settings row. */
async function updateSettings(data) {
  const [[existing]] = await db.query("SELECT id FROM payment_settings ORDER BY id LIMIT 1")

  const values = FIELDS.map((f) => {
    if (BOOLEANS.includes(f)) return data[f] === undefined ? false : Boolean(data[f])
    return data[f] === undefined || data[f] === "" ? null : data[f]
  })

  if (existing) {
    await db.query(
      `UPDATE payment_settings SET ${FIELDS.map((f) => `${f} = ?`).join(", ")}, updated_at = NOW() WHERE id = ?`,
      [...values, existing.id]
    )
  } else {
    await db.query(
      `INSERT INTO payment_settings (${FIELDS.join(", ")}) VALUES (${FIELDS.map(() => "?").join(", ")})`,
      values
    )
  }
}

function enabledMethods(settings) {
  return ["bank", "momo", "paypal", "cod"].filter((m) => settings[`${m}_enabled`])
}

/** Strip secrets before anything is sent to a browser. */
function publicSettings(settings) {
  const out = { ...settings }
  for (const key of SECRET_FIELDS) delete out[key]
  return out
}

module.exports = { getSettings, updateSettings, enabledMethods, publicSettings, DEFAULTS }
