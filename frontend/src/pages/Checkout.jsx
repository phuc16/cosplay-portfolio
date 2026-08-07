import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { readCart, cartTotal, clearCart } from "../shop/cart"
import { generateRequestKey } from "../shop/requestKey"
import { createOrder } from "../api/shop"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import AddressFields from "../components/shop/AddressFields"

const PAYMENT_METHODS = ["bank", "momo", "paypal", "cod"]

export default function Checkout() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const cart = useMemo(() => readCart(), [])

  const [buyer, setBuyer] = useState({ buyer_name: "", phone: "", email: "" })
  const [address, setAddress] = useState({ address_raw: "" })
  const [fulfillment, setFulfillment] = useState("ship")
  const [payment, setPayment] = useState("bank")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Stable across retries so a double-tap or a retried submit cannot create
  // two orders holding two reservations. Held in state (not a pure useMemo) so
  // it can be regenerated if the server ever reports a request_key_conflict —
  // otherwise every retry would resend the same colliding key and get stuck.
  const [requestKey, setRequestKey] = useState(() => generateRequestKey())

  const submit = async () => {
    setError("")
    setSubmitting(true)
    try {
      const res = await createOrder({
        items: cart.map((c) => ({ variant_id: c.variant_id, qty: c.qty })),
        buyer: { ...buyer, ...(fulfillment === "ship" ? address : {}) },
        fulfillment_method: fulfillment,
        payment_method: payment,
        note,
        request_key: requestKey,
      })
      clearCart()
      navigate(`/order/${res.order_token}`)
    } catch (e) {
      // An astronomically unlikely UUIDv4 collision, but if it ever happens the
      // buyer must not be stuck resending the same colliding key forever.
      if (e.response?.data?.error === "request_key_conflict") {
        setRequestKey(generateRequestKey())
      }
      setError(
        e.response?.status === 409
          ? e.response.data.message || t("errOutOfStock")
          : e.response?.data?.message || "Đặt hàng thất bại"
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (!cart.length) {
    return <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("cartEmpty")}</main>
  }

  const field = (key, label, type = "text") => (
    <label className="block mb-3">
      <span className="block text-sm mb-1">{label}</span>
      <input
        type={type}
        value={buyer[key]}
        onChange={(e) => setBuyer({ ...buyer, [key]: e.target.value })}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent"
      />
    </label>
  )

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t("checkout")}</h1>

      {field("buyer_name", t("checkoutName"))}
      {field("phone", t("checkoutPhone"), "tel")}
      {field("email", t("checkoutEmail"), "email")}

      <fieldset className="mb-4">
        <legend className="text-sm mb-1">{t("checkoutFulfillment")}</legend>
        {["ship", "pickup"].map((m) => (
          <label key={m} className="mr-4 text-sm">
            <input type="radio" name="fulfillment" checked={fulfillment === m}
              onChange={() => setFulfillment(m)} className="mr-1" />
            {m === "ship" ? t("checkoutShip") : t("checkoutPickup")}
          </label>
        ))}
      </fieldset>

      {fulfillment === "ship" && (
        <div className="mb-4">
          <AddressFields value={address} onChange={setAddress} />
          <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
        </div>
      )}

      <label className="block mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <select value={payment} onChange={(e) => setPayment(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent">
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
      </label>

      <label className="block mb-6">
        <span className="block text-sm mb-1">{t("checkoutNote")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent" />
      </label>

      <div className="flex justify-between items-center mb-4">
        <span className="opacity-70">{t("cartTotal")}</span>
        <span className="text-xl font-bold text-[var(--brand)]">{formatVnd(cartTotal(cart))}</span>
      </div>

      {error && <p className="text-red-500 mb-3">{error}</p>}

      <button type="button" onClick={submit} disabled={submitting}
        className="w-full py-3 rounded-xl bg-[var(--brand)] text-white disabled:opacity-50">
        {submitting ? "..." : t("checkoutPlaceOrder")}
      </button>
    </main>
  )
}
