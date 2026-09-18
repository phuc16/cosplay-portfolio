import { useState } from "react"
import { submitReview } from "../../api/shop"
import { useLanguage } from "../../contexts/LanguageContext"

/**
 * One item's "leave a review" control, rendered on the order page once the
 * order reaches 'completed'. Tracks its own submitted/already-reviewed
 * state locally - the order response itself carries no per-item "already
 * reviewed" flag, so a page reload can show the form again even after a
 * successful submit; a retried submit there just surfaces the server's
 * already_reviewed response, which lands in the same terminal state.
 */
export default function ProductReviewForm({ token, variantId, authHeaders }) {
  const { t } = useLanguage()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState("")
  const [status, setStatus] = useState("idle") // idle | submitting | done | already | error

  const submit = async () => {
    if (!rating) return
    setStatus("submitting")
    try {
      await submitReview(token, { variant_id: variantId, rating, comment: comment.trim() || undefined }, authHeaders)
      setStatus("done")
    } catch (e) {
      if (e.response?.data?.error === "already_reviewed") {
        setStatus("already")
      } else {
        setStatus("error")
      }
    }
  }

  if (status === "done") return <p className="text-sm text-[var(--brand)] mt-1">{t("orderReviewThanks")}</p>
  if (status === "already") return <p className="text-sm opacity-70 mt-1">{t("orderReviewAlready")}</p>

  return (
    <div className="mt-2 p-3 rounded-lg border border-[var(--border-brand)]">
      <p className="text-sm font-medium mb-1">{t("orderReviewTitle")}</p>
      <div role="radiogroup" aria-label={t("orderReviewTitle")} className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            onClick={() => setRating(n)}
            className={`text-xl leading-none ${n <= rating ? "text-yellow-400" : "opacity-30"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("orderReviewCommentPlaceholder")}
        rows={2}
        className="w-full px-3 py-2 rounded-lg border border-[var(--border-brand)] bg-transparent text-sm mb-2"
      />
      {status === "error" && <p className="text-sm text-red-500 mb-2">{t("orderReviewFailed")}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={!rating || status === "submitting"}
        className="px-3 py-1.5 text-sm rounded-lg bg-[var(--brand)] text-white disabled:opacity-50"
      >
        {t("orderReviewSubmit")}
      </button>
    </div>
  )
}
