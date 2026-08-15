import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { readCart, cartTotal, clearCart, removeFromCart } from "../shop/cart"
import { generateRequestKey } from "../shop/requestKey"
import { createOrder, fetchCollection, fetchPaymentMethods } from "../api/shop"
import { setOrderSessionToken } from "../utils/orderAuth"
import { useLanguage } from "../contexts/LanguageContext"
import { formatVnd } from "../utils/money"
import AddressFields from "../components/shop/AddressFields"
import ShopHeader from "../components/shop/ShopHeader"
import vietqrLogo from "../assets/vietqr-logo.svg"

// One icon per payment method, shown alongside its label in the picker —
// bank reuses the same VietQR mark already used on the order's payment
// instructions page, so the two screens read as the same payment. Momo and
// COD have no bundled brand asset, so they get a lightweight monogram/icon
// instead of a real logo.
const PAYMENT_ICONS = {
  bank: <img src={vietqrLogo} alt="" className="h-6 w-auto object-contain" />,
  momo: (
    <span
      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
      style={{ background: "#A50064" }}
    >
      M
    </span>
  ),
  paypal: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#003087" className="shrink-0">
      <path d="M7.076 21.337H2.47a.641.641 0 01-.633-.74L4.944 3.72a.77.77 0 01.758-.633h5.165c2.35 0 4.128.633 5.33 1.898 1.205 1.264 1.794 2.995 1.77 5.193-.048 3.19-.882 5.358-2.505 6.506-1.623 1.148-3.735 1.707-6.337 1.676H9.38l-.598 3.48a.641.641 0 01-.633.548z" />
    </svg>
  ),
  cod: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" d="M6 9v.01M18 15v.01" />
    </svg>
  ),
}

// Default to both open (rather than none) while the collection fetch is in
// flight, so the picker doesn't flash empty before settling to what the
// cart's collection(s) actually offer.
const FLAGS_LOADING = { loaded: false, allow_ship: true, allow_pickup: true, pickup_location: null, pickup_note: null }

/**
 * Derives which fulfillment methods the cart's collection(s) actually offer,
 * reusing the existing public collection endpoint (no new one needed) — the
 * same data already shown on the pre-purchase collection page. A cart can in
 * principle span more than one collection, so a method only counts as
 * offered if every collection in the cart offers it; pickup location/note
 * are only surfaced when the cart is a single collection (otherwise which
 * one to show is ambiguous, so neither is shown).
 */
async function loadFulfillmentFlags(cart) {
  const slugs = [...new Set(cart.map((c) => c.collection_slug).filter(Boolean))]
  if (slugs.length === 0) return { ...FLAGS_LOADING, loaded: true }

  const collections = (await Promise.all(slugs.map((s) => fetchCollection(s).catch(() => null))))
    .filter(Boolean)
  if (collections.length === 0) return { ...FLAGS_LOADING, loaded: true }

  return {
    loaded: true,
    allow_ship: collections.every((c) => c.allow_ship),
    allow_pickup: collections.every((c) => c.allow_pickup),
    pickup_location: collections.length === 1 ? collections[0].pickup_location || null : null,
    pickup_note: collections.length === 1 ? collections[0].pickup_note || null : null,
  }
}

