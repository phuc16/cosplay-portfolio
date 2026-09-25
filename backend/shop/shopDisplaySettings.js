const db = require("../db")

const GROUP_KEYS = ["gacha", "digital", "physical"]
const DEFAULT_ORDER = [...GROUP_KEYS]

function isValidOrder(order) {
  return (
    Array.isArray(order) &&
    order.length === GROUP_KEYS.length &&
    GROUP_KEYS.every((k) => order.includes(k)) &&
    new Set(order).size === GROUP_KEYS.length
  )
}

async function getGroupOrder() {
  const [[row]] = await db.query("SELECT group_order FROM shop_display_settings ORDER BY id LIMIT 1")
  if (!row) return [...DEFAULT_ORDER]
  const order = typeof row.group_order === "string" ? JSON.parse(row.group_order) : row.group_order
  return isValidOrder(order) ? order : [...DEFAULT_ORDER]
}

/** Upsert the single settings row - mirrors giftSettings.js exactly. */
async function updateGroupOrder(order) {
  if (!isValidOrder(order)) {
    throw new Error(`group_order phải là hoán vị của ${GROUP_KEYS.join(", ")}`)
  }
  const json = JSON.stringify(order)
  const [[existing]] = await db.query("SELECT id FROM shop_display_settings ORDER BY id LIMIT 1")
  if (existing) {
    await db.query(
      "UPDATE shop_display_settings SET group_order = ?, updated_at = NOW() WHERE id = ?",
      [json, existing.id]
    )
  } else {
    await db.query("INSERT INTO shop_display_settings (group_order) VALUES (?)", [json])
  }
}

module.exports = { getGroupOrder, updateGroupOrder, isValidOrder, GROUP_KEYS, DEFAULT_ORDER }
