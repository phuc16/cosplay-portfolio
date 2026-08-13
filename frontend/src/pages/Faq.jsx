import { useLanguage } from "../contexts/LanguageContext"
import { getLocalized } from "../utils/localize"
import { FAQ_ITEMS } from "../shop/faq"
import ShopHeader from "../components/shop/ShopHeader"

export default function Faq() {
  const { t, lang } = useLanguage()

  return (
    <>
      <ShopHeader />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold mb-1">{t("shopFaqTitle")}</h1>
        <p className="opacity-70 mb-8">{t("shopFaqDesc")}</p>

        <div className="flex flex-col gap-3">
          {FAQ_ITEMS.map((item, i) => (
            <details
              key={i}
              className="rounded-2xl border border-[var(--border-brand)] px-4 py-3 group"
            >
              <summary className="font-medium cursor-pointer list-none flex items-center justify-between gap-2">
                {getLocalized(item.question, lang)}
                <span className="opacity-50 group-open:rotate-180 transition-transform shrink-0">▾</span>
              </summary>
              <p className="mt-2 text-sm opacity-80 whitespace-pre-line">
                {getLocalized(item.answer, lang)}
              </p>
            </details>
          ))}
        </div>
      </main>
    </>
  )
}