export default function Checkout() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const PAYMENT_LABELS = {
    bank: t("paymentBank"), momo: t("paymentMomo"), paypal: t("paymentPaypal"), cod: t("paymentCod"),
  }
  // State, not a one-time useMemo: a variant_not_found response needs to
  // drop the stale line(s) and re-render with what's left.
  const [cart, setCart] = useState(() => readCart())

  const [buyer, setBuyer] = useState({ buyer_name: "", phone: "", email: "" })
  const [address, setAddress] = useState({ address_raw: "" })
  const [fulfillment, setFulfillment] = useState("ship")
  const [flags, setFlags] = useState(FLAGS_LOADING)
  const [methods, setMethods] = useState(null)
  const [payment, setPayment] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Fetched rather than hardcoded: a shop with no method enabled must not
  // silently offer one nobody can actually collect payment through.
  useEffect(() => {
    fetchPaymentMethods()
      .then((d) => { setMethods(d.methods); setPayment(d.methods[0] || "") })
      .catch(() => setMethods([]))
  }, [])

  useEffect(() => {
    let ignore = false
    loadFulfillmentFlags(cart).then((f) => { if (!ignore) setFlags(f) })
    return () => { ignore = true }
  }, [cart])

  // Auto-select the sole offered method once the real flags are in, and
  // never leave the picker pointed at a method the collection doesn't offer.
  const offered = useMemo(() => {
    const list = []
    if (flags.allow_ship) list.push("ship")
    if (flags.allow_pickup) list.push("pickup")
    return list
  }, [flags])

  useEffect(() => {
    if (!flags.loaded) return
    if (!offered.includes(fulfillment)) setFulfillment(offered[0] || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags.loaded, offered])

  // COD requires a delivery to collect cash at — it does not apply to an
  // event pickup, which requires prepayment. The server rejects this
  // combination too (routes/orders.js validate()); this is the UI half.
  const offeredPayment = useMemo(
    () => (methods || []).filter((m) => !(m === "cod" && fulfillment === "pickup")),
    [methods, fulfillment]
  )

  useEffect(() => {
    if (!offeredPayment.includes(payment)) setPayment(offeredPayment[0] || "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredPayment])

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
      // Skips the PIN gate for this one browser session — this is the exact
      // browser that just placed the order, so re-proving identity with a
      // PIN they haven't even opened the confirmation email for yet would be
      // pure friction. Any other session (a different device, or this one
      // after the tab closes) still needs the real PIN from that email.
      if (res.access_token) setOrderSessionToken(res.order_token, res.access_token)
      navigate(`/order/${res.order_token}`)
    } catch (e) {
      // An astronomically unlikely UUIDv4 collision, but if it ever happens the
      // buyer must not be stuck resending the same colliding key forever.
      if (e.response?.data?.error === "request_key_conflict") {
        setRequestKey(generateRequestKey())
      }
      // A stale cart line (its variant was deleted after being added) — the
      // server tells us exactly which variant_ids to drop. Removing them
      // here is the only way "try again" can actually succeed; the buyer
      // has no way to identify or remove a bad line themselves, since this
      // page never shows individual cart items.
      if (e.response?.data?.error === "variant_not_found") {
        for (const id of e.response.data.variant_ids || []) removeFromCart(id)
        setCart(readCart())
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
    return (
      <>
        <ShopHeader />
        <main className="max-w-2xl mx-auto px-4 py-10 opacity-70">{t("cartEmpty")}</main>
      </>
    )
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
    <>
      <ShopHeader />
      <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-6">{t("checkout")}</h1>

      {field("buyer_name", t("checkoutName"))}
      {field("phone", t("checkoutPhone"), "tel")}
      {field("email", t("checkoutEmail"), "email")}

      <fieldset className="mb-4">
        <legend className="text-sm mb-1">{t("checkoutFulfillment")}</legend>
        {/* Only the methods the collection(s) in the cart actually offer are
            rendered — offering ship/pickup regardless of the collection led
            buyers straight into a 400 the backend correctly rejects. */}
        {offered.map((m) => (
          <label key={m} className="mr-4 text-sm">
            <input type="radio" name="fulfillment" checked={fulfillment === m}
              onChange={() => setFulfillment(m)} className="mr-1" />
            {m === "ship" ? t("checkoutShip") : t("checkoutPickup")}
          </label>
        ))}
        {flags.loaded && offered.length === 0 && (
          <p className="text-sm text-[var(--text-error)]">{t("checkoutNoFulfillment")}</p>
        )}
      </fieldset>

      {fulfillment === "ship" && (
        <div className="mb-4">
          <AddressFields value={address} onChange={setAddress} />
          <p className="text-xs opacity-70 mt-1">{t("checkoutShippingNote")}</p>
        </div>
      )}

      {fulfillment === "pickup" && (flags.pickup_location || flags.pickup_note) && (
        <div className="mb-4 p-3 rounded-xl border border-[var(--border-brand)] opacity-80 text-sm">
          {flags.pickup_location && (
            <p className="font-semibold">{t("shopPickupLocation")}: {flags.pickup_location}</p>
          )}
          {flags.pickup_note && <p>{t("shopPickupNote")}: {flags.pickup_note}</p>}
        </div>
      )}

      <div className="mb-4">
        <span className="block text-sm mb-1">{t("checkoutPayment")}</span>
        <div role="radiogroup" aria-label={t("checkoutPayment")} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {offeredPayment.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={payment === m}
              onClick={() => setPayment(m)}
              disabled={!methods || methods.length === 0}
              className={
                "flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl border text-xs sm:text-sm transition disabled:opacity-50 disabled:cursor-not-allowed " +
                (payment === m
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] font-semibold"
                  : "border-[var(--border-brand)] hover:bg-[var(--brand-soft)]")
              }
            >
              {PAYMENT_ICONS[m]}
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
        {methods && methods.length === 0 && (
          <p className="text-sm text-[var(--text-error)] mt-1">{t("checkoutNoMethods")}</p>
        )}
        {/* Stated before the buyer commits — cod never expires, so the
            notice is only shown for the payment methods that actually
            carry a deadline. */}
        {payment && payment !== "cod" && (
          <p className="text-xs opacity-70 mt-1">{t("checkoutPaymentWindow")}</p>
        )}
      </div>

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

      <button type="button" onClick={submit} disabled={submitting || !methods || methods.length === 0}
        className="w-full py-3 rounded-xl bg-[var(--brand)] text-white disabled:opacity-50">
        {submitting ? "..." : t("checkoutPlaceOrder")}
      </button>
      </main>
    </>
  )
}
