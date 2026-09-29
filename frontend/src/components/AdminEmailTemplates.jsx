import { useEffect, useState } from "react"
import { adminListEmailTemplates, adminSaveEmailTemplate, adminListFailedEmails } from "../api/shop"

const LABELS = {
  order_placed: "Đã nhận đơn hàng",
  payment_confirmed: "Đã xác nhận thanh toán",
  shipped: "Đã gửi hàng",
  cancelled: "Đã hủy đơn",
  payment_proof_uploaded: "Admin: đã tải ảnh chuyển khoản",
}

// Mirrors backend/shop/email/templates.js PLACEHOLDERS - shown so the seller
// knows what's available without guessing or reading source.
const PLACEHOLDERS = [
  "order_id", "order_token", "order_url", "buyer_name", "total", "items",
  "status", "payment_method", "fulfillment_method", "tracking_code",
  "payment_note", "shop_name", "receiver_info", "shipping_fee_note", "prep_note",
  "admin_url", "payment_proof_image",
]

// Keyed by tpl.type in the parent, so this mounts fresh (picking up
// tpl.subject/tpl.body_html) once per template rather than needing an effect
// to re-sync local state when the parent re-fetches after a save.
function Editor({ tpl, onSaved }) {
  const [subject, setSubject] = useState(tpl.subject)
  const [body, setBody] = useState(tpl.body_html)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setError("")
    setSaved(false)
    try {
      // The API validates placeholders (backend/shop/email/templates.js
      // validatePlaceholders) - the exact message it returns is surfaced
      // verbatim rather than re-implemented client-side.
      await adminSaveEmailTemplate(tpl.type, { subject, body_html: body })
      setSaved(true)
      onSaved?.()
    } catch (e) {
      setError(e.response?.data?.message || "Lưu mẫu email thất bại")
    }
  }

  const restoreDefault = () => {
    setSubject(tpl.default.subject)
    setBody(tpl.default.body_html)
    setSaved(false)
  }

  return (
    <div className="mb-6 p-3 rounded-xl border border-[var(--border-brand)]">
      <h4 className="font-semibold mb-2">{LABELS[tpl.type] || tpl.type}</h4>

      <label className="block mb-2">
        <span className="block text-sm mb-1 opacity-70">Tiêu đề</span>
        <input type="text" value={subject} onChange={(e) => { setSubject(e.target.value); setSaved(false) }}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
      </label>

      <label className="block mb-2">
        <span className="block text-sm mb-1 opacity-70">Nội dung (HTML)</span>
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setSaved(false) }} rows={6}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent font-mono text-xs" />
      </label>

      <p className="text-xs opacity-60 mb-2">
        Placeholder hợp lệ: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}
      </p>

      {error && <p className="text-sm text-red-500 mb-2">{error}</p>}
      {saved && <p className="text-sm text-green-600 mb-2">Đã lưu.</p>}

      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={save} className="px-3 py-1.5 text-sm rounded-lg bg-[var(--brand)] text-white">
          Lưu
        </button>
        <button type="button" onClick={restoreDefault} className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-brand)]">
          Khôi phục mặc định
        </button>
      </div>
    </div>
  )
}

// Minimal surfacing of sender.js's listFailed(): a badge + list so the
// seller notices a buyer never got their confirmation, instead of the row
// sitting invisibly in email_queue forever.
function FailedEmails() {
  const [failed, setFailed] = useState(null)

  useEffect(() => {
    adminListFailedEmails().then(setFailed).catch(() => setFailed([]))
  }, [])

  if (!failed || failed.length === 0) return null

  return (
    <div className="mb-6 p-3 rounded-xl border border-red-400">
      <h4 className="font-semibold mb-2 text-red-600">
        Email gửi thất bại ({failed.length})
      </h4>
      <ul className="text-sm space-y-1">
        {failed.map((row) => (
          <li key={row.id} className="opacity-80">
            Đơn #{row.order_id} · {row.type} · {row.to_email}
            {row.last_error && <span className="opacity-60"> - {row.last_error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AdminEmailTemplates() {
  const [templates, setTemplates] = useState(null)

  const reload = () => adminListEmailTemplates().then(setTemplates)

  useEffect(() => { reload().catch(() => setTemplates([])) }, [])

  if (templates === null) return <p className="opacity-60">Đang tải...</p>

  return (
    <div className="max-w-2xl">
      <h3 className="text-xl font-semibold mb-4">Mẫu email</h3>
      <FailedEmails />
      {templates.map((tpl) => (
        <Editor
          key={tpl.type}
          tpl={{ ...tpl, default: { subject: tpl.default_subject, body_html: tpl.default_body_html } }}
          onSaved={reload}
        />
      ))}
    </div>
  )
}
