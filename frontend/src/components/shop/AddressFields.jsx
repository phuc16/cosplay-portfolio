import { useEffect, useState } from "react"
import { useLanguage } from "../../contexts/LanguageContext"
import { fetchProvinces, fetchWards } from "../../api/shop"

/**
 * Province (34) + ward picked from reference data, not a live per-keystroke
 * autocomplete — replaces the previous Goong-autocomplete design, which
 * fired a request on nearly every character typed. Data reflects Vietnam's
 * post-2025 restructuring (34 provinces/cities, no district level), fetched
 * through our own backend (backend/shop/vnAddress.js), which caches each
 * response for 30 days — administrative boundaries change rarely, and this
 * keeps us off a third party's free API almost entirely rather than baking
 * a copy of the data into this repo to go stale.
 *
 * Street/house-number stays a plain text field — no autocomplete — since
 * province+ward are already exact, and that free-text remainder is short
 * enough not to need one.
 */
export default function AddressFields({ value, onChange }) {
  const { t } = useLanguage()
  const [provinces, setProvinces] = useState([])
  const [wards, setWards] = useState([])
  const [provinceCode, setProvinceCode] = useState("")
  const [wardCode, setWardCode] = useState("")
  const [street, setStreet] = useState(value.address_street || "")

  useEffect(() => {
    fetchProvinces()
      .then(setProvinces)
      .catch(() => setProvinces([]))
  }, [])

  useEffect(() => {
    // No provinceCode means "reset to no wards", already handled by
    // onProvinceChange (a real event handler, not this effect) clearing
    // wards synchronously — this effect only ever needs to fetch.
    if (!provinceCode) return
    fetchWards(provinceCode)
      .then(setWards)
      .catch(() => setWards([]))
  }, [provinceCode])

  const emit = (next) => {
    const provinceName = provinces.find((p) => p.code === next.provinceCode)?.name || ""
    const wardName = wards.find((w) => w.code === next.wardCode)?.name || ""
    const parts = [next.street, wardName, provinceName].filter(Boolean)
    onChange({
      address_raw: parts.join(", "),
      address_street: next.street,
      address_ward: wardName || null,
      // No district level in the current administrative structure — kept
      // in the schema only because existing pre-2025-merger orders have it.
      address_district: null,
      address_province: provinceName || null,
    })
  }

  const onProvinceChange = (code) => {
    setProvinceCode(code)
    setWardCode("")
    setWards([])
    emit({ provinceCode: code, wardCode: "", street })
  }

  const onWardChange = (code) => {
    setWardCode(code)
    emit({ provinceCode, wardCode: code, street })
  }

  const onStreetChange = (text) => {
    setStreet(text)
    emit({ provinceCode, wardCode, street: text })
  }

  const selectCls = "w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"

  return (
    <div>
      <label className="block text-sm mb-1">{t("checkoutAddress")}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">{t("checkoutProvince")}</label>
          <select value={provinceCode} onChange={(e) => onProvinceChange(e.target.value)} className={selectCls}>
            <option value="">{t("checkoutSelectProvince")}</option>
            {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">{t("checkoutWard")}</label>
          <select
            value={wardCode}
            onChange={(e) => onWardChange(e.target.value)}
            disabled={!provinceCode}
            className={`${selectCls} disabled:opacity-50`}
          >
            <option value="">{t("checkoutSelectWard")}</option>
            {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm mb-1">{t("checkoutStreet")}</label>
          <input
            type="text"
            value={street}
            onChange={(e) => onStreetChange(e.target.value)}
            placeholder={t("checkoutStreetPlaceholder")}
            className={selectCls}
          />
        </div>
      </div>
    </div>
  )
}
