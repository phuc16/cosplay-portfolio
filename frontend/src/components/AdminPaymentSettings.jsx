import { useEffect, useState } from "react"
import { adminGetPaymentSettings, adminSavePaymentSettings, adminUploadImage } from "../api/shop"

// SePay fields (sepay_api_key, sepay_webhook_secret) are reserved but not
// wired to anything yet, and settingsRepo strips them from public responses
// anyway — they are intentionally never rendered here.
const blank = {
  bank_enabled: false, bank_name: "", bank_bin: "", bank_account_number: "", bank_account_holder: "",
  momo_enabled: false, momo_phone: "", momo_qr_image: "", momo_account_holder: "",
  paypal_enabled: false, paypal_link: "",
  cod_enabled: false,
  payment_note: "",
}

export default function AdminPaymentSettings() {
  const [settings, setSettings] = useState(blank)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)

  const reload = () => adminGetPaymentSettings().then((s) => setSettings({ ...blank, ...s }))

  useEffect(() => { reload().catch(() => {}) }, [])

  const set = (key, value) => { setSettings((s) => ({ ...s, [key]: value })); setSaved(false) }

  const uploadQr = async (file) => {
    if (!file) return
    setError("")
    setUploading(true)
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(",")[1])
        reader.onerror = () => reject(new Error("Không đọc được file ảnh"))
        reader.readAsDataURL(file)
      })
      const { url } = await adminUploadImage(base64, "payments")
      set("momo_qr_image", url)
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Tải ảnh lên thất bại")
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setError("")
    setSaved(false)
    try {
      // The API is the single source of truth for validity — no client-side
      // rule duplication, whatever it rejects is shown verbatim.
      await adminSavePaymentSettings(settings)
      setSaved(true)
      await reload()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu cấu hình thất bại")
    }
  }

  const input = (key, label, placeholder = "") => (
    <label className="block mb-2">
      <span className="block text-sm mb-1 opacity-70">{label}</span>
      <input
        type="text"
        value={settings[key] || ""}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
    </label>
  )

  const toggle = (key, label) => (
    <label className="flex items-center gap-2 mb-3">
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => set(key, e.target.checked)} />
      <span className="font-medium">{label}</span>
    </label>
  )

  return (
    <div className="max-w-xl">
      <h3 className="text-xl font-semibold mb-4">Thanh toán</h3>

      {error && <p className="text-red-500 mb-3">{error}</p>}
      {saved && <p className="text-green-600 mb-3">Đã lưu.</p>}

      <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
        {toggle("bank_enabled", "Chuyển khoản ngân hàng")}
        {settings.bank_enabled && (
          <>
            {input("bank_name", "Tên ngân hàng", "ACB")}
            {input("bank_bin", "Mã ngân hàng (BIN)", "970416")}
            {input("bank_account_number", "Số tài khoản")}
            {input("bank_account_holder", "Chủ tài khoản")}
          </>
        )}
      </div>

      <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
        {toggle("momo_enabled", "Momo")}
        {settings.momo_enabled && (
          <>
            {input("momo_phone", "Số điện thoại")}
            {input("momo_account_holder", "Chủ tài khoản")}
            <label className="block mb-2">
              <span className="block text-sm mb-1 opacity-70">Ảnh mã QR Momo</span>
              {settings.momo_qr_image && (
                <img src={settings.momo_qr_image} alt="Momo QR" className="w-24 h-24 object-contain rounded-lg border border-[var(--border-brand)] mb-2" />
              )}
              <input type="file" accept="image/*" disabled={uploading}
                onChange={(e) => uploadQr(e.target.files?.[0])} />
            </label>
          </>
        )}
      </div>

      <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
        {toggle("paypal_enabled", "PayPal")}
        {settings.paypal_enabled && input("paypal_link", "Link PayPal")}
      </div>

      <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
        {toggle("cod_enabled", "Thanh toán khi nhận hàng (COD)")}
      </div>

      <label className="block mb-6">
        <span className="block text-sm mb-1 opacity-70">Ghi chú thanh toán / Nội dung chuyển khoản (hiển thị cho khách, dùng cho cả mã QR)</span>
        <textarea value={settings.payment_note || ""} onChange={(e) => set("payment_note", e.target.value)} rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
      </label>

      <button type="button" onClick={save}
        className="px-4 py-2 rounded-lg bg-[var(--brand)] text-white">
        Lưu cấu hình
      </button>
    </div>
  )
}
